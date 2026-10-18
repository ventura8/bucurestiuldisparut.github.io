/**
 * A stand-in for Terra Draw's constructors (`TerraDrawModules`): a store of features, the four events, the id strategy
 * and the modes' options, with `finishDrawing`, `drag` and `validate` playing the drawing side the way Terra Draw does
 * (a new shape gets an id from the strategy and ends with `finish` `draw`; a drag sends `change` `update` and ends with
 * `finish`).
 */
import type {
    TdAddResult,
    TdFeature,
    TdFeatureId,
    TdFinishContext,
    TdInstance,
    TdModeOptions,
    TdOptions,
    TdValidationResult,
    TerraDrawModules,
} from '../../../src/map/draw/terra-draw-types.js';

type Listener = (...args: never[]) => void;

export class FakeMode {
    readonly kind: string;
    readonly options: TdModeOptions | undefined;

    constructor(kind: string, options?: TdModeOptions) {
        this.kind = kind;
        this.options = options;
    }
}

export class FakeTerraDraw implements TdInstance {
    readonly options: TdOptions;
    readonly store = new Map<TdFeatureId, TdFeature>();
    readonly modes: string[] = [];
    readonly removed: (readonly TdFeatureId[])[] = [];
    started = false;
    stopped = false;
    selected: TdFeatureId | null = null;
    readonly #listeners = new Map<string, Listener[]>();

    constructor(options: TdOptions) {
        this.options = options;
    }

    start(): void {
        this.started = true;
    }

    stop(): void {
        this.stopped = true;
    }

    setMode(mode: string): void {
        this.modes.push(mode);
    }

    get mode(): string | undefined {
        return this.modes.at(-1);
    }

    getSnapshot(): readonly TdFeature[] {
        return [...this.store.values()];
    }

    addFeatures(features: readonly TdFeature[]): readonly TdAddResult[] {
        return features.map((feature) => {
            const id = feature.id ?? this.options.idStrategy.getId();
            if (!this.options.idStrategy.isValidId(id)) {
                return { id, valid: false, reason: 'invalid id' };
            }
            this.store.set(id, { ...feature, id });
            return { id, valid: true };
        });
    }

    removeFeatures(ids: readonly TdFeatureId[]): void {
        this.removed.push(ids);
        for (const id of ids) {
            this.store.delete(id);
        }
    }

    selectFeature(id: TdFeatureId): void {
        this.selected = id;
        this.#emit('select', id);
    }

    deselectFeature(): void {
        this.selected = null;
        this.#emit('deselect');
    }

    on(event: string, listener: Listener): void {
        this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
    }

    #emit(event: string, ...args: unknown[]): void {
        for (const listener of this.#listeners.get(event) ?? []) {
            (listener as (...values: unknown[]) => void)(...args);
        }
    }

    /** The validation of the mode named `mode` (as Terra Draw calls it). */
    validate(mode: string, geometry: TdFeature['geometry'], updateType?: string): TdValidationResult | undefined {
        const owner = (this.options.modes as FakeMode[]).find((candidate) => candidate.kind === mode);
        const context = updateType === undefined ? {} : { updateType };
        return owner?.options?.validation?.({ type: 'Feature', geometry, properties: { mode } }, context);
    }

    /** A shape finished in the current drawing mode: stored under a new id, then `finish` with `draw`. */
    finishDrawing(geometry: TdFeature['geometry']): TdFeatureId {
        const id = this.options.idStrategy.getId();
        this.store.set(id, { id, type: 'Feature', geometry, properties: { mode: this.mode ?? '' } });
        this.#emit('change', [id], 'create');
        this.#emit('finish', id, { mode: this.mode ?? '', action: 'draw' } satisfies TdFinishContext);
        return id;
    }

    /** A drag of feature `id` to `geometry`: one `change`, then `finish` when `final`. */
    drag(id: TdFeatureId, geometry: TdFeature['geometry'], final: boolean): void {
        const feature = this.store.get(id);
        if (feature !== undefined) {
            this.store.set(id, { ...feature, geometry });
        }
        this.#emit('change', [id], 'update');
        if (final) {
            this.#emit('finish', id, { mode: 'select', action: 'dragCoordinate' } satisfies TdFinishContext);
        }
    }

    /** Plays any event (a `change` of a guidance point, a `select` of another feature). */
    play(event: string, ...args: unknown[]): void {
        this.#emit(event, ...args);
    }
}

export interface FakeTerraDrawModules extends TerraDrawModules {
    readonly instances: FakeTerraDraw[];
    readonly adapters: { readonly map: unknown; readonly coordinatePrecision: number }[];
}

function modeConstructor(kind: string): new (options?: TdModeOptions) => FakeMode {
    return class extends FakeMode {
        constructor(options?: TdModeOptions) {
            super(kind, options);
        }
    };
}

/** Fresh constructors; `instances` and `adapters` keep what the adapter created, in order. */
export function fakeTerraDrawModules(): FakeTerraDrawModules {
    const instances: FakeTerraDraw[] = [];
    const adapters: { readonly map: unknown; readonly coordinatePrecision: number }[] = [];
    return {
        instances,
        adapters,
        TerraDraw: class extends FakeTerraDraw {
            constructor(options: TdOptions) {
                super(options);
                instances.push(this);
            }
        },
        TerraDrawPointMode: modeConstructor('point'),
        TerraDrawLineStringMode: modeConstructor('linestring'),
        TerraDrawPolygonMode: modeConstructor('polygon'),
        TerraDrawRectangleMode: modeConstructor('rectangle'),
        TerraDrawSelectMode: modeConstructor('select'),
        TerraDrawRenderMode: modeConstructor('static'),
        TerraDrawMapboxGLAdapter: class {
            readonly options: { readonly map: unknown; readonly coordinatePrecision: number };

            constructor(options: { readonly map: unknown; readonly coordinatePrecision: number }) {
                this.options = options;
                adapters.push(options);
            }
        },
    };
}
