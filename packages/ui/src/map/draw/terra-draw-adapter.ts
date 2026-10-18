/**
 * `MapDrawPort` on Terra Draw (docs/research/M2c-interfaces.md §4), the only module that drives it (dependency-cruiser
 * `only-the-draw-adapter-imports-terra-draw`). The admin loads Terra Draw lazily on the first `AdminMapHandle.draw()`
 * and hands its constructors here; this module imports only their structural types (`terra-draw-types.ts`).
 *
 * - Our ids live in Terra Draw's own store (an id strategy that accepts them); a newly drawn shape gets the `drawId` of
 *   `setMode` once finished, and the port switches to `select` with it selected.
 * - The limits are checked twice: Terra Draw's `validation` refuses a position outside them (or past the vertex count)
 *   while drawing or dragging, and every finished shape or edit is checked whole (`checkGeometry`); a refused edit snaps
 *   back to the last accepted geometry. `refused` fires once per kind until the gesture ends.
 * - Every geometry is rounded to `DRAW_DECIMALS` places before it leaves; `snapshot()` is the accepted state.
 */
import { geometrySchema, type Geometry, type LngLat } from '@hcm/shared';

import { Listeners } from '../listeners.js';
import type { MapPort, Unsubscribe } from '../map-port.js';
import { nativeMap } from '../mapbox-adapter.js';
import type {
    DrawChange,
    DrawMode,
    DrawnFeature,
    DrawnFeatureInput,
    DrawOptions,
    DrawRefusal,
    DrawShape,
    MapDrawPort,
} from './draw-port.js';
import { STATIC_MODE } from './mode-names.js';
import { checkGeometry, checkPositions, DRAW_DECIMALS, roundGeometry, roundPosition } from './rules.js';
import { drawModes } from './terra-draw-modes.js';
import type { TdFeature, TdFeatureId, TdFinishContext, TdInstance, TdValidationResult, TerraDrawModules } from './terra-draw-types.js';

const VALID: TdValidationResult = { valid: true };

/** A finished shape the manifest cannot hold (a polygon of fewer than three distinct positions). */
const ZERO_AREA: DrawRefusal = { kind: 'zero-area' };

/** A subscriber that throws is the subscriber's problem: drawing goes on. */
const ignore = (): void => undefined;

function tdModeName(mode: DrawMode): string {
    return mode.startsWith('draw-') ? mode.slice('draw-'.length) : mode;
}

/** The shape a geometry is edited as when its feature names none. */
function shapeOf(feature: DrawnFeature): DrawShape {
    return feature.shape ?? (feature.geometry.type.toLowerCase() as DrawShape);
}

function toTd(feature: DrawnFeature): TdFeature {
    return { id: feature.id, type: 'Feature', geometry: feature.geometry, properties: { mode: shapeOf(feature) } };
}

/** Every `[lng, lat]` pair in a GeoJSON `coordinates` value, however deeply nested. */
export function positionsOf(coordinates: unknown): LngLat[] {
    if (!Array.isArray(coordinates)) {
        return [];
    }
    const [lng, lat] = coordinates as unknown[];
    if (typeof lng === 'number' && typeof lat === 'number') {
        return [[lng, lat]];
    }
    return coordinates.flatMap((inner: unknown) => positionsOf(inner));
}

/** A store feature's geometry as the port's, rounded; null for a shape the manifest cannot hold. */
export function geometryOf(feature: TdFeature): Geometry | null {
    const parsed = geometrySchema.safeParse(feature.geometry);
    return parsed.success ? roundGeometry(parsed.data) : null;
}

/** What `attach` set up; null while detached. */
interface Session {
    readonly draw: TdInstance;
    readonly map: MapPort;
    readonly options: DrawOptions;
    readonly cleanups: (() => void)[];
}

/** One of our features as accepted and as Terra Draw holds it right now (a drag in progress included). */
interface Held {
    readonly accepted: DrawnFeature;
    readonly current: DrawnFeature;
}

class TerraDrawPort implements MapDrawPort {
    readonly #modules: TerraDrawModules;
    readonly #changes = new Listeners<[DrawChange]>(ignore);
    readonly #selections = new Listeners<[string | null]>(ignore);
    readonly #refusals = new Listeners<[DrawRefusal]>(ignore);
    /** The accepted features, by our id: what `snapshot` answers and where a refused edit snaps back to. */
    readonly #good = new Map<string, DrawnFeature>();
    #session: Session | null = null;
    #mode: DrawMode = 'static';
    #drawId: string | null = null;
    #selected: string | null = null;
    #pick: ((position: LngLat | null) => void) | null = null;
    #lastRefusal: DrawRefusal['kind'] | null = null;
    #ids = 0;

    constructor(modules: TerraDrawModules) {
        this.#modules = modules;
    }

    get mode(): DrawMode {
        return this.#mode;
    }

    attach(map: MapPort, options: DrawOptions): void {
        const native = nativeMap(map);
        if (native === null) {
            throw new Error('draw needs a mounted Mapbox map');
        }
        this.detach();
        const modules = this.#modules;
        const draw = new modules.TerraDraw({
            adapter: new modules.TerraDrawMapboxGLAdapter({ map: native, coordinatePrecision: DRAW_DECIMALS }),
            modes: drawModes(modules, options.color, (feature, context) => this.#validate(feature, context.updateType, options)),
            idStrategy: { isValidId: (id) => String(id).length > 0, getId: () => this.#newId() },
        });
        const session: Session = { draw, map, options, cleanups: [] };
        this.#listen(session);
        draw.start();
        draw.setMode(STATIC_MODE);
        draw.addFeatures([...this.#good.values()].map(toTd));
        this.#session = session;
        this.#mode = 'static';
        this.#watchEscape(session, native.getCanvas());
    }

    #newId(): string {
        this.#ids += 1;
        return `hcm-draw-${String(this.#ids)}`;
    }

    #listen(session: Session): void {
        const { draw } = session;
        draw.on('change', (ids, type) => {
            this.#onChange(session, ids, type);
        });
        draw.on('finish', (id, context) => {
            this.#onFinish(session, id, context);
        });
        draw.on('select', (id) => {
            this.#onSelect(String(id));
        });
        draw.on('deselect', () => {
            this.#onSelect(null);
        });
    }

    #watchEscape(session: Session, canvas: HTMLElement): void {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                this.cancelPick();
            }
        };
        canvas.addEventListener('keydown', onKey);
        session.cleanups.push(() => {
            canvas.removeEventListener('keydown', onKey);
        });
    }

    /** Terra Draw's validation hook: positions while drawing or dragging, the whole shape once finished. */
    #validate(feature: TdFeature, updateType: string | undefined, options: DrawOptions): TdValidationResult {
        const refusal =
            updateType === 'finish' ? wholeRefusal(feature, options) : checkPositions(positionsOf(feature.geometry.coordinates), options);
        if (refusal === null) {
            return VALID;
        }
        this.#refuse(refusal);
        return { valid: false, reason: refusal.kind };
    }

    #refuse(refusal: DrawRefusal): void {
        if (refusal.kind !== this.#lastRefusal) {
            this.#lastRefusal = refusal.kind;
            this.#refusals.emit(refusal);
        }
    }

    #refusalOf(geometry: Geometry): DrawRefusal | null {
        const session = this.#session;
        return session === null ? null : checkGeometry(geometry, session.options);
    }

    /** Our features in Terra Draw's store, with the geometry it holds now. */
    #held(session: Session): Held[] {
        return session.draw.getSnapshot().flatMap((feature) => {
            const accepted = this.#good.get(String(feature.id));
            const geometry = accepted === undefined ? null : geometryOf(feature);
            return accepted === undefined || geometry === null ? [] : [{ accepted, current: { ...accepted, geometry } }];
        });
    }

    #onChange(session: Session, ids: readonly TdFeatureId[], type: string): void {
        const moved = type === 'update' && ids.some((id) => this.#good.has(String(id)));
        if (moved && this.#mode === 'select') {
            this.#changes.emit({ features: this.#held(session).map(({ current }) => current), final: false });
        }
    }

    #onFinish(session: Session, id: TdFeatureId, context: TdFinishContext): void {
        if (context.action === 'draw') {
            this.#adopt(session, id);
        } else {
            this.#settle(session);
        }
        this.#lastRefusal = null;
    }

    /** A shape was finished: it becomes ours under `drawId`, or goes when it breaks a limit. */
    #adopt(session: Session, tdId: TdFeatureId): void {
        const drawn = session.draw.getSnapshot().find((feature) => feature.id === tdId);
        if (drawn === undefined) {
            return;
        }
        session.draw.removeFeatures([tdId]);
        const geometry = geometryOf(drawn);
        if (geometry === null) {
            this.#refuse(ZERO_AREA);
            return;
        }
        const refusal = checkGeometry(geometry, session.options);
        if (refusal === null) {
            this.#keepDrawn(geometry);
        } else {
            this.#refuse(refusal);
        }
    }

    #keepDrawn(geometry: Geometry): void {
        const id = this.#drawId ?? this.#newId();
        this.#put({ id, geometry, shape: tdModeName(this.#mode) as DrawShape });
        this.setMode('select');
        this.select(id);
        this.#changes.emit({ features: this.snapshot(), final: true });
    }

    /** An edit ended: every feature is checked whole; a refused one snaps back. */
    #settle(session: Session): void {
        for (const { accepted, current } of this.#held(session)) {
            const refusal = checkGeometry(current.geometry, session.options);
            if (refusal === null) {
                this.#good.set(current.id, current);
            } else {
                this.#refuse(refusal);
                this.#put(accepted);
            }
        }
        this.#changes.emit({ features: this.snapshot(), final: true });
    }

    /** Adds (or replaces) a feature in Terra Draw's store and in the accepted state. */
    #put(feature: DrawnFeature): void {
        const draw = this.#session?.draw;
        if (draw !== undefined) {
            draw.removeFeatures(this.#good.has(feature.id) ? [feature.id] : []);
            draw.addFeatures([toTd(feature)]);
        }
        this.#good.set(feature.id, feature);
    }

    #onSelect(id: string | null): void {
        const ours = id !== null && this.#good.has(id) ? id : null;
        if (ours !== this.#selected) {
            this.#selected = ours;
            this.#selections.emit(ours);
        }
    }

    setMode(mode: DrawMode, drawId?: string): void {
        this.cancelPick();
        this.#mode = mode;
        this.#drawId = drawId ?? null;
        this.#lastRefusal = null;
        this.#session?.draw.setMode(tdModeName(mode));
    }

    load(features: readonly DrawnFeatureInput[]): void {
        const rounded = features.map((feature) => ({ ...feature, geometry: roundGeometry(feature.geometry) }));
        const accepted = rounded.filter((feature) => this.#accepts(feature));
        this.#session?.draw.removeFeatures([...this.#good.keys()]);
        this.#good.clear();
        for (const feature of accepted) {
            this.#put(feature);
        }
        this.#onSelect(this.#selected);
    }

    #accepts(feature: DrawnFeature): boolean {
        const refusal = this.#refusalOf(feature.geometry);
        if (refusal !== null) {
            this.#refuse(refusal);
        }
        return refusal === null;
    }

    snapshot(): readonly DrawnFeature[] {
        return [...this.#good.values()];
    }

    select(id: string | null): void {
        const draw = this.#session?.draw;
        if (draw === undefined) {
            return;
        }
        if (id === null) {
            this.#deselect(draw);
            return;
        }
        if (this.#mode !== 'select') {
            this.setMode('select');
        }
        draw.selectFeature(id);
    }

    #deselect(draw: TdInstance): void {
        const selected = this.#selected;
        if (selected !== null) {
            draw.deselectFeature(selected);
        }
    }

    deleteSelected(): void {
        const session = this.#session;
        const selected = this.#selected;
        if (session === null || selected === null) {
            return;
        }
        session.draw.removeFeatures([selected]);
        this.#good.delete(selected);
        this.#onSelect(null);
        this.#changes.emit({ features: this.snapshot(), final: true });
    }

    pick(): Promise<LngLat | null> {
        this.cancelPick();
        const map = this.#session?.map;
        if (map === undefined) {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            const stop = map.onMapClick((position) => {
                finish(roundPosition(position));
            });
            const finish = (position: LngLat | null): void => {
                stop();
                this.#pick = null;
                resolve(position);
            };
            this.#pick = finish;
        });
    }

    cancelPick(): void {
        this.#pick?.(null);
    }

    setColor(color: string): void {
        const session = this.#session;
        if (session === null || session.options.color === color) {
            return;
        }
        const mode = this.#mode;
        const drawId = this.#drawId ?? undefined;
        this.attach(session.map, { ...session.options, color });
        this.setMode(mode, drawId);
    }

    on(event: 'change', handler: (change: DrawChange) => void): Unsubscribe;
    on(event: 'select', handler: (id: string | null) => void): Unsubscribe;
    on(event: 'refused', handler: (refusal: DrawRefusal) => void): Unsubscribe;
    on(event: 'change' | 'select' | 'refused', handler: (payload: never) => void): Unsubscribe {
        const lists = { change: this.#changes, select: this.#selections, refused: this.#refusals };
        return (lists[event] as Listeners<[unknown]>).add(handler as (payload: unknown) => void);
    }

    detach(): void {
        this.cancelPick();
        const session = this.#session;
        this.#session = null;
        this.#mode = 'static';
        this.#selected = null;
        session?.draw.stop();
        for (const cleanup of session?.cleanups ?? []) {
            cleanup();
        }
    }
}

/** The whole finished shape's first broken limit; a shape the manifest cannot hold has no area. */
function wholeRefusal(feature: TdFeature, options: DrawOptions): DrawRefusal | null {
    const geometry = geometryOf(feature);
    return geometry === null ? ZERO_AREA : checkGeometry(geometry, options);
}

/** The drawing tools on the Terra Draw constructors the admin loaded (`AdminMapHandle.draw()`). */
export function createTerraDrawPort(modules: TerraDrawModules): MapDrawPort {
    return new TerraDrawPort(modules);
}
