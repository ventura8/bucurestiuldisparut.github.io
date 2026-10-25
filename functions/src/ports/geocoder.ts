/**
 * OpenStreetMap's Nominatim reverse geocoder (M4, `docs/research/M4-interfaces.md` §4.2): one `GET /reverse` of a cache
 * cell's centre (`format=jsonv2`, `zoom` `GEOCODE_ZOOM`, `addressdetails=1`, `namedetails=1`, `accept-language` the
 * language asked), with `NOMINATIM_USER_AGENT` and no credential. Called only by the `assist-geocode` queue's worker,
 * which keeps the whole project at one request a second (Nominatim's usage policy). Adapter
 * `functions/src/adapters/nominatim.ts` (assists-notify); failures are `UpstreamError('nominatim', …)`: a 429 or a 403
 * `rateLimited` (the cool-down follows), a 5xx or a timeout `unavailable`, an unreadable answer `invalid`.
 */
interface ReverseRequest {
    /** The cell's centre (`geocodeCellCenter`), never the admin's own more precise place. */
    readonly lat: number;
    readonly lng: number;
    /** `accept-language`: the language of the names it answers with. */
    readonly lang: 'ro' | 'en';
}

/** What a reverse answer offers for titles (absent fields: OpenStreetMap has none there). */
interface ReversePlace {
    /** `name` of the object found (a building, a church, a square), in the language asked when it has one. */
    readonly name?: string;
    /** `namedetails['name:en']`. */
    readonly nameEn?: string;
    /** `address.road`, `address.pedestrian` or `address.square`. */
    readonly road?: string;
    /** `address.suburb`, `address.quarter` or `address.neighbourhood`. */
    readonly area?: string;
    /** `licence`, which the attribution repeats. */
    readonly licence: string;
}

export interface Geocoder {
    /** Undefined when Nominatim finds nothing at the place (`error: "Unable to geocode"`). */
    reverse(request: ReverseRequest): Promise<ReversePlace | undefined>;
}
