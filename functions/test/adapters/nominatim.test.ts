/**
 * The Nominatim adapter (`functions/src/adapters/nominatim.ts`, `docs/research/M4-interfaces.md` §4.2) against the shared
 * fake Nominatim: the request Nominatim's usage policy asks for (the application's User-Agent, the cell's centre, zoom
 * 18, names and address details), the places it knows (a named building with its English name, a road in its sector, a
 * quarter only, the open sea), a mirror's address, and its refusals and failures. No network.
 */
import { NOMINATIM_ATTRIBUTION, NOMINATIM_USER_AGENT } from '@hcm/shared';
import { createFakeFetch, createUpstreamFakes, jsonResponse, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createNominatim } from '../../src/adapters/nominatim.js';
import { UpstreamError } from '../../src/ports/errors.js';

const OSM_LICENCE = 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright';

function nominatim() {
    const fakes = createUpstreamFakes();
    return { fakes, geocoder: createNominatim({ fetch: fakes.fetch }) };
}

describe('reverse', () => {
    it('happyPath_aNamedBuildingAnswersItsNamesRoadAndArea', async () => {
        const { fakes, geocoder } = nominatim();

        await expect(geocoder.reverse({ lat: 44.4413, lng: 26.0973, lang: 'ro' })).resolves.toEqual({
            name: 'Ateneul Român',
            nameEn: 'Romanian Athenaeum',
            road: 'Strada Benjamin Franklin',
            area: 'Sector 1',
            licence: OSM_LICENCE,
        });
        const [call] = fakes.callsTo('nominatim.reverse');
        const query = new URL(String(call?.url)).searchParams;
        expect(Object.fromEntries(query)).toEqual({
            format: 'jsonv2',
            lat: '44.4413',
            lon: '26.0973',
            zoom: '18',
            addressdetails: '1',
            namedetails: '1',
            'accept-language': 'ro',
        });
        expect(call?.headers['user-agent']).toBe(NOMINATIM_USER_AGENT);
    });

    it('happyPath_aRoadInItsSectorHasNoEnglishName', async () => {
        const { geocoder } = nominatim();

        await expect(geocoder.reverse({ lat: 44.4355, lng: 26.0974, lang: 'en' })).resolves.toEqual({
            name: 'Calea Victoriei',
            road: 'Calea Victoriei',
            area: 'Sector 1',
            licence: OSM_LICENCE,
        });
    });

    it('happyPath_aQuarterWithoutAnyNamedObject', async () => {
        const { geocoder } = nominatim();

        await expect(geocoder.reverse({ lat: 44.4325, lng: 26.07, lang: 'ro' })).resolves.toEqual({
            area: 'Cotroceni',
            licence: OSM_LICENCE,
        });
    });

    it('badPath_theOpenSeaIsNoPlace', async () => {
        const { geocoder } = nominatim();

        await expect(geocoder.reverse({ lat: 43.0, lng: 31.0, lang: 'ro' })).resolves.toBeUndefined();
    });

    it('happyPath_aMirrorIsAskedAtItsOwnAddressAndAnAnswerWithoutLicenceGetsOsmsLine', async () => {
        const upstream = createFakeFetch(
            routeTable([
                route('GET', 'https://mirror.e2e.test/nominatim/reverse', 'mirror.reverse', () => jsonResponse({ name: 'Piața' })),
            ]),
        );
        const geocoder = createNominatim({ fetch: upstream.fetch, url: 'https://mirror.e2e.test/nominatim/reverse' });

        await expect(geocoder.reverse({ lat: 44.43, lng: 26.1, lang: 'ro' })).resolves.toEqual({
            name: 'Piața',
            licence: NOMINATIM_ATTRIBUTION,
        });
    });

    it.each([
        ['rateLimited', 429],
        ['unavailable', 503],
    ] as const)('badPath_aFakeIn_%s_isThatFailure', async (mode, status) => {
        const { fakes, geocoder } = nominatim();
        fakes.fail('nominatim', mode);

        await expect(geocoder.reverse({ lat: 44.4, lng: 26.1, lang: 'ro' })).rejects.toEqual(
            new UpstreamError('nominatim', mode, { status }),
        );
    });

    it.each([
        ['a refusal by policy is a rate limit', 403, 'rateLimited'],
        ['a bad request is invalid', 400, 'invalid'],
    ] as const)('badPath_%s', async (_name, status, failure) => {
        const upstream = createFakeFetch(
            routeTable([route('GET', 'https://nominatim.openstreetmap.org/reverse', 'nominatim.reverse', () => jsonResponse({}, status))]),
        );

        const error = await createNominatim({ fetch: upstream.fetch })
            .reverse({ lat: 44.4, lng: 26.1, lang: 'ro' })
            .catch((caught: unknown) => caught);

        expect(error).toMatchObject({ service: 'nominatim', failure, status });
    });

    it.each([
        ['an HTML page', () => new Response('<html></html>', { status: 200 })],
        ['a list', () => jsonResponse([])],
    ])('badPath_%s_isInvalid', async (_name, answer) => {
        const upstream = createFakeFetch(
            routeTable([route('GET', 'https://nominatim.openstreetmap.org/reverse', 'nominatim.reverse', answer)]),
        );

        await expect(createNominatim({ fetch: upstream.fetch }).reverse({ lat: 44.4, lng: 26.1, lang: 'ro' })).rejects.toMatchObject({
            service: 'nominatim',
            failure: 'invalid',
        });
    });
});
