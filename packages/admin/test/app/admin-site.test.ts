import { describe, expect, it } from 'vitest';

import { adminReleaseFields, installPlace, markPublicMap, onOwnSite, ownSiteId, publicOrigin } from '../../src/app/admin-site.js';

/** §210: the admin's own site is the origin its `runtime.json` names, and only that one. */
const OWN = 'https://demo-hcm-admin.web.app';

describe('the admin on its own site', () => {
    it('happyPath_theOriginTheRuntimeNamesIsTheAdminsOwnSite', () => {
        const runtime = { adminOrigin: OWN };

        expect(onOwnSite(runtime, OWN)).toBe(true);
        expect(ownSiteId(runtime, OWN)).toBe('demo-hcm-admin');
        expect(publicOrigin('demo-hcm', runtime, OWN)).toBe('https://demo-hcm.web.app');
    });

    it('badPath_thePublicMapsOriginOrARuntimeWithoutTheFieldIsNot', () => {
        expect(onOwnSite({ adminOrigin: OWN }, 'https://demo-hcm.web.app')).toBe(false);
        expect(onOwnSite({}, OWN)).toBe(false);
        expect(ownSiteId({}, OWN)).toBeNull();
        expect(publicOrigin('demo-hcm', {}, 'https://demo-hcm.web.app')).toBe('https://demo-hcm.web.app');
    });

    it('badPath_aLoopbackAdminOriginIsItsOwnSiteButNoHostingSite', () => {
        // The e2e world serves the admin's own site on a second loopback origin: its public map is its own origin.
        const origin = 'http://localhost:4312';

        expect(onOwnSite({ adminOrigin: origin }, origin)).toBe(true);
        expect(ownSiteId({ adminOrigin: origin }, origin)).toBeNull();
        expect(publicOrigin('demo-hcm', { adminOrigin: origin }, origin)).toBe(origin);
    });
});

describe('what the boot takes from it', () => {
    it('happyPath_onItsOwnSiteTheAdminInstallsFromHostingNamesTheSiteAndMarksThePublicMap', () => {
        const doc = { documentElement: { dataset: {} as DOMStringMap } } as unknown as Document;

        markPublicMap(doc, 'demo-hcm', { adminOrigin: OWN }, OWN);

        expect(installPlace('demo-hcm', { adminOrigin: OWN }, OWN, true)).toEqual({
            installOrigins: ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com', OWN, 'https://demo-hcm-admin.firebaseapp.com'],
            adminSite: 'demo-hcm-admin',
        });
        expect(doc.documentElement.dataset['hcmPublicMap']).toBe('https://demo-hcm.web.app/');
        expect(adminReleaseFields({ release: '1.0.0+abc1234' })).toEqual({ release: '1.0.0+abc1234', releaseTime: null });
        expect(adminReleaseFields({ release: 'r', releaseTime: 5 })).toEqual({ release: 'r', releaseTime: 5 });
    });

    it('badPath_elsewhereNothingIsMarkedAndTheE2eBuildInstallsFromItsOwnOrigin', () => {
        const doc = { documentElement: { dataset: {} as DOMStringMap } } as unknown as Document;
        const origin = 'http://127.0.0.1:4312';

        markPublicMap(doc, 'demo-hcm', {}, origin);

        expect(installPlace('demo-hcm', {}, origin, false)).toEqual({ installOrigins: [origin], adminSite: null });
        expect(doc.documentElement.dataset['hcmPublicMap']).toBeUndefined();
    });
});
