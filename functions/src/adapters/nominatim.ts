import { GEOCODE_ZOOM, NOMINATIM_ATTRIBUTION, NOMINATIM_REVERSE_URL, NOMINATIM_USER_AGENT } from '@hcm/shared';

import { UpstreamError } from '../ports/errors.js';
import type { Geocoder } from '../ports/geocoder.js';
import { at, readJson, send, stringAt, upstreamError, type Fetch } from './upstream-http.js';

/**
 * OpenStreetMap's Nominatim reverse geocoder (`docs/research/M4-interfaces.md` §4.2) over REST with `fetch`: one
 * `GET /reverse` of a cache cell's centre with the application's own User-Agent (the usage policy refuses a library's
 * default), no credential. Called only by the `assist-geocode` queue's worker, which keeps the whole project at one
 * request a second. The address is configuration (`HCM_NOMINATIM_URL`), so a mirror is a deploy-time change.
 *
 * Failures (`UpstreamError('nominatim', …)`): 429 or 403 (the policy's refusal) → `rateLimited`; 5xx, a timeout or the
 * network → `unavailable`; any other status or an answer that is not a JSON object → `invalid`. Nominatim answers a
 * place it cannot find with HTTP 200 and `{"error": "Unable to geocode"}`: that is no place (undefined), not a failure.
 */
type ReversePlace = NonNullable<Awaited<ReturnType<Geocoder['reverse']>>>;

const SERVICE = 'nominatim';

const REFUSED = new Set([403, 429]);

export interface NominatimOptions {
    readonly fetch: Fetch;
    /** `HCM_NOMINATIM_URL`, the reverse endpoint of a mirror; Nominatim's own when absent. */
    readonly url?: string;
}

/** The first of `keys` of the answer's `address` that holds a name. */
function firstOf(address: unknown, keys: readonly string[]): string | undefined {
    return keys.map((key) => stringAt(address, key)).find((value) => value !== undefined && value.trim() !== '');
}

/** A field only when it holds text (Nominatim sends an empty `name` for an unnamed road). */
function named(value: string | undefined): string | undefined {
    return value === undefined || value.trim() === '' ? undefined : value;
}

/** Only the fields that hold something: an absent field means OpenStreetMap has none there. */
function placeOf(body: unknown): ReversePlace {
    const address = at(body, 'address');
    const parts = {
        name: named(stringAt(body, 'name')),
        nameEn: named(stringAt(body, 'namedetails', 'name:en')),
        road: firstOf(address, ['road', 'pedestrian', 'square']),
        area: firstOf(address, ['suburb', 'quarter', 'neighbourhood']),
    };
    const present = Object.fromEntries(Object.entries(parts).filter((entry): entry is [string, string] => entry[1] !== undefined));
    return { ...present, licence: named(stringAt(body, 'licence')) ?? NOMINATIM_ATTRIBUTION };
}

function isObject(body: unknown): boolean {
    return typeof body === 'object' && body !== null && !Array.isArray(body);
}

function requestUrl(base: string, request: Parameters<Geocoder['reverse']>[0]): string {
    const url = new URL(base);
    url.search = new URLSearchParams({
        format: 'jsonv2',
        lat: String(request.lat),
        lon: String(request.lng),
        zoom: String(GEOCODE_ZOOM),
        addressdetails: '1',
        namedetails: '1',
        'accept-language': request.lang,
    }).toString();
    return url.toString();
}

export function createNominatim(options: NominatimOptions): Geocoder {
    const base = options.url ?? NOMINATIM_REVERSE_URL;
    return {
        reverse: async (request) => {
            const headers = { 'user-agent': NOMINATIM_USER_AGENT, accept: 'application/json' };
            const response = await send(options.fetch, SERVICE, requestUrl(base, request), { method: 'GET', headers });
            if (REFUSED.has(response.status)) {
                throw upstreamError(SERVICE, response, 'rateLimited');
            }
            if (!response.ok) {
                throw upstreamError(SERVICE, response);
            }
            const body = await readJson(response);
            if (!isObject(body)) {
                throw new UpstreamError(SERVICE, 'invalid', { status: response.status });
            }
            return stringAt(body, 'error') === undefined ? placeOf(body) : undefined;
        },
    };
}
