import { readFileSync } from 'node:fs';

import { createFakeFetch, E2E_PROJECT_CONFIG, jsonResponse } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { setupModuleFor, setupOptionsFor, wiringHelpers, type SetupWiringDeps } from '../../src/app/setup-wiring.js';
import type { ProjectConfig } from '../../src/provision/project-config.js';
import { E2E_WEB_CONFIG, FakeAuth, FakeCallables, FakeClock, FakeDocuments, NO_STORAGE, OWNER, testLog } from './fakes.js';

/** The seed manifest's city: what the admin build bundles as `legacy/bucharest/city.json`. */
const SEED_CITY = (
    JSON.parse(readFileSync(new URL('../../../../seed/bucharest/manifest.static.json', import.meta.url), 'utf8')) as { city: unknown }
).city;

const PROJECT: ProjectConfig = {
    ...E2E_PROJECT_CONFIG,
    cities: [...E2E_PROJECT_CONFIG.cities],
    viewerOrigins: [...E2E_PROJECT_CONFIG.viewerOrigins],
};

function wiring(city: unknown = SEED_CITY, project: ProjectConfig = PROJECT) {
    const auth = new FakeAuth();
    auth.user = OWNER;
    const fetcher = createFakeFetch((request) => {
        if (!request.url.pathname.endsWith('/city.json')) {
            return undefined;
        }
        return { operation: 'city', response: city === null ? new Response('missing', { status: 404 }) : jsonResponse(city) };
    });
    const callables = new FakeCallables();
    callables.answer('setup.createCity', () => ({ created: true }));
    const deps: SetupWiringDeps = {
        config: E2E_WEB_CONFIG,
        project,
        firebase: { auth, callables, documents: new FakeDocuments(), storage: NO_STORAGE },
        fetch: fetcher.fetch,
        clock: new FakeClock(),
        log: testLog().log,
        baseUrl: 'https://demo-hcm.web.app/',
        nonce: () => 'nonce-1',
    };
    return { deps, fetcher, callables };
}

describe('setupOptionsFor', () => {
    it('happyPath_theProjectsCityIsCreatedFromTheBundledSeed', async () => {
        const w = wiring();
        const options = setupOptionsFor(w.deps);

        await expect(options.createCity()).resolves.toEqual({ created: true });

        expect(options.cityId).toBe('bucharest');
        expect(options.cityBBox).toBeNull();
        expect(w.fetcher.calls[0]?.url).toBe('https://demo-hcm.web.app/legacy/bucharest/city.json');
        expect(w.callables.calls).toEqual([
            {
                name: 'setup.createCity',
                request: { cityId: 'bucharest', city: expect.objectContaining({ center: { lng: 26.085298, lat: 44.427037 } }) as unknown },
            },
        ]);
        expect(typeof options.cloud.provision).toBe('function');
        expect(typeof options.importer.run).toBe('function');
    });

    it('badPath_aMissingOrInvalidBundledCityFailsTheStep', async () => {
        await expect(setupOptionsFor(wiring(null).deps).createCity()).rejects.toThrow('missing or invalid');
        await expect(setupOptionsFor(wiring({ center: 'nowhere' }).deps).createCity()).rejects.toThrow('missing or invalid');
    });

    it('badPath_aProjectWithoutCitiesUsesThisRepositorysCity', () => {
        expect(setupOptionsFor(wiring(SEED_CITY, { ...PROJECT, cities: [] }).deps).cityId).toBe('bucharest');
    });

    it('happyPath_theModuleStartsWithNoStateUntilTheShellCreatesIt', () => {
        expect(setupModuleFor(wiring().deps).initial).toBeNull();
    });
});

describe('wiringHelpers', () => {
    it('happyPath_theSignedInAdminAndTheClock', async () => {
        const auth = new FakeAuth();
        const clock = new FakeClock();
        const helpers = wiringHelpers({ auth }, clock);
        expect([helpers.uid(), helpers.ownerEmail()]).toEqual([null, null]);
        auth.user = OWNER;

        const slept = helpers.sleep(500);
        clock.advance(500);

        await expect(slept).resolves.toBeUndefined();
        expect([helpers.uid(), helpers.ownerEmail()]).toEqual([OWNER.uid, OWNER.email]);
    });
});
