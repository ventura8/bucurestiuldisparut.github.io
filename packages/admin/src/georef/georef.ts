/** The georeferencer store (`#/georef/<versionId>`, M3 §6, §10.4; A16 / A131). */

import {
    cityDocSchema,
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
import { NO_FILES } from '../imagery/files.js';
import { frameOf, type CityFrame } from '../layers/map-session.js';
import { Store } from '../state/store.js';
import { loadGeorefExtras, publishedOf, type ExtrasLoader } from './extras.js';
import { baseOf, fitOf, ownFitOf, shownFit, type OwnFit } from './fit-view.js';
import { GeorefMap, referenceFrame } from './georef-map.js';
import { GeorefPictures } from './georef-pictures.js';
import { PairHistory } from './history.js';
import { moveGeo, movePixel, roundPixel, samePairs, withPair, type GeoPosition, type PixelPosition } from './pairs.js';
import { georefIntentsOf, type GeorefIntentActions } from './intents.js';
import { saveGeoref, snapGeoref, type PersistHost } from './persist.js';
import { PlacingMark } from './placing.js';
import { georefVersionOf, INITIAL_GEOREF, type GeorefIntents, type GeorefState, type GeorefVersion, type ReferenceKind } from './state.js';
import { Suggestions } from './suggestions.js';
import { tonesOf } from './tones.js';

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
    #base: { readonly pairs: readonly Gcp[]; readonly transform: GeorefTransform } = { pairs: [], transform: 'affine' };
    readonly #history = new PairHistory();
    #transform: FittedTransform | null = null;
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
        this.intents = georefIntentsOf(this.#intentActions());
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
        this.#history.clear();
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

    #intentActions(): GeorefIntentActions {
        return {
            cell: this.#cell,
            map: this.#map,
            pictures: this.#pictures,
            history: this.#history,
            doc: this.#doc,
            suggestions: this.#suggestions,
            base: () => this.#base,
            edit: (pairs, remember = true) => {
                this.#edit(pairs, remember);
            },
            refit: (pairs, transform) => {
                this.#refit(pairs, transform);
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
            select: (id) => {
                this.#select(id);
            },
            escape: () => {
                this.#escape();
            },
            setReference: (kind) => {
                this.#setReference(kind);
            },
            warp: () => {
                this.#warp();
            },
            showSuggestions: () => {
                this.#showSuggestions();
            },
            save: () => this.#save(),
            snap: () => this.#snap(),
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

    async #published(own: OwnFit | null): Promise<void> {
        const shown = await publishedOf(this.#services, this.#extras, own);
        if (shown !== own && this.#own === own) {
            this.#own = shown;
            this.#refit(this.#cell.state.pairs, this.#cell.state.transform);
        }
    }

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
        this.#syncHalf();
    }

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
        this.#syncHalf();
    }

    #addAtCentres(pixel: PixelPosition): void {
        const centre = this.#map.centre;
        if (centre !== null) {
            this.#complete(pixel, centre, false);
        }
    }

    #complete(pixel: PixelPosition, geo: GeoPosition, select: boolean): void {
        const pairs = withPair(this.#cell.state.pairs, this.#scanPixel(pixel), geo);
        this.#cell.update({ half: null, selected: select ? (pairs.at(-1)?.id ?? null) : null });
        this.#syncHalf();
        this.#edit(pairs);
    }

    #escape(): void {
        if (this.#cell.state.half !== null) {
            this.#cell.update({ half: null });
            this.#syncHalf();
            return;
        }
        this.#select(null);
    }

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

    #edit(pairs: readonly Gcp[], remember = true): void {
        if (this.#skipEdit(pairs, remember)) {
            return;
        }
        this.#history.note(this.#cell.state.pairs, remember);
        this.#refit(pairs, this.#cell.state.transform);
        const doc = this.#doc.state.doc;
        this.#placing.edited(doc === null ? null : doc.data);
    }

    #skipEdit(pairs: readonly Gcp[], remember: boolean): boolean {
        return this.#services.readOnly() || (remember && samePairs(pairs, this.#cell.state.pairs));
    }

    #refit(pairs: readonly Gcp[], transform: GeorefTransform): void {
        const dirty = transform !== this.#base.transform || !samePairs(pairs, this.#base.pairs);
        const { thresholdM } = this.#cell.state;
        const fitted = shownFit(fitOf(transform, pairs, thresholdM), this.#own, dirty, thresholdM);
        this.#transform = fitted.transform;
        this.#cell.update({ pairs, transform, fit: fitted.view, dirty, canUndo: this.#history.canUndo, refusal: null });
        this.#map.showPairs(pairs, this.#cell.state.selected);
        this.#map.setTones(tonesOf(fitted.view.residuals, thresholdM));
        this.#syncHalf();
        this.#showSuggestions();
        this.#warp();
    }

    #syncHalf(): void {
        const half = this.#cell.state.half;
        this.#map.setHalf(half !== null && 'geo' in half ? half.geo : null);
    }

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

    #save(): Promise<boolean> {
        return saveGeoref(this.#persistHost());
    }

    #snap(): Promise<boolean> {
        return snapGeoref(this.#persistHost());
    }

    #persistHost(): PersistHost {
        return {
            services: this.#services,
            cell: this.#cell,
            history: this.#history,
            extras: this.#extras,
            base: () => this.#base,
            setBase: (value) => {
                this.#base = value;
            },
            own: () => this.#own,
            setOwn: (value) => {
                this.#own = value;
            },
            refit: (pairs, transform) => {
                this.#refit(pairs, transform);
            },
        };
    }
}

export function georefModule(extras: ExtrasLoader = loadGeorefExtras): AreaModule<GeorefState, GeorefIntents> {
    return { area: 'georef', create: (services) => new GeorefStore(services, extras) };
}

export const GEOREF_MODULE = georefModule();
