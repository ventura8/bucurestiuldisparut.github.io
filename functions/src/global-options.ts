import type { BACKGROUND_FUNCTIONS, CallableName, HTTP_ENDPOINTS } from '@hcm/shared';
import { setGlobalOptions, type GlobalOptions } from 'firebase-functions/options';

/** Every function of the registry (`@hcm/shared` → `CALLABLES`, `HTTP_ENDPOINTS`, `BACKGROUND_FUNCTIONS`). */
export type FunctionName = CallableName | keyof typeof HTTP_ENDPOINTS | keyof typeof BACKGROUND_FUNCTIONS;

/** The runtime service accounts of security review §1.1 (created by the bootstrap; never the compute default). */
type RuntimeAccount = 'fn-admin' | 'fn-events' | 'fn-crash';

/**
 * Who each function runs as (security review §1.1, `docs/research/M2-interfaces.md` §4.3, CR-M2-8, CR-M2-13,
 * CR-M2-29). `fn-admin@` holds the secrets, Firebase Auth and the Management and Error Reporting viewer roles, so it
 * runs every callable and `ops.*` (`DECISIONS-for-review.md` §19b: the tick retires Mapbox tokens and deletes stale
 * accounts); `fn-events@` runs the Firestore and Storage triggers and the manifest builder; `fn-crash@`, an account with
 * no role at all, runs the public crash endpoint, which only writes a log entry (Cloud Run collects a function's own
 * log lines without a role; `DECISIONS-for-review.md` §42f). A new registry name fails to compile until it is listed here.
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
    'layers.delete': 'fn-admin',
    'layers.link': 'fn-admin',
    'telemetry.reportError': 'fn-crash',
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
    'imagery.search': 'fn-admin',
    'imagery.browse': 'fn-admin',
    'imagery.import': 'fn-admin',
    'imagery.approve': 'fn-admin',
    'imagery.reject': 'fn-admin',
    'imagery.choose': 'fn-admin',
    'imagery.studioDone': 'fn-admin',
    'imagery.saveGcps': 'fn-admin',
    'imagery.crop': 'fn-admin',
    'imagery.retry': 'fn-admin',
    'imagery.probeTiles': 'fn-admin',
    'imagery.resumeGuard': 'fn-admin',
    // M4 orders (docs/research/M4-interfaces.md §1.4): the order card's callables, as every callable, fn-admin@ (USGS secrets).
    'usgs.markOrdered': 'fn-admin',
    'usgs.checkOrder': 'fn-admin',
    'usgs.cancelOrder': 'fn-admin',
    'imagery.onJobWrite': 'fn-events',
    'imagery.onRasterUpload': 'fn-events',
    'imagery.publish': 'fn-events',
    'imagery.tick': 'fn-events',
    // M4 assists and notifications (docs/research/M4-interfaces.md §4.4): the callables as fn-admin@ (Vertex AI, FCM's
    // dry run), the Nominatim queue's worker and the fan-out (FCM sends) as fn-events@.
    'assist.suggestTitle': 'fn-admin',
    'assist.translateDraft': 'fn-admin',
    'notify.registerDevice': 'fn-admin',
    'notify.unregisterDevice': 'fn-admin',
    'notify.sendTest': 'fn-admin',
    'assist.geocode': 'fn-events',
    'notify.onEvent': 'fn-events',
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
