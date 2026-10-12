import {
    FIRESTORE_PATHS,
    MANIFEST_DEBOUNCE_SECONDS,
    MANIFEST_QUEUE,
    cityDocSchema,
    manifestStateDocSchema,
    manifestTaskId,
    timestampFromDate,
    type ApiErrorCode,
    type ManifestStateDoc,
    type SelfTestCheck,
    type ServiceState,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { BlobStore } from '../ports/blob-store.js';
import type { Ports } from '../ports/index.js';
import type { SecretName } from '../ports/secret-store.js';
import { MAPBOX_FAILURES, ROLES, SECRET_FAILURES, TRANSIENT, upstream, viaCloud } from './failures.js';
import { readSetupStatus } from './records.js';
import { checkUsgs, type UsgsOutcome } from './usgs-check.js';

/**
 * The checks of `setup.selfTest` (`SELF_TEST_CHECKS`, M2-interfaces §3.3): one real, minimal, harmless operation each,
 * with the functions' own service account, so a missing role, a disabled API or a revoked credential shows up on the
 * card it belongs to. A check resolves to its result or throws an `ApiError` (the runner records it).
 */
export type SelfTestDeps = Pick<
    Ports,
    'documents' | 'secrets' | 'blobs' | 'tasks' | 'mapbox' | 'usgs' | 'firebase' | 'errors' | 'clock' | 'config' | 'log'
>;

export interface CheckResult {
    readonly state: ServiceState;
    readonly detail?: ApiErrorCode;
    readonly params?: Readonly<Record<string, string>>;
    /** The USGS check's outcome (role and next check), kept for the `usgs` record. */
    readonly usgs?: UsgsOutcome;
}

/** Who runs the self-test, and when (its writes are stamped with the caller). */
export interface CheckContext {
    readonly uid: string;
    readonly now: Date;
}

type Check = (deps: SelfTestDeps, context: CheckContext) => Promise<CheckResult>;
type BucketRole = Parameters<BlobStore['write']>[0];

const OK: CheckResult = { state: 'ok' };
const SECRET_NAMES: readonly SecretName[] = ['mapbox-sk-bootstrap', 'mapbox-sk-tiles', 'usgs-username', 'usgs-app-token'];
const PROBE = new TextEncoder().encode('historic-city-map self-test');
const ERROR_REPORTING_TRANSIENT = {
    ...TRANSIENT,
    unavailable: ['apiError.errorReporting.unavailable'],
    maintenance: ['apiError.errorReporting.unavailable'],
} as const;

async function checkFirestore(deps: SelfTestDeps): Promise<CheckResult> {
    await viaCloud(readSetupStatus(deps.documents), ROLES.datastoreUser, TRANSIENT);
    return OK;
}

/** Every secret read fresh (the cache dropped first): a missing value is fine here, a refused read is not. */
async function checkSecrets(deps: SelfTestDeps): Promise<CheckResult> {
    deps.secrets.invalidate();
    for (const name of SECRET_NAMES) {
        await upstream(deps.secrets.read(name), SECRET_FAILURES);
    }
    return OK;
}

/** Writes and deletes one small object under `tmp/selftest/` (the buckets' lifecycle sweeps `tmp/` anyway). */
async function checkBucket(deps: SelfTestDeps, bucket: BucketRole, context: CheckContext): Promise<CheckResult> {
    const path = `tmp/selftest/${String(context.now.getTime())}.txt`;
    await viaCloud(deps.blobs.write(bucket, path, PROBE, { contentType: 'text/plain' }), ROLES.storageObjectAdmin, TRANSIENT);
    await viaCloud(deps.blobs.delete(bucket, path), ROLES.storageObjectAdmin, TRANSIENT);
    return OK;
}

/**
 * Requests a manifest rebuild the way the publish triggers do (M2-interfaces §3.5: `requestedVersion` + 1 and
 * `queued` in `manifests/{city}`, then the debounced task): harmless, the builder publishes the same manifest again.
 */
async function requestRebuild(deps: SelfTestDeps, cityId: string, context: CheckContext): Promise<void> {
    const path = FIRESTORE_PATHS.manifestState(cityId);
    const requestedVersion = await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, manifestStateDocSchema);
        const next: ManifestStateDoc = {
            ...(current ?? { builtVersion: 0 }),
            requestedVersion: (current?.requestedVersion ?? 0) + 1,
            status: 'queued',
            updatedBy: context.uid,
            updatedAt: timestampFromDate(context.now),
        };
        await transaction.set(path, manifestStateDocSchema, next);
        return next.requestedVersion;
    });
    const task = { id: manifestTaskId(cityId, context.now), delaySeconds: MANIFEST_DEBOUNCE_SECONDS };
    await viaCloud(
        deps.tasks.enqueue(MANIFEST_QUEUE, { cityId, requestedVersion, full: false }, task),
        ROLES.cloudTasksEnqueuer,
        TRANSIENT,
    );
}

/** A rebuild for every city; without a city there is nothing to enqueue yet. */
async function checkTaskQueue(deps: SelfTestDeps, context: CheckContext): Promise<CheckResult> {
    const cities = await deps.documents.query(FIRESTORE_PATHS.cities, cityDocSchema);
    for (const city of cities.documents) {
        await requestRebuild(deps, city.id, context);
    }
    return cities.documents.length === 0 ? { state: 'missing' } : OK;
}

/** The stored bootstrap token (and the tiles token, when there is one) must still be valid secret tokens. */
async function checkMapbox(deps: SelfTestDeps): Promise<CheckResult> {
    const bootstrap = await upstream(deps.secrets.read('mapbox-sk-bootstrap'), SECRET_FAILURES);
    if (bootstrap === undefined) {
        return { state: 'missing' };
    }
    if ((await upstream(deps.mapbox.retrieveToken(bootstrap), MAPBOX_FAILURES)).usage !== 'sk') {
        throw new ApiError('apiError.mapbox.tokenFormat');
    }
    const tiles = await upstream(deps.secrets.read('mapbox-sk-tiles'), SECRET_FAILURES);
    if (tiles !== undefined) {
        await upstream(deps.mapbox.retrieveToken(tiles), MAPBOX_FAILURES);
    }
    return OK;
}

/** A login, the M2M role and a logout with the stored credentials. */
async function checkUsgsAccount(deps: SelfTestDeps): Promise<CheckResult> {
    const username = await upstream(deps.secrets.read('usgs-username'), SECRET_FAILURES);
    const token = await upstream(deps.secrets.read('usgs-app-token'), SECRET_FAILURES);
    if (username === undefined || token === undefined) {
        return { state: 'missing' };
    }
    const outcome = await checkUsgs(deps.usgs, username, token);
    return 'detail' in outcome ? { state: outcome.state, detail: outcome.detail, usgs: outcome } : { state: outcome.state, usgs: outcome };
}

async function checkFirebaseManagement(deps: SelfTestDeps): Promise<CheckResult> {
    await viaCloud(deps.firebase.listWebApps(deps.config.projectId), ROLES.firebaseViewer, TRANSIENT);
    return OK;
}

async function checkErrorReporting(deps: SelfTestDeps): Promise<CheckResult> {
    await viaCloud(deps.errors.listGroups({ hours: 24, pageSize: 1 }), ROLES.errorReportingViewer, ERROR_REPORTING_TRANSIENT);
    return OK;
}

/** Every check, in the order the card lists them. */
export const CHECKS: Readonly<Record<SelfTestCheck, Check>> = {
    firestore: checkFirestore,
    secrets: checkSecrets,
    'private-bucket': (deps, context) => checkBucket(deps, 'private', context),
    'public-bucket': (deps, context) => checkBucket(deps, 'public', context),
    'task-queue': checkTaskQueue,
    mapbox: checkMapbox,
    usgs: checkUsgsAccount,
    'firebase-management': checkFirebaseManagement,
    'error-reporting': checkErrorReporting,
};
