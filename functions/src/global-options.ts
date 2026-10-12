import type { BACKGROUND_FUNCTIONS, CallableName, HTTP_ENDPOINTS } from '@hcm/shared';
import { setGlobalOptions, type GlobalOptions } from 'firebase-functions/options';

/** Every function of the registry (`@hcm/shared` → `CALLABLES`, `HTTP_ENDPOINTS`, `BACKGROUND_FUNCTIONS`). */
export type FunctionName = CallableName | keyof typeof HTTP_ENDPOINTS | keyof typeof BACKGROUND_FUNCTIONS;

/** The runtime service accounts of security review §1.1 (created by the bootstrap; never the compute default). */
type RuntimeAccount = 'fn-admin' | 'fn-events';

/**
 * Who each function runs as (security review §1.1, `docs/research/M2-interfaces.md` §4.3, CR-M2-8, CR-M2-13,
 * CR-M2-29). `fn-admin@` holds the secrets, Firebase Auth and the Management and Error Reporting viewer roles, so it
 * runs every callable and `ops.*` (`DECISIONS-for-review.md` §19b: the tick retires Mapbox tokens and deletes stale
 * accounts); `fn-events@` runs the Firestore and Storage triggers, the manifest builder and the public crash endpoint
 * (which only writes a log entry). A new registry name fails to compile until it is listed here.
 */
export const RUNTIME_ACCOUNTS: Readonly<Record<FunctionName, RuntimeAccount>> = {
    'admin.session': 'fn-admin',
    'admin.claim': 'fn-admin',
    'admin.join': 'fn-admin',
    'admins.invite': 'fn-admin',
    'admins.revoke': 'fn-admin',
    'admins.list': 'fn-admin',
    'history.revert': 'fn-admin',
    'telemetry.listGroups': 'fn-admin',
    'setup.status': 'fn-admin',
    'setup.selfTest': 'fn-admin',
    'setup.recordCloud': 'fn-admin',
    'setup.createCity': 'fn-admin',
    'setup.saveMapbox': 'fn-admin',
    'setup.saveUsgs': 'fn-admin',
    'setup.rotatePublicToken': 'fn-admin',
    'setup.analyticsConfig': 'fn-admin',
    'publish.rebuildManifest': 'fn-admin',
    'photos.reprocess': 'fn-admin',
    'telemetry.reportError': 'fn-events',
    'history.onCityWrite': 'fn-events',
    'history.onLayerWrite': 'fn-events',
    'history.onPhotoWrite': 'fn-events',
    'history.onPoiWrite': 'fn-events',
    'history.onPoiCategoryWrite': 'fn-events',
    'publish.onCityWrite': 'fn-events',
    'publish.onLayerWrite': 'fn-events',
    'publish.onPhotoWrite': 'fn-events',
    'publish.onPoiWrite': 'fn-events',
    'publish.onPoiCategoryWrite': 'fn-events',
    'publish.buildManifest': 'fn-events',
    'photos.onUpload': 'fn-events',
    'ops.tick': 'fn-admin',
    'ops.onBudget': 'fn-admin',
};

/**
 * The deploy option that makes function `name` run as its account. `fn-admin@` is firebase-tools' shorthand for
 * `fn-admin@<project>.iam.gserviceaccount.com`, so the code names no project. Every trigger spreads it into its options.
 */
export function runAs(name: FunctionName): { readonly serviceAccount: string } {
    return { serviceAccount: `${RUNTIME_ACCOUNTS[name]}@` };
}

/**
 * Defaults for every function (docs/research/PLAN.md "Region"; security review §3.4): everything in us-central1, next
 * to the nam5 Firestore and inside the free tier; a low instance cap as a spend guard (each function sets its own,
 * lower where the registry says so); Cloud Run's concurrency of 80 stated, so a later CPU change cannot silently turn
 * it into 1 (`photos.onUpload` takes one upload at a time); and `fn-events@`, the account with fewer rights, for a
 * function that forgot `runAs`, never the compute default account. Every trigger module imports this file first,
 * because firebase-functions reads the global options when a function is declared.
 */
export const GLOBAL_OPTIONS: GlobalOptions = { region: 'us-central1', maxInstances: 5, concurrency: 80, serviceAccount: 'fn-events@' };

setGlobalOptions(GLOBAL_OPTIONS);
