/**
 * The URL hash and the viewer state (docs/ENGINE_API.md → URL hash v1), through the codec of @hcm/shared. Reading
 * applies a decoded hash to the state (unknown ids ignored, opacities clamped by the codec and the overlay model);
 * writing encodes what differs from the manifest defaults and replaces the hash at most once per `HASH_WRITE_DELAY_MS`
 * (`history.replaceState`, so the back button is not flooded while the map moves).
 */
import {
    encodeHash,
    hashOverlayOpacity,
    PHOTOS_OVERLAY_ID,
    withHashOpacity,
    type DecodedHash,
    type HashLimits,
    type HashState,
    type Locale,
    type Manifest,
    type Overlay,
} from '@hcm/shared';

import { withVisibleLayers, type ViewerState } from './state.js';
import { yearOfLayers } from './timeline.js';

/** How long the hash waits for the map to settle before it is written. */
export const HASH_WRITE_DELAY_MS = 300;

/** The ranges a hash of this city is read with: its zoom range, its bounds, its overlay ids. */
export function hashLimits(manifest: Manifest): HashLimits {
    const categories = (manifest.poiCategories ?? []).map((category) => category.id);
    const overlayIds = new Set([...manifest.layers.map((layer) => layer.id), PHOTOS_OVERLAY_ID, ...categories]);
    return { minZoom: manifest.city.minZoom, maxZoom: manifest.city.maxZoom, bounds: manifest.city.bounds, overlayIds };
}

export interface AppliedHash {
    readonly state: ViewerState;
    /** A `photo=` id the manifest does not have (the viewer shows `error.unknownPhoto`). */
    readonly unknownPhoto: string | null;
}

function withHashLayers(state: ViewerState, layers: readonly string[] | undefined): ViewerState {
    if (layers === undefined || state.manifest === null) {
        return state;
    }
    const overlays = withVisibleLayers(state.overlays, new Set(layers));
    return { ...state, overlays, year: yearOfLayers(state.manifest.layers, layers) };
}

function withHashPhoto(state: ViewerState, photo: string | undefined): AppliedHash {
    if (photo === undefined) {
        return { state, unknownPhoto: null };
    }
    const known = state.manifest?.photos.some((candidate) => candidate.id === photo) === true;
    return known
        ? { state: { ...state, selectedPhotoId: photo, selectedPoiId: null, sheet: 'photo' }, unknownPhoto: null }
        : { state, unknownPhoto: photo };
}

/** `hash` applied to `state`: the view, the visible layers (and their year), the opacities, the photo, the language. */
export function applyDecodedHash(state: ViewerState, hash: DecodedHash): AppliedHash {
    const withView = hash.view === undefined ? state : { ...state, view: hash.view };
    const withLayers = withHashLayers(withView, hash.layers);
    const overlays = withHashOpacity(withLayers.overlays, hash);
    const withLang = hash.lang === undefined ? withLayers : { ...withLayers, locale: hash.lang };
    return withHashPhoto(overlays === withLang.overlays ? withLang : { ...withLang, overlays }, hash.photo);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
}

/** `layers=` only when the visible historical layers differ from the manifest's default-visible ones. */
function hashLayers(overlays: readonly Overlay[]): Pick<HashState, 'layers'> {
    const rasters = overlays.filter((overlay) => overlay.kind === 'raster');
    const visible = rasters.filter((overlay) => overlay.visible).map((overlay) => overlay.id);
    const defaults = rasters.filter((overlay) => overlay.defaultVisible).map((overlay) => overlay.id);
    return sameIds(visible, defaults) ? {} : { layers: visible };
}

/** What the hash carries for `state`; `defaultLocale` (the page's language) is left out. */
export function hashStateOf(state: ViewerState, defaultLocale: Locale): HashState {
    const overlayOpacity = hashOverlayOpacity(state.overlays);
    return {
        view: state.view,
        ...hashLayers(state.overlays),
        ...(overlayOpacity === undefined ? {} : { overlayOpacity }),
        ...(state.selectedPhotoId === null ? {} : { photo: state.selectedPhotoId }),
        ...(state.locale === defaultLocale ? {} : { lang: state.locale }),
    };
}

export interface HashLocation {
    readonly hash: string;
    replaceHash(hash: string): void;
}

/** Writes the hash at most once per `HASH_WRITE_DELAY_MS`, with the state of the moment it is written. */
export class HashWriter {
    readonly #location: HashLocation;
    readonly #encode: () => string;
    #timer: ReturnType<typeof setTimeout> | null = null;

    constructor(location: HashLocation, encode: () => string) {
        this.#location = location;
        this.#encode = encode;
    }

    schedule(): void {
        this.#timer ??= setTimeout(() => {
            this.#timer = null;
            this.flush();
        }, HASH_WRITE_DELAY_MS);
    }

    /** Writes now (a legacy hash is rewritten at once); an unchanged hash is not written again. */
    flush(): void {
        this.cancel();
        const hash = this.#encode();
        if (hash !== this.#location.hash) {
            this.#location.replaceHash(hash);
        }
    }

    cancel(): void {
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }
}

/** The encoded hash of `state` (`''` before the manifest loads: nothing to share yet). */
export function encodeViewerHash(state: ViewerState, defaultLocale: Locale): string {
    return state.manifest === null ? '' : encodeHash(hashStateOf(state, defaultLocale));
}
