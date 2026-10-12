import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
    analyticsConfigResponseSchema,
    classifyMapboxToken,
    MAPBOX_BOOTSTRAP_SCOPES,
    MAPBOX_PUBLIC_SCOPES,
    MAPBOX_TILES_SCOPES,
    missingScopes,
    recordCloudRequestSchema,
    rotatePublicTokenResponseSchema,
    saveMapboxRequestSchema,
    saveMapboxResponseSchema,
    saveUsgsRequestSchema,
    selfTestResponseSchema,
    setupReady,
    setupStatusViewSchema,
    usgsRoleFromPermissions,
    type SetupStatusView,
} from '../../src/api/setup.js';
import { validate } from '../../src/schemas/validation.js';

const ISO = '2026-10-12T08:30:00.000Z';
const ok = { state: 'ok', checkedAt: ISO } as const;

/** A generated, Mapbox-shaped secret test value (assembled, so no scanner mistakes it for a real token). */
const SECRET = ['sk', 'eyJ1IjoidGVzdCJ9', 'scenario-test-value'].join('.');

const view: SetupStatusView = {
    billing: { ...ok, budgetAmount: 5, currency: 'USD' },
    provision: { ...ok, items: [{ id: 'buckets', state: 'ok' }] },
    mapbox: { ...ok, user: 'ventura86', adminToken: 'pk.test-admin', adminAllowedUrls: ['https://bucurestiul-disparut.web.app'] },
    usgs: { ...ok, role: 'download' },
    analytics: { state: 'missing', checkedAt: null },
    crash: { state: 'missing', checkedAt: null },
    secretsRev: 2,
    ready: true,
    generatedAt: ISO,
};

describe('Mapbox tokens', () => {
    it('happyPath_aSecretTokenIsRecognised', () => {
        expect(classifyMapboxToken(`  ${SECRET} `)).toBe('secret');
    });

    it.each([
        ['pk.eyJ1IjoidGVzdCJ9.public', 'public'],
        ['sk.short', 'unknown'],
        ['not a token', 'unknown'],
    ] as const)('badPath_%s_is_%s', (value, kind) => {
        expect(classifyMapboxToken(value)).toBe(kind);
    });

    it('happyPath_mintedTokensOnlyUseScopesTheBootstrapTokenHolds', () => {
        expect(missingScopes(MAPBOX_BOOTSTRAP_SCOPES)).toEqual([]);
        expect(missingScopes(MAPBOX_BOOTSTRAP_SCOPES, [...MAPBOX_TILES_SCOPES, ...MAPBOX_PUBLIC_SCOPES])).toEqual([]);
    });

    it('badPath_missingScopesAreListedInOrder', () => {
        expect(missingScopes(['styles:read', 'tilesets:list'])).toEqual([
            'styles:tiles',
            'fonts:read',
            'tilesets:read',
            'tilesets:write',
            'tokens:read',
            'tokens:write',
        ]);
    });
});

describe('USGS role', () => {
    it('happyPath_downloadPermissionMeansTheDownloadRole', () => {
        expect(usgsRoleFromPermissions(['user', 'download'])).toBe('download');
    });

    it('badPath_withoutItOnlySearch', () => {
        expect(usgsRoleFromPermissions(['user'])).toBe('search');
    });
});

describe('setup views', () => {
    it('happyPath_aReadyStatus', () => {
        expect(validate(setupStatusViewSchema, view)).toMatchObject({ ok: true });
        expect(setupReady(view)).toBe(true);
    });

    it('badPath_aPendingUsgsRoleIsNotReady', () => {
        expect(setupReady({ ...view, usgs: { state: 'pending', checkedAt: ISO, role: 'search' } })).toBe(false);
    });

    it('happyPath_everyResponseShape', () => {
        const minted = { tokenId: 'ck1viewer', allowedUrls: ['https://ventura8.github.io'] };

        expect(validate(saveMapboxRequestSchema, { cityId: 'bucuresti', secretToken: SECRET })).toMatchObject({ ok: true });
        expect(validate(saveMapboxResponseSchema, { mapbox: view.mapbox, viewer: minted, admin: minted })).toMatchObject({ ok: true });
        expect(
            validate(saveUsgsRequestSchema, { username: 'ventura', applicationToken: 'test-app-token-value', expiresOn: '2027-10-12' }),
        ).toMatchObject({
            ok: true,
        });
        expect(validate(selfTestResponseSchema, { checks: [{ id: 'mapbox', state: 'ok' }], status: view })).toMatchObject({ ok: true });
        expect(validate(rotatePublicTokenResponseSchema, { tokenId: 'ck2', retiresOldAt: null, manifestQueued: true })).toMatchObject({
            ok: true,
        });
        expect(
            validate(analyticsConfigResponseSchema, {
                analytics: { ...ok, measurementId: 'G-TEST1234' },
                measurementId: 'G-TEST1234',
                firebase: { apiKey: ['AIza', 'x'.repeat(35)].join(''), appId: '1:123:web:abc', projectId: 'demo-hcm' },
                manifestQueued: true,
            }),
        ).toMatchObject({ ok: true });
    });

    it('happyPath_recordCloudTakesBillingOrProvisioning', () => {
        expect(validate(recordCloudRequestSchema, { billing: { state: 'ok', budgetAmount: 5, currency: 'USD' } })).toMatchObject({
            ok: true,
        });
        expect(validate(recordCloudRequestSchema, { provision: { items: [{ id: 'apis', state: 'ok' }] } })).toMatchObject({ ok: true });
    });

    it.each([
        ['an empty report', recordCloudRequestSchema, {}, ''],
        ['an empty provisioning report', recordCloudRequestSchema, { provision: { items: [] } }, 'provision.items'],
        ['a secret in a status view', setupStatusViewSchema, { ...view, mapbox: { ...view.mapbox, token: SECRET } }, 'mapbox.token'],
        ['a status without generatedAt', setupStatusViewSchema, { ...view, generatedAt: 'yesterday' }, 'generatedAt'],
        ['a Mapbox save without its city', saveMapboxRequestSchema, { secretToken: SECRET }, 'cityId'],
        [
            'a minted token without origins',
            saveMapboxResponseSchema,
            { mapbox: view.mapbox, viewer: { tokenId: 'ck', allowedUrls: [] }, admin: { tokenId: 'ck', allowedUrls: ['https://a.b'] } },
            'viewer.allowedUrls',
        ],
        ['an empty USGS username', saveUsgsRequestSchema, { username: '  ', applicationToken: 'x' }, 'username'],
        [
            'an impossible expiry date',
            saveUsgsRequestSchema,
            { username: 'u', applicationToken: 'x', expiresOn: '2027-02-30' },
            'expiresOn',
        ],
    ])('badPath_%s', (_name, schema: z.ZodType, input, path) => {
        const result = validate(schema, input);

        expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toContain(path);
    });
});
