/**
 * The georeferencer (`#/georef/<versionId>`, `docs/research/M3-interfaces.md` §6, §10.4; behaviour A16): the fallback
 * when the automatic matching found too few pairs, and the way to re-georeference a layer. The scan beside the reference
 * map, pairs made of a click on each (or both crosshairs from the keyboard), moved, deleted or kept as checkpoints, the
 * transform and its residuals refitted on every change with the shared mathematics, the live warped preview, and Save,
 * which queues the job (`imagery.saveGcps`). Unsaved pairs are guarded like any draft. Unedited, the version's own figures and
 * the map it publishes show instead (M15: a camera's lattice is no refit of its pairs, `fit-view.ts`). The map of a lattice or terrain
 * and Snap my points come from a chunk fetched on their first need (`extras.ts`).
 */
import {
    cityDocSchema,
    clamp,
    FIRESTORE_PATHS,
    imagerySettingsOf,
    isId,
    layerVersionDocSchema,
    type CityDoc,
    type FittedTransform,
    type Gcp,
    type GeorefTransform,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, type DocState } from '../content/doc.js';
import type { ContentServices } from '../content/services.js';
import { callImagery, refusalOf } from '../imagery/api.js';
import { NO_FILES } from '../imagery/files.js';
import { frameOf, type CityFrame } from '../layers/map-session.js';
import { Store } from '../state/store.js';
import { loadGeorefExtras, publishedOf, snapOf, type ExtrasLoader } from './extras.js';
import { baseOf, fitOf, ownFitOf, shownFit, type OwnFit } from './fit-view.js';
import { GeorefMap, referenceFrame } from './georef-map.js';
import { GeorefPictures } from './georef-pictures.js';
import { PlacingMark } from './placing.js';
import { saveRequestOf } from './save-request.js';
import {
    moveGeo,
    movePixel,
    roundPixel,
    samePairs,
    togglePair,
    withoutPair,
    withPair,
    type GeoPosition,
    type PixelPosition,
} from './pairs.js';
import { georefVersionOf, INITIAL_GEOREF, type GeorefIntents, type GeorefState, type GeorefVersion, type ReferenceKind } from './state.js';
import { Suggestions } from './suggestions.js';

/** The intents that edit the pairs. */
type PairIntent = 'setAdding' | 'pickScan' | 'addAtCentres' | 'movePixel' | 'moveGeo' | 'select' | 'remove' | 'toggle' | 'cancelHalf';

/** The intents of the matcher's suggestions (M4 §2.5). */
type SuggestionIntent = 'acceptSuggestion' | 'acceptAllSuggestions' | 'rejectSuggestion' | 'selectSuggestion';

/** No scan read yet: a pixel is only rounded. */
const UNBOUNDED = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER } as const;

class GeorefStore implements AreaStore<GeorefState, GeorefIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<GeorefState>;
    readonly #doc: LiveDoc<LayerVersionDoc>;
    readonly #city: LiveDoc<CityDoc>;
    readonly #map: GeorefMap;
    readonly #pictures: GeorefPictures;
    readonly #suggestions = new Suggestions();
    readonly #placing: PlacingMark;
    readonly #extras: ExtrasLoader;
    /** The version's own pairs and transform: what Discard returns to and the unsaved guard compares with. */
    #base: { readonly pairs: readonly Gcp[]; readonly transform: GeorefTransform } = { pairs: [], transform: 'affine' };
    #transform: FittedTransform | null = null;
    /** The version's own figures and published map (M15), shown while its pairs are unedited. */
    #own: OwnFit | null = null;
    #cityFrame: CityFrame | null = null;
    readonly intents: GeorefIntents;

    constructor(services: ContentServices, extras: ExtrasLoader) {
        this.#services = services;
        this.#placing = new PlacingMark(services);
        this.#extras = extras;
        this.#cell = new Store<GeorefState>(INITIAL_GEOREF, services.log);
        const { store, clock, denied } = services;
        this.#doc = new LiveDoc({
            store,
            clock,
            denied,
            schema: layerVersionDocSchema,
            changed: (state) => {
                this.#docChanged(state);
            },
        });
        this.#city = new LiveDoc({
            store,
            clock,
            denied,
            schema: cityDocSchema,
            changed: (state) => {
                this.#cityChanged(state);
            },
        });
        this.#map = new GeorefMap({
            ...{ maps: services.maps ?? null, locale: services.locale, log: services.log },
            status: (map) => {
                this.#cell.update({ map });
                this.#pictures.mapStatus(map);
            },
            clicked: (geo) => {
                this.#pickMap(geo);
            },
            moved: (id, geo) => {
                this.#edit(moveGeo(this.#cell.state.pairs, id, geo));
            },
            selected: (id) => {
                this.#cell.update({ selected: id });
            },
        });
        this.#pictures = new GeorefPictures({
            ...{ files: services.files ?? NO_FILES, pictures: services.pictures ?? null, clock, overlays: this.#map.overlays },
            scan: (scan) => {
                this.#cell.update({ scan });
            },
        });
        this.intents = { ...this.#pairIntents(), ...this.#suggestionIntents(), ...this.#pageIntents() };
    }

    get state(): GeorefState {
        return this.#cell.state;
    }

    subscribe(listener: (state: GeorefState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        const id = params[0] ?? '';
        if (id === this.#cell.state.versionId) {
            return;
        }
        this.close();
        this.#city.show(FIRESTORE_PATHS.city(this.#services.cityId));
        if (isId(id)) {
            this.#cell.update({ versionId: id });
            this.#doc.show(FIRESTORE_PATHS.layerVersion(this.#services.cityId, id));
        } else {
            this.#cell.update({ versionId: id, notFound: true, doc: { status: 'ready', reconnecting: false, failure: null } });
        }
    }

    close(): void {
        this.#doc.stop();
        this.#city.stop();
        this.#map.detach();
        this.#pictures.clear();
        this.#suggestions.reset();
        this.#placing.reset();
        this.#base = { pairs: [], transform: 'affine' };
        this.#transform = null;
        this.#own = null;
        this.#cell.update({ ...INITIAL_GEOREF, thresholdM: this.#cell.state.thresholdM });
    }

    hasUnsavedChanges(): boolean {
        return this.#cell.state.dirty;
    }

    destroy(): void {
        this.close();
    }

    /** The matcher's suggestions: accepted into the pairs (unsaved until Save), rejected for this visit, selected. */
    #suggestionIntents(): Pick<GeorefIntents, SuggestionIntent> {
        return {
            acceptSuggestion: (id) => {
                this.#edit(this.#suggestions.accepted(this.#cell.state.pairs, id));
            },
            acceptAllSuggestions: () => {
                this.#edit(this.#suggestions.accepted(this.#cell.state.pairs));
            },
            rejectSuggestion: (id) => {
                this.#suggestions.reject(id);
                this.#showSuggestions();
            },
            selectSuggestion: (id) => {
                this.#suggestions.select(id);
                this.#showSuggestions();
            },
        };
    }

    /** The pairs: made, moved, selected, removed, kept as checkpoints. */
    #pairIntents(): Pick<GeorefIntents, PairIntent> {
        const pairs = (): GeorefState['pairs'] => this.#cell.state.pairs;
        return {
            setAdding: (adding) => {
                this.#setAdding(adding);
            },
            pickScan: (pixel) => {
                this.#pickScan(pixel);
            },
            addAtCentres: (pixel) => {
                this.#addAtCentres(pixel);
            },
            movePixel: (id, pixel) => {
                this.#movePixel(id, pixel);
            },
            moveGeo: (id, geo) => {
                this.#edit(moveGeo(pairs(), id, geo));
            },
            select: (id) => {
                this.#select(id);
            },
            remove: (id) => {
                this.#edit(withoutPair(pairs(), id));
            },
            toggle: (id) => {
                this.#edit(togglePair(pairs(), id));
            },
            cancelHalf: () => {
                this.#escape();
            },
        };
    }

    /** The rest of the page: the transform, the reference, the preview, the panes, Save and the map. */
    #pageIntents(): Omit<GeorefIntents, PairIntent | SuggestionIntent> {
        return {
            retry: () => {
                this.#doc.retry();
            },
            setTransform: (kind) => {
                this.#refit(this.#cell.state.pairs, kind);
            },
            setReference: (kind) => {
                this.#setReference(kind);
            },
            setPreviewOpacity: (percent) => {
                this.#setOpacity(percent);
            },
            togglePreview: (show) => {
                this.#togglePreview(show);
            },
            setPane: (pane) => {
                this.#cell.update({ pane });
            },
            save: () => this.#save(),
            snap: () => this.#snap(),
            discard: () => {
                this.#refit(this.#base.pairs, this.#base.transform);
            },
            attachMap: (container) => {
                this.#map.attach(container);
            },
            zoomBy: (delta) => {
                this.#map.zoomBy(delta);
            },
        };
    }

    #docChanged(state: DocState<LayerVersionDoc>): void {
        const doc = state.doc;
        const version = doc === null ? null : georefVersionOf(doc.id, doc.data);
        const { status, reconnecting, failure } = state;
        this.#cell.update({ doc: { status, reconnecting, failure }, version, notFound: status === 'ready' && doc === null });
        if (doc !== null && version !== null) {
            this.#loaded(doc.data, version);
        }
    }

    /** A new snapshot of the version: its pairs become the base (an edit in progress is kept). */
    #loaded(doc: LayerVersionDoc, version: GeorefVersion): void {
        this.#base = baseOf(doc);
        this.#own = ownFitOf(doc.georef);
        void this.#published(this.#own);
        this.#suggestions.load(doc);
        this.#frame();
        this.#pictures.load(version, this.#cell.state.reference);
        this.#cell.update({ reference: this.#pictures.reference });
        if (this.#cell.state.dirty) {
            this.#showSuggestions();
        } else {
            this.#refit(this.#base.pairs, this.#base.transform);
        }
    }

    /** M15: the map a lattice or terrain publishes, once the chunk is in (`extras.ts`), unless another snapshot or Save replaced it. */
    async #published(own: OwnFit | null): Promise<void> {
        const shown = await publishedOf(this.#services, this.#extras, own);
        if (shown !== own && this.#own === own) {
            this.#own = shown;
            this.#refit(this.#cell.state.pairs, this.#cell.state.transform);
        }
    }

    /** The map opens on the reference's box, else the city's, once one is known. */
    #frame(): void {
        const frame = referenceFrame(this.#cell.state.version) ?? this.#cityFrame;
        if (frame !== null) {
            this.#map.setFrame(frame);
        }
    }

    #cityChanged(state: DocState<CityDoc>): void {
        const city = state.doc?.data;
        if (city !== undefined) {
            this.#cityFrame = frameOf(city);
            this.#frame();
            this.#cell.update({ thresholdM: imagerySettingsOf(city.imagery).rmseThresholdM });
            this.#refit(this.#cell.state.pairs, this.#cell.state.transform);
        }
    }

    #setAdding(adding: boolean): void {
        this.#cell.update({ adding, half: null });
        this.#map.setAdding(adding);
    }

    /**
     * Half a pair on the scan: the map's end comes next. On a compact window, where one pane shows at a time, the map
     * pane opens by itself (CR-M3-47); side by side the pane state changes nothing.
     */
    #pickScan(pixel: PixelPosition): void {
        const { adding, half } = this.#cell.state;
        if (!adding) {
            return;
        }
        if (half !== null && 'geo' in half) {
            this.#complete(pixel, half.geo, true);
            return;
        }
        this.#cell.update({ half: { pixel: this.#scanPixel(pixel) }, pane: 'map' });
    }

    /** Half a pair on the map: the scan's end comes next (its pane opens on a compact window). */
    #pickMap(geo: GeoPosition): void {
        const { adding, half } = this.#cell.state;
        if (!adding) {
            return;
        }
        if (half !== null && 'pixel' in half) {
            this.#complete(half.pixel, geo, true);
            return;
        }
        this.#cell.update({ half: { geo }, pane: 'scan' });
    }

    /**
     * The keyboard's pair: the scan's crosshair and the map's centre. It is not selected (CR-M3-47): the arrow keys keep
     * panning to the next place instead of moving the pair just placed.
     */
    #addAtCentres(pixel: PixelPosition): void {
        const centre = this.#map.centre;
        if (centre !== null) {
            this.#complete(pixel, centre, false);
        }
    }

    /** A new pair; one placed by pointer is selected (the table and the markers show it), one placed by keyboard is not. */
    #complete(pixel: PixelPosition, geo: GeoPosition, select: boolean): void {
        const pairs = withPair(this.#cell.state.pairs, this.#scanPixel(pixel), geo);
        this.#cell.update({ half: null, selected: select ? (pairs.at(-1)?.id ?? null) : null });
        this.#edit(pairs);
    }

    /** Esc: a half pair is dropped; without one, the selected pair is let go (the arrow keys pan again). */
    #escape(): void {
        if (this.#cell.state.half !== null) {
            this.#cell.update({ half: null });
            return;
        }
        this.#select(null);
    }

    /** A pixel kept inside the scan, to a hundredth. */
    #scanPixel(pixel: PixelPosition): PixelPosition {
        const scan = this.#cell.state.version?.scan ?? UNBOUNDED;
        return roundPixel(pixel, scan.width, scan.height);
    }

    #movePixel(id: string, pixel: PixelPosition): void {
        this.#edit(movePixel(this.#cell.state.pairs, id, this.#scanPixel(pixel)));
    }

    #select(id: string | null): void {
        this.#cell.update({ selected: id });
        this.#map.showPairs(this.#cell.state.pairs, id);
    }

    #edit(pairs: readonly Gcp[]): void {
        if (!this.#services.readOnly()) {
            this.#refit(pairs, this.#cell.state.transform);
            this.#placing.edited(this.#doc.state.doc?.data ?? null);
        }
    }

    /** The pairs and the transform as edited: fitted again (the version's own map while unedited), the map and the preview follow. */
    #refit(pairs: readonly Gcp[], transform: GeorefTransform): void {
        const dirty = transform !== this.#base.transform || !samePairs(pairs, this.#base.pairs);
        const { thresholdM } = this.#cell.state;
        const fitted = shownFit(fitOf(transform, pairs, thresholdM), this.#own, dirty, thresholdM);
        this.#transform = fitted.transform;
        this.#cell.update({ pairs, transform, fit: fitted.view, dirty, refusal: null });
        this.#map.showPairs(pairs, this.#cell.state.selected);
        this.#showSuggestions();
        this.#warp();
    }

    /** The suggestions still to decide, on the panel and the map (the scan pane reads them from the state). */
    #showSuggestions(): void {
        const suggestions = this.#suggestions.view(this.#cell.state.pairs, this.#transform);
        this.#cell.update({ suggestions });
        this.#map.showSuggestions(suggestions.pending, suggestions.selected);
    }

    #warp(): void {
        const { version, showPreview, previewOpacity } = this.#cell.state;
        this.#pictures.warp(showPreview ? this.#transform : null, version?.scan ?? null, previewOpacity);
    }

    #setReference(kind: ReferenceKind): void {
        const version = this.#cell.state.version;
        if (version !== null) {
            this.#pictures.load(version, kind);
            this.#cell.update({ reference: this.#pictures.reference });
            this.#warp();
        }
    }

    #setOpacity(percent: number): void {
        const previewOpacity = clamp(Math.round(percent), 0, 100) / 100;
        this.#cell.update({ previewOpacity });
        this.#pictures.setOpacity(previewOpacity);
    }

    #togglePreview(show: boolean): void {
        this.#cell.update({ showPreview: show });
        this.#warp();
    }

    async #save(): Promise<boolean> {
        const request = saveRequestOf(this.#services.cityId, this.#cell.state);
        if (request === null) {
            return false;
        }
        this.#cell.update({ saving: true, refusal: null });
        try {
            const answer = await callImagery(this.#services.callables, 'imagery.saveGcps', request);
            this.#base = { pairs: this.#cell.state.pairs, transform: request.transform };
            this.#own = null;
            this.#cell.update({ saving: false, dirty: false, saved: answer.versionId });
            this.#services.notify({ key: answer.resumed ? 'adminContent.georef.savedResumed' : 'adminContent.georef.savedNew' });
            return true;
        } catch (error) {
            this.#cell.update({ saving: false, refusal: refusalOf(error) });
            return false;
        }
    }

    /** M16: Snap my points (`snap.ts`, in the chunk `extras.ts` fetches); the page then opens the version they make. */
    async #snap(): Promise<boolean> {
        this.#cell.update({ saving: true, refusal: null });
        const outcome = await snapOf(this.#services, this.#extras, { ...this.#cell.state, base: this.#base.pairs });
        if (outcome.saved !== null) {
            this.#refit(this.#base.pairs, this.#base.transform);
        }
        this.#cell.update({ saving: false, ...outcome });
        return outcome.saved !== null;
    }
}

/** The area; `extras` replaces the lazy chunk's fetch (the tests' failed fetch). */
export function georefModule(extras: ExtrasLoader = loadGeorefExtras): AreaModule<GeorefState, GeorefIntents> {
    return { area: 'georef', create: (services) => new GeorefStore(services, extras) };
}

export const GEOREF_MODULE = georefModule();
