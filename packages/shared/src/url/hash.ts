/**
 * URL-hash codec v1 of the public viewer (docs/ENGINE_API.md → URL hash).
 *
 *     #<zoom>/<lat>/<lng>[/<bearing>][&layers=<id>,<id>][&opacity=<0..1>][&op=<id>:<0..100>,...][&photo=<id>][&lang=ro|en]
 *
 * Decoding is defensive: the hash is visitor input. Numbers must be plain decimals, every range is
 * clamped, ids must match `ID_PATTERN` (anything else is dropped, never put into a selector), unknown
 * parameters are ignored and a hash longer than `MAX_HASH_LENGTH` is ignored as a whole. The legacy
 * hash of the 2015–2022 site, `#zoom/lat/lng/rotation/!a3!p2`, decodes to its map view; its layer
 * codes (`!…`) are ignored and `legacy` tells the viewer to rewrite the hash in the v1 form.
 */
import { clampToBBox, type BBox } from '../geo/bbox.js';
import { clamp, MAX_MERCATOR_LAT, roundTo, wrapBearing, type LngLat } from '../geo/math.js';
import type { Locale } from '../i18n/index.js';
import { isId } from '../schemas/primitives.js';

/** Hashes longer than this are ignored (a link that long was not made by the viewer). */
export const MAX_HASH_LENGTH = 2048;

/** At most this many overlay opacities are read from one `op=` parameter. */
export const MAX_OVERLAY_ENTRIES = 50;

export interface MapView {
    readonly center: LngLat;
    readonly zoom: number;
    /** Degrees clockwise from north, `[0, 360)`. */
    readonly bearing: number;
}

/** Everything the hash can carry; an absent field means "not in the hash", so the viewer keeps its default. */
export interface HashState {
    readonly view?: MapView;
    /** Visible historical layers; `[]` means "none" (`&layers=`). */
    readonly layers?: readonly string[];
    /** Opacity of the visible historical layers, `[0, 1]` (the V05 slider). */
    readonly opacity?: number;
    /** Per-overlay opacity, `[0, 1]`, keyed by overlay id (PLAN Addendum 3); wins over `opacity`. */
    readonly overlayOpacity?: Readonly<Record<string, number>>;
    readonly photo?: string;
    readonly lang?: Locale;
}

export interface DecodedHash extends HashState {
    /** True when the hash had the legacy `!…` layer codes: rewrite it with `encodeHash`. */
    readonly legacy: boolean;
}

/** Ranges the decoded view is clamped to; the viewer passes the city's zoom range and bounds. */
export interface HashLimits {
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly bounds?: BBox;
}

export const DEFAULT_HASH_LIMITS: HashLimits = { minZoom: 0, maxZoom: 22 };

const DECIMAL = /^-?\d{1,4}(?:\.\d{1,12})?$/;
const LOCALES: readonly Locale[] = ['ro', 'en'];

/** A plain decimal (`-12.5`, `14`), or null for anything else (`1e3`, `Infinity`, `0x10`, blanks). */
function parseDecimal(text: string): number | null {
    return DECIMAL.test(text) ? Number(text) : null;
}

// ---- encoding -----------------------------------------------------------------------------------

function encodeView(view: MapView): string {
    const position = [roundTo(view.zoom, 2), roundTo(view.center[1], 5), roundTo(view.center[0], 5)].map(String).join('/');
    const bearing = roundTo(wrapBearing(view.bearing), 1);
    return bearing === 0 ? position : `${position}/${String(bearing)}`;
}

function encodeOverlays(overlays: Readonly<Record<string, number>>): string | null {
    const entries = Object.entries(overlays)
        .filter(([id]) => isId(id))
        .map(([id, value]) => `${id}:${String(Math.round(clamp(value, 0, 1) * 100))}`);
    return entries.length === 0 ? null : `op=${entries.join(',')}`;
}

type Encoder = (state: HashState) => string | null;

/** One encoder per field, in the order the parameters appear in the hash. */
const ENCODERS: readonly Encoder[] = [
    (state) => (state.view === undefined ? null : encodeView(state.view)),
    (state) => (state.layers === undefined ? null : `layers=${state.layers.filter((id) => isId(id)).join(',')}`),
    (state) => (state.opacity === undefined ? null : `opacity=${String(roundTo(clamp(state.opacity, 0, 1), 2))}`),
    (state) => (state.overlayOpacity === undefined ? null : encodeOverlays(state.overlayOpacity)),
    (state) => (state.photo !== undefined && isId(state.photo) ? `photo=${state.photo}` : null),
    (state) => (state.lang === undefined ? null : `lang=${state.lang}`),
];

/** The v1 hash for `state`, with its leading `#`, or `''` when there is nothing to encode. */
export function encodeHash(state: HashState): string {
    const parts = ENCODERS.map((encoder) => encoder(state)).filter((part) => part !== null);
    return parts.length === 0 ? '' : `#${parts.join('&')}`;
}

// ---- decoding -----------------------------------------------------------------------------------

function clampCenter(center: LngLat, limits: HashLimits): LngLat {
    const world: LngLat = [clamp(center[0], -180, 180), clamp(center[1], -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)];
    return limits.bounds === undefined ? world : clampToBBox(world, limits.bounds);
}

function isNumber(value: number | null): value is number {
    return value !== null;
}

/** The `zoom/lat/lng[/bearing]` segment (v1), or `zoom/lat/lng/rotation/!a3!p2` (legacy). */
function decodeView(segment: string, limits: HashLimits): { view?: MapView; legacy: boolean } {
    const parts = segment.split('/');
    const legacy = parts.some((part) => part.startsWith('!'));
    const numbers = parts.filter((part) => !part.startsWith('!')).map(parseDecimal);
    if (numbers.length < 3 || numbers.length > 4 || !numbers.every(isNumber)) {
        return { legacy };
    }
    // Three or four plain decimals, checked just above.
    const [zoom, lat, lng, bearing] = numbers as [number, number, number, number?];
    const view: MapView = {
        zoom: clamp(zoom, limits.minZoom, limits.maxZoom),
        center: clampCenter([lng, lat], limits),
        bearing: wrapBearing(bearing ?? 0),
    };
    return { view, legacy };
}

function decodeIds(value: string): string[] {
    return [...new Set(value.split(',').filter((id) => isId(id)))];
}

function decodeOverlayEntry(entry: string): [string, number] | null {
    const [id, percent, ...extra] = entry.split(':');
    const value = percent === undefined || extra.length > 0 ? null : parseDecimal(percent);
    return isId(id) && value !== null ? [id, clamp(value, 0, 100) / 100] : null;
}

function decodeOverlays(value: string): Partial<HashState> {
    const entries = value
        .split(',')
        .slice(0, MAX_OVERLAY_ENTRIES)
        .map(decodeOverlayEntry)
        .filter((entry) => entry !== null);
    return entries.length === 0 ? {} : { overlayOpacity: Object.fromEntries(entries) };
}

function decodeOpacity(value: string): Partial<HashState> {
    const opacity = parseDecimal(value);
    return opacity === null ? {} : { opacity: clamp(opacity, 0, 1) };
}

type ParamDecoder = (value: string) => Partial<HashState>;

function decodeLang(value: string): Partial<HashState> {
    const lang = LOCALES.find((locale) => locale === value);
    return lang === undefined ? {} : { lang };
}

/** A Map, not an object literal: a key such as `constructor` or `__proto__` must find nothing. */
const PARAM_DECODERS: ReadonlyMap<string, ParamDecoder> = new Map<string, ParamDecoder>([
    ['layers', (value) => ({ layers: decodeIds(value) })],
    ['opacity', decodeOpacity],
    ['op', decodeOverlays],
    ['photo', (value) => (isId(value) ? { photo: value } : {})],
    ['lang', decodeLang],
]);

function decodeParam(segment: string): Partial<HashState> {
    const separator = segment.indexOf('=');
    const decoder = separator < 0 ? undefined : PARAM_DECODERS.get(segment.slice(0, separator));
    return decoder === undefined ? {} : decoder(segment.slice(separator + 1));
}

/** The first segment: the map view, or already a parameter (`#photo=x`). */
function decodeHead(first: string, limits: HashLimits): DecodedHash {
    return first.includes('=') ? { legacy: false, ...decodeParam(first) } : decodeView(first, limits);
}

/**
 * Reads a v1 or legacy hash (with or without its `#`). Never throws: whatever cannot be read is left
 * out of the result, and a repeated parameter keeps its last valid value.
 */
export function decodeHash(raw: string, limits: HashLimits = DEFAULT_HASH_LIMITS): DecodedHash {
    const text = raw.startsWith('#') ? raw.slice(1) : raw;
    if (text.length === 0 || text.length > MAX_HASH_LENGTH) {
        return { legacy: false };
    }
    // String.split always returns at least one element.
    const [first, ...rest] = text.split('&') as [string, ...string[]];
    return rest.reduce<DecodedHash>((state, segment) => ({ ...state, ...decodeParam(segment) }), decodeHead(first, limits));
}
