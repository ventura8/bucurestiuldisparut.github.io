/**
 * `setup.selfTest` (the Setup Assistant's Re-check; scenario A03): every check of `SELF_TEST_CHECKS` runs in order with
 * the functions' own credentials, each isolated, and what it finds for Mapbox, USGS and crash reporting lands in
 * `setup/status`.
 */
import { FIRESTORE_PATHS, SELF_TEST_CHECKS, manifestStateDocSchema, type SelfTestResponse } from '@hcm/shared';
import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { UpstreamError } from '../../src/ports/errors.js';
import { saveMapbox } from '../../src/setup/save-mapbox.js';
import { saveUsgs } from '../../src/setup/save-usgs.js';
import { selfTest } from '../../src/setup/self-test.js';
import { ADMIN, CITY, NOW, createWorld, type World, type WorldOptions } from './world.js';

const CHECKED = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };

/** A project where Mapbox and USGS were connected through the Setup Assistant. */
async function connected(
    options: WorldOptions & { readonly usgs?: (typeof USGS_CREDENTIALS)['approved' | 'pending'] } = {},
): Promise<World> {
    const world = createWorld(options);
    await saveMapbox(world.deps, ADMIN, { cityId: CITY, secretToken: MAPBOX_TOKENS.bootstrap });
    await saveUsgs(world.deps, ADMIN, { ...(options.usgs ?? USGS_CREDENTIALS.approved), expiresOn: '2027-01-31' });
    return world;
}

function check(response: SelfTestResponse, id: (typeof SELF_TEST_CHECKS)[number]) {
    return response.checks.find((candidate) => candidate.id === id);
}

describe('setup.selfTest', () => {
    it('happyPath_everyCheckPassesOnAConnectedProject', async () => {
        const world = await connected();

        const response = await selfTest(world.deps, ADMIN);

        expect(response.checks).toEqual(SELF_TEST_CHECKS.map((id) => ({ id, state: 'ok' })));
        expect(response.status).toMatchObject({
            mapbox: { state: 'ok', user: 'e2e-mapbox' },
            usgs: { state: 'ok', role: 'download' },
            crash: { state: 'ok' },
        });
        expect(world.blobs.recorder.calls.map((call) => [call.method, call.args[0]])).toEqual([
            ['write', 'private'],
            ['delete', 'private'],
            ['write', 'public'],
            ['delete', 'public'],
        ]);
        expect(world.blobs.objects.size).toBe(0);
        expect(world.tasks.tasks).toEqual([
            {
                queue: 'publish-buildManifest',
                payload: { cityId: CITY, requestedVersion: 1, full: false },
                options: { id: `manifest-${CITY}-29861790`, delaySeconds: 60 },
            },
        ]);
        expect(manifestStateDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.manifestState(CITY)))).toEqual({
            requestedVersion: 1,
            builtVersion: 0,
            status: 'queued',
            updatedBy: ADMIN.uid,
            updatedAt: CHECKED,
        });
        expect(world.errors.requests).toEqual([{ hours: 24, pageSize: 1 }]);
        expect(world.status()?.usgs).toMatchObject({
            tokenExpiresAt: { seconds: Date.parse('2027-01-31T00:00:00Z') / 1000, nanoseconds: 0 },
        });
        expect(world.records.at(-1)).toMatchObject({ message: 'self-test ran', data: { uid: ADMIN.uid, failed: '' } });
    });

    it('happyPath_aSecondRunRequestsTheNextManifestVersion', async () => {
        const world = await connected();
        await selfTest(world.deps, ADMIN);

        await selfTest(world.deps, ADMIN);

        expect(manifestStateDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.manifestState(CITY))).requestedVersion).toBe(2);
        expect(world.tasks.tasks).toHaveLength(1);
    });

    it('badPath_aFreshProjectHasNothingToCheckYet', async () => {
        const world = createWorld({ city: false });

        const response = await selfTest(world.deps, ADMIN);

        expect(['task-queue', 'mapbox', 'usgs'].map((id) => check(response, id as 'mapbox')?.state)).toEqual([
            'missing',
            'missing',
            'missing',
        ]);
        expect(world.status()).toMatchObject({
            mapbox: { state: 'missing', checkedAt: CHECKED },
            usgs: { state: 'missing', checkedAt: CHECKED },
        });
    });

    it('badPath_aRefusedSecretManagerNamesTheFixAndTheOtherChecksStillRun', async () => {
        const world = await connected();
        world.upstream.fail('secret-manager', 'forbidden');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'secrets')).toEqual({ id: 'secrets', state: 'invalid', detail: 'apiError.secrets.unavailable' });
        expect(
            ['firestore', 'private-bucket', 'public-bucket', 'task-queue', 'firebase-management', 'error-reporting'].map(
                (id) => check(response, id as 'secrets')?.state,
            ),
        ).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
        expect(
            world.records.filter((record) => record.message === 'self-test check failed').map((record) => record.data?.['check']),
        ).toEqual(['secrets', 'mapbox', 'usgs']);
    });
});

describe('setup.selfTest Mapbox and USGS', () => {
    it('badPath_aRevokedBootstrapTokenTurnsTheMapboxCardInvalidAndKeepsTheRest', async () => {
        const world = await connected();
        world.upstream.scenario('mapbox.bootstrapRevoked');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'mapbox')).toEqual({ id: 'mapbox', state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' });
        expect(world.status()?.mapbox).toMatchObject({
            state: 'invalid',
            detail: 'apiError.mapbox.tokenInvalid',
            user: 'e2e-mapbox',
            checkedAt: CHECKED,
        });
        expect(world.status()?.mapbox?.adminToken).toMatch(/^pk\./);
    });

    it('badPath_aRevokedTilesTokenIsFound', async () => {
        const world = await connected();
        const account = world.upstream.state.mapbox.accounts.get('e2e-mapbox');
        account?.tokens.splice(
            account.tokens.findIndex((token) => token.note.endsWith('tiles (auto)')),
            1,
        );

        await expect(selfTest(world.deps, ADMIN)).resolves.toMatchObject({
            status: { mapbox: { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' } },
        });
    });

    it('badPath_aStoredPublicTokenIsTheWrongKind', async () => {
        const world = createWorld();
        await world.deps.secrets.write('mapbox-sk-bootstrap', MAPBOX_TOKENS.defaultPublic);

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'mapbox')).toMatchObject({ state: 'invalid', detail: 'apiError.mapbox.tokenFormat' });
        expect(world.status()?.mapbox).toEqual({ state: 'invalid', detail: 'apiError.mapbox.tokenFormat', checkedAt: CHECKED });
    });

    it('happyPath_aPassingCheckClearsTheOldReason', async () => {
        const world = await connected();
        const status = world.status();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, {
            ...status,
            mapbox: { ...status?.mapbox, state: 'unavailable', detail: 'apiError.mapbox.unavailable', params: { x: 'y' } },
        });

        await selfTest(world.deps, ADMIN);

        expect(world.status()?.mapbox).toMatchObject({ state: 'ok' });
        expect(world.status()?.mapbox).not.toHaveProperty('detail');
        expect(world.status()?.mapbox).not.toHaveProperty('params');
    });

    it('badPath_aPendingApprovalStaysPendingWithItsNextCheck', async () => {
        const world = await connected({ usgs: USGS_CREDENTIALS.pending });

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'usgs')).toEqual({ id: 'usgs', state: 'pending', detail: 'apiError.usgs.accessPending' });
        expect(world.status()?.usgs).toMatchObject({
            state: 'pending',
            role: 'search',
            detail: 'apiError.usgs.accessPending',
            nextCheckAt: { seconds: CHECKED.seconds + 6 * 3600, nanoseconds: 0 },
        });
    });

    it('badPath_usgsMaintenanceKeepsTheKnownRole', async () => {
        const world = await connected();
        world.upstream.fail('usgs', 'maintenance');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'usgs')).toEqual({ id: 'usgs', state: 'unavailable', detail: 'apiError.usgs.maintenance' });
        expect(world.status()?.usgs).toMatchObject({ state: 'unavailable', role: 'download', detail: 'apiError.usgs.maintenance' });
    });

    it('badPath_anExpiredUsgsTokenIsInvalid', async () => {
        const world = await connected();
        world.upstream.scenario('usgs.tokenExpired');

        await selfTest(world.deps, ADMIN);

        expect(world.status()?.usgs).toMatchObject({ state: 'invalid', detail: 'apiError.usgs.credentials', role: 'download' });
    });
});

describe('setup.selfTest Google Cloud', () => {
    it.each([
        ['forbidden', { state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/errorreporting.viewer' } }],
        ['unavailable', { state: 'unavailable', detail: 'apiError.errorReporting.unavailable' }],
    ] as const)('badPath_errorReporting_%s_isRecordedOnTheCrashCard', async (failure, expected) => {
        const world = createWorld();
        world.errors.failure = new UpstreamError('error-reporting', failure, { status: failure === 'forbidden' ? 403 : 503 });

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'error-reporting')).toEqual({ id: 'error-reporting', ...expected });
        expect(world.status()?.crash).toEqual({ ...expected, checkedAt: CHECKED });
    });

    it('badPath_aDisabledFirebaseManagementApiIsNamed', async () => {
        const world = createWorld();
        world.upstream.fail('firebase-management', 'apiDisabled');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'firebase-management')).toEqual({
            id: 'firebase-management',
            state: 'invalid',
            detail: 'apiError.cloud.apiDisabled',
            params: { api: 'firebase.googleapis.com' },
        });
    });

    it('badPath_aBucketWithoutTheRoleNamesIt', async () => {
        const world = createWorld();
        world.blobs.recorder.failNext('write', new UpstreamError('cloud-storage', 'forbidden', { status: 403 }));

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'private-bucket')).toEqual({
            id: 'private-bucket',
            state: 'invalid',
            detail: 'apiError.cloud.permission',
            params: { role: 'roles/storage.objectAdmin' },
        });
        expect(check(response, 'public-bucket')?.state).toBe('ok');
    });

    it('badPath_anUnavailableTaskQueueIsRetryable', async () => {
        const world = createWorld();
        world.tasks.recorder.failNext('enqueue', new UpstreamError('cloud-tasks', 'unavailable', { status: 503 }));

        await expect(selfTest(world.deps, ADMIN)).resolves.toMatchObject({
            checks: expect.arrayContaining([{ id: 'task-queue', state: 'unavailable', detail: 'apiError.unavailable' }]) as unknown,
        });
    });

    it('badPath_anUnreachableFirestoreIsReported', async () => {
        const world = createWorld();
        world.documents.recorder.failNext('get', new UpstreamError('firestore', 'unavailable'));

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'firestore')).toEqual({ id: 'firestore', state: 'unavailable', detail: 'apiError.unavailable' });
    });

    it('happyPath_aBootstrapTokenWithoutATilesTokenYetIsEnough', async () => {
        const world = createWorld();
        await world.deps.secrets.write('mapbox-sk-bootstrap', MAPBOX_TOKENS.bootstrap);

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'mapbox')).toEqual({ id: 'mapbox', state: 'ok' });
        expect(world.upstream.callsTo('mapbox.tokens.retrieve')).toHaveLength(1);
    });

    it('badPath_aSetupStatusTheSchemaRefusesFailsTheFirestoreCheck', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { mapbox: { state: 'nonsense' } });

        const response = await selfTest(world.deps, ADMIN).catch((error: unknown) => error);

        expect(response).toMatchObject({ name: 'InvalidDocumentError', path: 'setup/status' });
        expect(world.records.find((record) => record.data?.['check'] === 'firestore')).toMatchObject({
            data: { code: 'apiError.internal' },
        });
    });

    it('badPath_anUnexpectedFailureIsAnInternalError', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.manifestState(CITY), { requestedVersion: 'one' });

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'task-queue')).toEqual({ id: 'task-queue', state: 'unavailable', detail: 'apiError.internal' });
    });
});

describe('setup.selfTest Vertex AI (M4, CR-M4-5)', () => {
    it('happyPath_theAiCheckCountsTokensOnThePinnedModelWithoutACharge @S-A45-HAPPY-SELF-TEST', async () => {
        const world = createWorld();

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'ai')).toEqual({ id: 'ai', state: 'ok' });
        expect(world.upstream.callsTo('vertex-ai.countTokens').map((call) => new URL(call.url).pathname)).toEqual([
            '/v1/projects/demo-hcm/locations/us-central1/publishers/google/models/gemini-2.5-flash-lite:countTokens',
        ]);
        expect(world.upstream.callsTo('vertex-ai.generateContent')).toEqual([]);
    });

    it.each([
        ['apiDisabled', { state: 'invalid', detail: 'apiError.cloud.apiDisabled', params: { api: 'aiplatform.googleapis.com' } }],
        ['forbidden', { state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'hcmVertexDrafts' } }],
        ['unavailable', { state: 'unavailable', detail: 'apiError.unavailable' }],
    ] as const)('badPath_vertexAi_%s_sendsTheOwnerToPrepareTheProject @S-A45-BAD-API-DISABLED', async (mode, expected) => {
        const world = createWorld();
        world.upstream.fail('vertex-ai', mode);

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'ai')).toEqual({ id: 'ai', ...expected });
    });
});
