import { readFileSync } from 'node:fs';

import { createFakeFetch, E2E_PROJECT_CONFIG, jsonResponse } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import {
    installBundleLoader,
    publishedMapCheck,
    setupModuleFor,
    setupOptionsFor,
    wiringHelpers,
    type SetupWiringDeps,
} from '../../src/app/setup-wiring.js';
import { InstallBundleError } from '../../src/install/bundle.js';
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
        release: '1.0.0+abc1234',
        installOrigins: ['https://demo-hcm.web.app'],
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

// [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.3, §1.8)
describe('the installer wiring', () => {
    it('happyPath_aPublishedManifestIsSomethingToShow_badPath_noneOrAnUnreadableOneIsNot', async () => {
        const documents = new FakeDocuments();
        const check = publishedMapCheck({ documents }, 'bucharest');

        await expect(check()).resolves.toBe(false);
        await documents.set('manifests/bucharest', {
            url: 'https://storage.googleapis.com/demo-hcm-public/cities/bucharest/manifest.json',
        });
        await expect(check()).resolves.toBe(true);
        const refusing = { get: () => Promise.reject(new Error('permission-denied')) } as unknown as FakeDocuments;
        await expect(publishedMapCheck({ documents: refusing }, 'bucharest')()).resolves.toBe(false);
    });

    it('badPath_theAdminsBundleIsReadFromItsOwnBase_aMissingOneCannotInstall', async () => {
        const w = wiring();

        const error = await installBundleLoader(w.deps)().catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(InstallBundleError);
        expect((error as InstallBundleError).code).toBe('apiError.unavailable');
        expect(w.fetcher.unhandled[0]?.url).toBe('https://demo-hcm.web.app/install/1-0-0-abc1234/manifest.json');
        expect(setupOptionsFor(w.deps)).toMatchObject({ release: '1.0.0+abc1234', siteAddress: 'https://demo-hcm.web.app/' });
    });
});
// [end install]
