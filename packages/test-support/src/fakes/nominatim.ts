import { fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { route, type Route } from './routes.js';
import type { FailureMode, ServiceFake } from './service.js';

/**
 * Nominatim reverse geocoding (`nominatim.openstreetmap.org/reverse`, the admin's address suggestion for a pin): a
 * point inside Romania answers the fixture's street with the point's own coordinates; anywhere else answers
 * `{"error": "Unable to geocode"}` with HTTP 200, as Nominatim does over the open sea.
 */

/** Romania's bounding box, generously: inside it the fake knows an address. */
const KNOWN_AREA = { south: 43.5, north: 48.3, west: 20.2, east: 29.8 } as const;

const FAILURES: Readonly<Partial<Record<FailureMode, FixtureName>>> = {
    unavailable: 'nominatim/error.unavailable',
    rateLimited: 'nominatim/error.rate-limited',
};

function inKnownArea(lat: number, lon: number): boolean {
    return lat >= KNOWN_AREA.south && lat <= KNOWN_AREA.north && lon >= KNOWN_AREA.west && lon <= KNOWN_AREA.east;
}

/** The `lat` and `lon` of a query, or undefined when either is missing or not a number. */
function pointOf(query: URLSearchParams): { readonly lat: number; readonly lon: number } | undefined {
    const [lat, lon] = [query.get('lat'), query.get('lon')].map((value) =>
        value === null || value.trim() === '' ? Number.NaN : Number(value),
    );
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: Number(lat), lon: Number(lon) } : undefined;
}

/** The fake Nominatim (stateless). */
export function createNominatimFake(): ServiceFake {
    const reverse: Route['answer'] = (request) => {
        const point = pointOf(request.url.searchParams);
        if (point === undefined) {
            return fixtureResponse('nominatim/reverse.unable', { status: 400 });
        }
        return inKnownArea(point.lat, point.lon)
            ? fixtureResponse('nominatim/reverse.ok', { merge: { lat: String(point.lat), lon: String(point.lon) } })
            : fixtureResponse('nominatim/reverse.unable');
    };
    return {
        name: 'nominatim',
        routes: [route('GET', 'https://nominatim.openstreetmap.org/reverse', 'nominatim.reverse', reverse)],
        failure: (mode) => {
            const name = FAILURES[mode];
            return name === undefined ? undefined : fixtureResponse(name);
        },
        scenarios: {},
        snapshot: () => ({}),
    };
}
