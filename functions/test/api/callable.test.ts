/**
 * The callable plumbing every M2 function uses (docs/research/M2-interfaces.md §3.0): access rule, request and
 * response validation against the shared registry, and the error protocol `HttpsError(status, code, details)`.
 */
import { apiErrorDetailsSchema, type SetupStatusView } from '@hcm/shared';
import { HttpsError, type CallableRequest } from 'firebase-functions/https';
import { describe, expect, it } from 'vitest';

import { requireAccess, type Caller, type CallerToken } from '../../src/api/access.js';
import { ApiError, toHttpsError } from '../../src/api/api-error.js';
import { callableOptions, defineCallable, runCallable, type CallableDeps } from '../../src/api/callable.js';
import { InvalidDocumentError, UpstreamError } from '../../src/ports/errors.js';
import { fakeAdmins, recordingLogger } from '../support/fakes.js';

const ISO = '2026-10-12T08:30:00.000Z';

/** A verified Google admin's token; override one claim to build each bad case. */
function adminToken(overrides: Partial<CallerToken> = {}): CallerToken {
    return { email_verified: true, admin: true, firebase: { sign_in_provider: 'google.com' }, ...overrides };
}

function caller(uid: string, token: CallerToken = adminToken()): Caller {
    return { uid, token };
}
const missing = { state: 'missing', checkedAt: null } as const;

const VIEW: SetupStatusView = {
    billing: missing,
    provision: { ...missing, items: [] },
    mapbox: missing,
    usgs: missing,
    analytics: missing,
    crash: missing,
    secretsRev: 0,
    ready: false,
    generatedAt: ISO,
};

function deps(admins: readonly string[] = ['u-admin']): CallableDeps & ReturnType<typeof recordingLogger> {
    const logged = recordingLogger();
    return { ...logged, admins: fakeAdmins(admins) };
}

/** What firebase-functions hands a callable (its `.run()` takes the same). */
function request(data: unknown, auth = caller('u-admin')): CallableRequest<unknown> {
    return {
        data,
        auth: { ...auth, rawToken: 'test-id-token' },
        rawRequest: {} as CallableRequest['rawRequest'],
        acceptsStreaming: false,
    } as CallableRequest<unknown>;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected a rejection');
}

describe('runCallable', () => {
    it('happyPath_anAdminGetsTheValidatedResponse', async () => {
        const result = await runCallable('setup.status', () => Promise.resolve(VIEW), deps(), { auth: caller('u-admin'), data: {} });

        expect(result).toEqual(VIEW);
    });

    it('happyPath_aSignedInNonAdminMayAskForItsSession', async () => {
        const session = { admin: false, role: null, claim: false, refreshToken: false, ownerClaimed: true, invitePending: false };

        const result = await runCallable(
            'admin.session',
            (_deps, verified) => Promise.resolve({ ...session, claim: verified.claim }),
            deps([]),
            {
                auth: caller('u-stranger', adminToken({ admin: undefined, email: 'stranger@example.test' })),
                data: {},
            },
        );

        expect(result).toEqual(session);
    });

    it('badPath_anInvalidRequestListsItsFieldIssues', async () => {
        const error = await rejection(
            runCallable('admins.invite', () => Promise.reject(new Error('never')), deps(), {
                auth: caller('u-admin'),
                data: { email: 'nope' },
            }),
        );

        expect(error).toMatchObject({ code: 'apiError.invalidRequest', issues: [{ path: 'email', code: 'validation.format' }] });
    });

    it('badPath_aResponseOutsideItsSchemaIsNeverSent', async () => {
        const context = deps();

        const error = await rejection(
            runCallable('setup.status', () => Promise.resolve({ ...VIEW, token: 'sk.never' } as SetupStatusView), context, {
                auth: caller('u-admin'),
                data: {},
            }),
        );

        expect(error).toMatchObject({ code: 'apiError.internal' });
        expect(context.recording.records).toEqual([
            {
                level: 'error',
                scope: 'functions',
                message: 'callable response does not match its schema',
                data: { callable: 'setup.status', issues: 1 },
            },
        ]);
    });
});

describe('requireAccess', () => {
    it.each([
        ['an anonymous call', undefined, 'apiError.unauthenticated'],
        ['an unverified address', caller('u-admin', adminToken({ email_verified: false })), 'apiError.accountNotAllowed'],
        ['a password account', caller('u-admin', adminToken({ firebase: { sign_in_provider: 'password' } })), 'apiError.accountNotAllowed'],
        ['a claim without its document', caller('u-revoked'), 'apiError.notAdmin'],
        ['a document without the claim', caller('u-admin', adminToken({ admin: undefined })), 'apiError.notAdmin'],
    ])('badPath_%s', async (_name, who, code) => {
        await expect(requireAccess('admin', who, fakeAdmins(['u-admin']))).rejects.toMatchObject({ code });
    });

    it('happyPath_theAdminsDocumentIsReadOnlyForAQualifyingToken', async () => {
        const admins = fakeAdmins(['u-admin']);

        await expect(requireAccess('admin', caller('u-admin', adminToken({ admin: undefined })), admins)).rejects.toBeInstanceOf(ApiError);
        await expect(requireAccess('admin', caller('u-admin', adminToken({ email: 'a@example.test' })), admins)).resolves.toEqual({
            uid: 'u-admin',
            email: 'a@example.test',
            claim: true,
        });
        expect(admins.lookups).toEqual(['u-admin']);
    });
});

describe('toHttpsError', () => {
    it('happyPath_anApiErrorKeepsItsCodeParametersAndStatus', () => {
        const { log, recording } = recordingLogger();

        const error = toHttpsError(new ApiError('apiError.claim.notOwner', { projectId: 'demo-hcm' }), log);

        expect([error.code, error.message, error.details]).toEqual([
            'permission-denied',
            'apiError.claim.notOwner',
            { code: 'apiError.claim.notOwner', params: { projectId: 'demo-hcm' } },
        ]);
        expect(apiErrorDetailsSchema.safeParse(error.details).success).toBe(true);
        expect(recording.records).toEqual([]);
    });

    it.each([
        ['maintenance', 'apiError.unavailable', 'unavailable'],
        ['rateLimited', 'apiError.rateLimited', 'resource-exhausted'],
        ['conflict', 'apiError.conflict', 'aborted'],
        ['notFound', 'apiError.notFound', 'not-found'],
        ['unauthorized', 'apiError.internal', 'internal'],
    ] as const)('badPath_anUnmappedUpstream_%s_becomes_%s', (failure, code, status) => {
        const { log, recording } = recordingLogger();

        const error = toHttpsError(new UpstreamError('mapbox', failure, { status: 500 }), log);

        expect([error.code, error.message]).toEqual([status, code]);
        expect(recording.records[0]?.data).toEqual({ code, error: `UpstreamError: mapbox call failed: ${failure} (HTTP 500)` });
    });

    it('badPath_anInvalidStoredDocumentIsInternalAndLoggedWithoutValues', () => {
        const { log, recording } = recordingLogger();

        const error = toHttpsError(new InvalidDocumentError('setup/status', [{ path: 'mapbox', code: 'validation.type' }]), log);

        expect(error.message).toBe('apiError.internal');
        expect(recording.records[0]?.data).toEqual({
            code: 'apiError.internal',
            error: 'InvalidDocumentError',
            path: 'setup/status',
            issues: 1,
        });
    });

    it('badPath_aThrownValueThatIsNoErrorIsInternal', () => {
        const { log, recording } = recordingLogger();

        expect(toHttpsError('boom', log).message).toBe('apiError.internal');
        expect(recording.records[0]?.data).toEqual({ code: 'apiError.internal', error: 'non-error value thrown' });
    });

    it('happyPath_anHttpsErrorPassesThrough', () => {
        const original = new HttpsError('unauthenticated', 'App Check token missing');

        expect(toHttpsError(original, recordingLogger().log)).toBe(original);
    });
});

describe('defineCallable', () => {
    it('happyPath_runsTheHandlerThroughFirebaseFunctions', async () => {
        const fn = defineCallable('setup.status', () => Promise.resolve(VIEW), deps);

        await expect(fn.run(request({}))).resolves.toEqual(VIEW);
    });

    it('badPath_aFailureLeavesAsAnHttpsErrorWithDetails', async () => {
        const fn = defineCallable('setup.status', () => Promise.reject(new ApiError('apiError.secrets.unavailable')), deps);

        await expect(fn.run(request({}))).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'apiError.secrets.unavailable',
            details: { code: 'apiError.secrets.unavailable' },
        });
    });

    it('badPath_anAnonymousCallIsUnauthenticated', async () => {
        const fn = defineCallable('setup.status', () => Promise.resolve(VIEW), deps);
        const anonymous = {
            data: {},
            rawRequest: {} as CallableRequest['rawRequest'],
            acceptsStreaming: false,
        } as CallableRequest<unknown>;

        await expect(fn.run(anonymous)).rejects.toMatchObject({ code: 'unauthenticated', details: { code: 'apiError.unauthenticated' } });
    });
});

describe('callableOptions', () => {
    it('happyPath_enforcedAppCheckConsumesTokensForSecretPastes', () => {
        expect(callableOptions('setup.saveMapbox', { HCM_APP_CHECK: 'enforce' })).toEqual({
            maxInstances: 3,
            serviceAccount: 'fn-admin@',
            enforceAppCheck: true,
            consumeAppCheckToken: true,
        });
        expect(callableOptions('setup.status', { HCM_APP_CHECK: 'enforce' })).toEqual({
            maxInstances: 3,
            serviceAccount: 'fn-admin@',
            enforceAppCheck: true,
            consumeAppCheckToken: false,
        });
    });

    it('badPath_monitorModeEnforcesNothingYet', () => {
        expect(callableOptions('admin.claim', {})).toEqual({
            maxInstances: 2,
            serviceAccount: 'fn-admin@',
            enforceAppCheck: false,
            consumeAppCheckToken: false,
        });
    });
});
