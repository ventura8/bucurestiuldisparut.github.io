/**
 * Every function of the M2 backend in one table (`docs/research/M2-interfaces.md` §3): the callables with their access
 * rule, App Check mode and zod request/response, the public HTTPS endpoint, and the background functions. The
 * functions validate every request and response against it, the admin calls `httpsCallable(functions,
 * deployedName(name))` and validates the answer, the integrator's `functions/src/index.ts` exports exactly these names
 * (its test compares them), and the e2e mock server answers from the same schemas.
 */
import type { z } from 'zod';

import {
    adminsListRequestSchema,
    adminsListResponseSchema,
    claimRequestSchema,
    claimResponseSchema,
    inviteRequestSchema,
    inviteResponseSchema,
    joinRequestSchema,
    joinResponseSchema,
    revokeRequestSchema,
    revokeResponseSchema,
    sessionRequestSchema,
    sessionResponseSchema,
} from './admin.js';
import {
    MANIFEST_QUEUE,
    OPS_TICK_SCHEDULE,
    rebuildManifestRequestSchema,
    rebuildManifestResponseSchema,
    reprocessPhotoRequestSchema,
    reprocessPhotoResponseSchema,
} from './content.js';
import { revertRequestSchema, revertResponseSchema } from './history.js';
import {
    IMAGERY_PUBLISH_QUEUE,
    IMAGERY_TICK_SCHEDULE,
    imageryApproveResponseSchema,
    imageryBrowseRequestSchema,
    imageryBrowseResponseSchema,
    imageryChooseRequestSchema,
    imageryChooseResponseSchema,
    imageryCropRequestSchema,
    imageryCropResponseSchema,
    imageryImportRequestSchema,
    imageryImportResponseSchema,
    imageryProbeRequestSchema,
    imageryProbeResponseSchema,
    imageryRejectResponseSchema,
    imageryResumeGuardRequestSchema,
    imageryResumeGuardResponseSchema,
    imageryRetryRequestSchema,
    imageryRetryResponseSchema,
    imagerySaveGcpsRequestSchema,
    imagerySaveGcpsResponseSchema,
    imagerySearchRequestSchema,
    imagerySearchResponseSchema,
    imageryStudioDoneResponseSchema,
    imageryVersionRequestSchema,
} from './imagery.js';
import { layerDeleteRequestSchema, layerDeleteResponseSchema, layerLinkRequestSchema, layerLinkResponseSchema } from './layers.js';
import {
    analyticsConfigRequestSchema,
    analyticsConfigResponseSchema,
    createCityRequestSchema,
    createCityResponseSchema,
    recordCloudRequestSchema,
    recordCloudResponseSchema,
    rotatePublicTokenRequestSchema,
    rotatePublicTokenResponseSchema,
    saveMapboxRequestSchema,
    saveMapboxResponseSchema,
    saveUsgsRequestSchema,
    saveUsgsResponseSchema,
    selfTestRequestSchema,
    selfTestResponseSchema,
    statusRequestSchema,
    setupStatusViewSchema,
} from './setup.js';
import { ERROR_REPORT_MAX_BYTES, errorReportSchema, listGroupsRequestSchema, listGroupsResponseSchema } from './telemetry.js';

/**
 * The workstreams that implement the functions (`docs/research/M2-interfaces.md` §5; `fn-imagery`:
 * `docs/research/M3-interfaces.md` §9, the M3 raster backend).
 */
export const FUNCTION_OWNERS = ['fn-admin', 'fn-setup', 'fn-content', 'fn-imagery'] as const;
export type FunctionOwner = (typeof FUNCTION_OWNERS)[number];

/**
 * `signedIn`: a verified Google account (`email_verified`, `sign_in_provider == 'google.com'`), admin or not.
 * `admin`: also the `admin` claim and an `admins/{uid}` document (the rules' `isAdmin()`).
 */
export type CallableAccess = 'signedIn' | 'admin';

/** `consume`: a replay-protected App Check token (`consumeAppCheckToken`), for ownership and secret pastes. */
export type AppCheckMode = 'enforce' | 'consume';

export interface CallableSpec {
    readonly access: CallableAccess;
    readonly appCheck: AppCheckMode;
    readonly maxInstances: number;
    readonly request: z.ZodType;
    readonly response: z.ZodType;
    readonly owner: FunctionOwner;
}

/** An admin-only callable (`access: 'admin'`, three instances at most), its schemas keeping their types. */
function adminCallable<Request extends z.ZodType, Response extends z.ZodType>(
    owner: FunctionOwner,
    request: Request,
    response: Response,
    appCheck: AppCheckMode = 'enforce',
) {
    return { access: 'admin', appCheck, maxInstances: 3, request, response, owner } as const;
}

export const CALLABLES = {
    'admin.session': {
        access: 'signedIn',
        appCheck: 'enforce',
        maxInstances: 3,
        request: sessionRequestSchema,
        response: sessionResponseSchema,
        owner: 'fn-admin',
    },
    'admin.claim': {
        access: 'signedIn',
        appCheck: 'consume',
        maxInstances: 2,
        request: claimRequestSchema,
        response: claimResponseSchema,
        owner: 'fn-admin',
    },
    'admin.join': {
        access: 'signedIn',
        appCheck: 'consume',
        maxInstances: 2,
        request: joinRequestSchema,
        response: joinResponseSchema,
        owner: 'fn-admin',
    },
    'admins.invite': adminCallable('fn-admin', inviteRequestSchema, inviteResponseSchema),
    'admins.revoke': adminCallable('fn-admin', revokeRequestSchema, revokeResponseSchema),
    'admins.list': adminCallable('fn-admin', adminsListRequestSchema, adminsListResponseSchema),
    'history.revert': adminCallable('fn-admin', revertRequestSchema, revertResponseSchema),
    'telemetry.listGroups': adminCallable('fn-admin', listGroupsRequestSchema, listGroupsResponseSchema),
    'setup.status': adminCallable('fn-setup', statusRequestSchema, setupStatusViewSchema),
    'setup.selfTest': adminCallable('fn-setup', selfTestRequestSchema, selfTestResponseSchema),
    'setup.recordCloud': adminCallable('fn-setup', recordCloudRequestSchema, recordCloudResponseSchema),
    'setup.createCity': adminCallable('fn-setup', createCityRequestSchema, createCityResponseSchema),
    'setup.saveMapbox': adminCallable('fn-setup', saveMapboxRequestSchema, saveMapboxResponseSchema, 'consume'),
    'setup.saveUsgs': adminCallable('fn-setup', saveUsgsRequestSchema, saveUsgsResponseSchema, 'consume'),
    'setup.rotatePublicToken': adminCallable('fn-setup', rotatePublicTokenRequestSchema, rotatePublicTokenResponseSchema, 'consume'),
    'setup.analyticsConfig': adminCallable('fn-setup', analyticsConfigRequestSchema, analyticsConfigResponseSchema),
    'publish.rebuildManifest': adminCallable('fn-content', rebuildManifestRequestSchema, rebuildManifestResponseSchema),
    'photos.reprocess': adminCallable('fn-content', reprocessPhotoRequestSchema, reprocessPhotoResponseSchema),
    'layers.delete': adminCallable('fn-content', layerDeleteRequestSchema, layerDeleteResponseSchema, 'consume'),
    'layers.link': adminCallable('fn-content', layerLinkRequestSchema, layerLinkResponseSchema),
    'imagery.search': adminCallable('fn-imagery', imagerySearchRequestSchema, imagerySearchResponseSchema),
    'imagery.browse': adminCallable('fn-imagery', imageryBrowseRequestSchema, imageryBrowseResponseSchema),
    'imagery.import': adminCallable('fn-imagery', imageryImportRequestSchema, imageryImportResponseSchema),
    'imagery.approve': adminCallable('fn-imagery', imageryVersionRequestSchema, imageryApproveResponseSchema),
    'imagery.reject': adminCallable('fn-imagery', imageryVersionRequestSchema, imageryRejectResponseSchema),
    'imagery.choose': adminCallable('fn-imagery', imageryChooseRequestSchema, imageryChooseResponseSchema, 'consume'),
    'imagery.studioDone': adminCallable('fn-imagery', imageryVersionRequestSchema, imageryStudioDoneResponseSchema),
    'imagery.saveGcps': adminCallable('fn-imagery', imagerySaveGcpsRequestSchema, imagerySaveGcpsResponseSchema),
    'imagery.crop': adminCallable('fn-imagery', imageryCropRequestSchema, imageryCropResponseSchema),
    'imagery.retry': adminCallable('fn-imagery', imageryRetryRequestSchema, imageryRetryResponseSchema),
    'imagery.probeTiles': adminCallable('fn-imagery', imageryProbeRequestSchema, imageryProbeResponseSchema),
    'imagery.resumeGuard': adminCallable('fn-imagery', imageryResumeGuardRequestSchema, imageryResumeGuardResponseSchema, 'consume'),
} as const satisfies Readonly<Record<string, CallableSpec>>;

export type CallableName = keyof typeof CALLABLES;
export type CallableRequest<N extends CallableName> = z.infer<(typeof CALLABLES)[N]['request']>;
export type CallableResponse<N extends CallableName> = z.infer<(typeof CALLABLES)[N]['response']>;

/** The public HTTPS endpoints (`onRequest`): no Firebase SDK on the caller's side. */
export const HTTP_ENDPOINTS = {
    'telemetry.reportError': {
        method: 'POST',
        maxBytes: ERROR_REPORT_MAX_BYTES,
        maxInstances: 2,
        request: errorReportSchema,
        owner: 'fn-admin',
    },
} as const;

export type BackgroundTrigger = 'firestore' | 'storage' | 'taskQueue' | 'schedule' | 'pubsub';

/** Functions nobody calls: what triggers them, and who builds them. */
export const BACKGROUND_FUNCTIONS = {
    'history.onCityWrite': { trigger: 'firestore', source: 'cities/{city}', owner: 'fn-admin' },
    'history.onLayerWrite': { trigger: 'firestore', source: 'cities/{city}/layers/{id}', owner: 'fn-admin' },
    'history.onPhotoWrite': { trigger: 'firestore', source: 'cities/{city}/photos/{id}', owner: 'fn-admin' },
    'history.onPoiWrite': { trigger: 'firestore', source: 'cities/{city}/pois/{id}', owner: 'fn-admin' },
    'history.onPoiCategoryWrite': { trigger: 'firestore', source: 'cities/{city}/poiCategories/{id}', owner: 'fn-admin' },
    'publish.onCityWrite': { trigger: 'firestore', source: 'cities/{city}', owner: 'fn-content' },
    'publish.onLayerWrite': { trigger: 'firestore', source: 'cities/{city}/layers/{id}', owner: 'fn-content' },
    'publish.onPhotoWrite': { trigger: 'firestore', source: 'cities/{city}/photos/{id}', owner: 'fn-content' },
    'publish.onPoiWrite': { trigger: 'firestore', source: 'cities/{city}/pois/{id}', owner: 'fn-content' },
    'publish.onPoiCategoryWrite': { trigger: 'firestore', source: 'cities/{city}/poiCategories/{id}', owner: 'fn-content' },
    'publish.buildManifest': { trigger: 'taskQueue', source: MANIFEST_QUEUE, owner: 'fn-content' },
    'photos.onUpload': { trigger: 'storage', source: 'uploads/photos/{city}/{uid}/{photo}/{file}', owner: 'fn-content' },
    'ops.tick': { trigger: 'schedule', source: OPS_TICK_SCHEDULE, owner: 'fn-content' },
    'ops.onBudget': { trigger: 'pubsub', source: 'budget', owner: 'fn-content' },
    'imagery.onJobWrite': { trigger: 'firestore', source: 'cities/{city}/jobs/{id}', owner: 'fn-imagery' },
    'imagery.onRasterUpload': { trigger: 'storage', source: 'uploads/rasters/{city}/{uid}/{upload}/{file}', owner: 'fn-imagery' },
    'imagery.publish': { trigger: 'taskQueue', source: IMAGERY_PUBLISH_QUEUE, owner: 'fn-imagery' },
    'imagery.tick': { trigger: 'schedule', source: IMAGERY_TICK_SCHEDULE, owner: 'fn-imagery' },
} as const satisfies Readonly<Record<string, { trigger: BackgroundTrigger; source: string; owner: FunctionOwner }>>;

/** Firebase names a function after its export path: the namespace `admin` and the export `claim` deploy as `admin-claim`. */
export function deployedName(name: string): string {
    return name.replace('.', '-');
}
