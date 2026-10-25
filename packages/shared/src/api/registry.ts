/**
 * Every function of the M2 backend in one table (`docs/research/M2-interfaces.md` §3): the callables with their access
 * rule, App Check mode and zod request/response, the public HTTPS endpoint, and the background functions. The
 * functions validate every request and response against it, the admin calls `httpsCallable(functions,
 * deployedName(name))` and validates the answer, the integrator's `functions/src/index.ts` exports exactly these names
 * (its test compares them), and the e2e mock server answers from the same schemas.
 */
import type { z } from 'zod';

import {
    claimRequestSchema,
    claimResponseSchema,
    inviteResponseSchema,
    joinRequestSchema,
    joinResponseSchema,
    revokeResponseSchema,
    sessionRequestSchema,
    sessionResponseSchema,
} from './admin.js';
import {
    citiesCreateRequestSchema,
    citiesCreateResponseSchema,
    citiesLocateRequestSchema,
    citiesLocateResponseSchema,
    citiesSetLimitsRequestSchema,
    citiesSetLimitsResponseSchema,
    cityAdminsListRequestSchema,
    cityAdminsListResponseSchema,
    cityInviteRequestSchema,
    cityRevokeRequestSchema,
    citySetRoleRequestSchema,
    citySetRoleResponseSchema,
} from './cities.js';
import {
    EXPORT_QUEUE,
    exportDownloadRequestSchema,
    exportDownloadResponseSchema,
    exportStartRequestSchema,
    exportStartResponseSchema,
} from './city-export.js';
import {
    MANIFEST_QUEUE,
    OPS_TICK_SCHEDULE,
    rebuildManifestRequestSchema,
    rebuildManifestResponseSchema,
    reprocessPhotoRequestSchema,
    reprocessPhotoResponseSchema,
} from './content.js';
import { revertRequestSchema, revertResponseSchema } from './history.js';
import { ASSIST_GEOCODE_QUEUE } from '../schemas/assist.js';
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
import {
    assistSuggestTitleRequestSchema,
    assistSuggestTitleResponseSchema,
    assistTranslateDraftRequestSchema,
    assistTranslateDraftResponseSchema,
} from './assist.js';
import {
    notifyRegisterDeviceRequestSchema,
    notifyRegisterDeviceResponseSchema,
    notifySendTestRequestSchema,
    notifySendTestResponseSchema,
    notifyUnregisterDeviceRequestSchema,
    notifyUnregisterDeviceResponseSchema,
} from './notify.js';
import { layerDeleteRequestSchema, layerDeleteResponseSchema, layerLinkRequestSchema, layerLinkResponseSchema } from './layers.js';
import {
    usgsCancelOrderRequestSchema,
    usgsCancelOrderResponseSchema,
    usgsCheckOrderRequestSchema,
    usgsCheckOrderResponseSchema,
    usgsMarkOrderedRequestSchema,
    usgsMarkOrderedResponseSchema,
} from './orders.js';
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
 * `docs/research/M3-interfaces.md` §9, the M3 raster backend; `fn-orders` and `fn-assist-notify`:
 * `docs/research/M4-interfaces.md` §6, the M4 orders, assists and notifications; `fn-cities`:
 * `docs/research/M5-interfaces.md` §6, the M5 multi-city workstream; `fn-export`: the M5 static export, §5).
 */
export const FUNCTION_OWNERS = [
    'fn-admin',
    'fn-setup',
    'fn-content',
    'fn-imagery',
    'fn-orders',
    'fn-assist-notify',
    'fn-cities',
    'fn-export',
] as const;
export type FunctionOwner = (typeof FUNCTION_OWNERS)[number];

/**
 * `signedIn`: a verified Google account (`email_verified`, `sign_in_provider == 'google.com'`), admin or not.
 * `admin`: also the `admin` claim and an `admins/{uid}` document (the rules' `isAdmin()`).
 * M5 (`docs/research/M5-interfaces.md` §1.3), each an `admin` too: `cityEditor` has a role in the request's `cityId`,
 * `cityOwner` owns it (both checked once the request is valid, before the handler reads anything), `projectOwner` is the
 * account that claimed the project (`admins/{uid}.role == 'owner'`).
 */
export type CallableAccess = 'signedIn' | 'admin' | 'cityEditor' | 'cityOwner' | 'projectOwner';

/** The accesses that name a city: their requests carry `cityId` at the top level (the registry's test checks it). */
export const CITY_ACCESSES: readonly CallableAccess[] = ['cityEditor', 'cityOwner'];

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

/** The row builder of one of M5's narrower accesses (`docs/research/M5-interfaces.md` §1.3), otherwise as `adminCallable`. */
function scoped<Access extends CallableAccess>(access: Access) {
    return <Request extends z.ZodType, Response extends z.ZodType>(
        owner: FunctionOwner,
        request: Request,
        response: Response,
        appCheck: AppCheckMode = 'enforce',
    ) => ({ access, appCheck, maxInstances: 3, request, response, owner }) as const;
}

const cityEditor = scoped('cityEditor');
const cityOwner = scoped('cityOwner');
const projectOwner = scoped('projectOwner');

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
    // M5 (docs/research/M5-interfaces.md §1.3, §1.7): a city's owner invites, removes and sets its admins' roles; its
    // members list them.
    'admins.invite': cityOwner('fn-admin', cityInviteRequestSchema, inviteResponseSchema),
    'admins.revoke': cityOwner('fn-admin', cityRevokeRequestSchema, revokeResponseSchema),
    'admins.list': cityEditor('fn-admin', cityAdminsListRequestSchema, cityAdminsListResponseSchema),
    'history.revert': cityEditor('fn-admin', revertRequestSchema, revertResponseSchema),
    'telemetry.listGroups': adminCallable('fn-admin', listGroupsRequestSchema, listGroupsResponseSchema),
    'setup.status': adminCallable('fn-setup', statusRequestSchema, setupStatusViewSchema),
    'setup.selfTest': adminCallable('fn-setup', selfTestRequestSchema, selfTestResponseSchema),
    // M5: the project's own settings are its owner's (docs/research/M5-interfaces.md §1.3); a city's viewer token is its owner's.
    'setup.recordCloud': projectOwner('fn-setup', recordCloudRequestSchema, recordCloudResponseSchema),
    'setup.createCity': projectOwner('fn-setup', createCityRequestSchema, createCityResponseSchema),
    'setup.saveMapbox': projectOwner('fn-setup', saveMapboxRequestSchema, saveMapboxResponseSchema, 'consume'),
    'setup.saveUsgs': projectOwner('fn-setup', saveUsgsRequestSchema, saveUsgsResponseSchema, 'consume'),
    'setup.rotatePublicToken': cityOwner('fn-setup', rotatePublicTokenRequestSchema, rotatePublicTokenResponseSchema, 'consume'),
    'setup.analyticsConfig': projectOwner('fn-setup', analyticsConfigRequestSchema, analyticsConfigResponseSchema),
    'publish.rebuildManifest': cityEditor('fn-content', rebuildManifestRequestSchema, rebuildManifestResponseSchema),
    'photos.reprocess': cityEditor('fn-content', reprocessPhotoRequestSchema, reprocessPhotoResponseSchema),
    'layers.delete': cityEditor('fn-content', layerDeleteRequestSchema, layerDeleteResponseSchema, 'consume'),
    'layers.link': cityEditor('fn-content', layerLinkRequestSchema, layerLinkResponseSchema),
    'imagery.search': cityEditor('fn-imagery', imagerySearchRequestSchema, imagerySearchResponseSchema),
    'imagery.browse': cityEditor('fn-imagery', imageryBrowseRequestSchema, imageryBrowseResponseSchema),
    'imagery.import': cityEditor('fn-imagery', imageryImportRequestSchema, imageryImportResponseSchema),
    'imagery.approve': cityEditor('fn-imagery', imageryVersionRequestSchema, imageryApproveResponseSchema),
    'imagery.reject': cityEditor('fn-imagery', imageryVersionRequestSchema, imageryRejectResponseSchema),
    'imagery.choose': cityEditor('fn-imagery', imageryChooseRequestSchema, imageryChooseResponseSchema, 'consume'),
    'imagery.studioDone': cityEditor('fn-imagery', imageryVersionRequestSchema, imageryStudioDoneResponseSchema),
    'imagery.saveGcps': cityEditor('fn-imagery', imagerySaveGcpsRequestSchema, imagerySaveGcpsResponseSchema),
    'imagery.crop': cityEditor('fn-imagery', imageryCropRequestSchema, imageryCropResponseSchema),
    'imagery.retry': cityEditor('fn-imagery', imageryRetryRequestSchema, imageryRetryResponseSchema),
    'imagery.probeTiles': cityEditor('fn-imagery', imageryProbeRequestSchema, imageryProbeResponseSchema),
    // M5: the budget guard is the project's (docs/research/M5-interfaces.md §1.3).
    'imagery.resumeGuard': projectOwner('fn-imagery', imageryResumeGuardRequestSchema, imageryResumeGuardResponseSchema, 'consume'),
    // M4 orders (owner fn-orders, docs/research/M4-interfaces.md §1.4): "I ordered it", "Check now", "Take the mark back".
    'usgs.markOrdered': cityEditor('fn-orders', usgsMarkOrderedRequestSchema, usgsMarkOrderedResponseSchema),
    'usgs.checkOrder': cityEditor('fn-orders', usgsCheckOrderRequestSchema, usgsCheckOrderResponseSchema),
    'usgs.cancelOrder': cityEditor('fn-orders', usgsCancelOrderRequestSchema, usgsCancelOrderResponseSchema),
    // M4 assists and notifications (owner fn-assist-notify, docs/research/M4-interfaces.md §4, §5).
    'assist.suggestTitle': cityEditor('fn-assist-notify', assistSuggestTitleRequestSchema, assistSuggestTitleResponseSchema),
    'assist.translateDraft': cityEditor('fn-assist-notify', assistTranslateDraftRequestSchema, assistTranslateDraftResponseSchema),
    'notify.registerDevice': adminCallable('fn-assist-notify', notifyRegisterDeviceRequestSchema, notifyRegisterDeviceResponseSchema),
    'notify.unregisterDevice': adminCallable('fn-assist-notify', notifyUnregisterDeviceRequestSchema, notifyUnregisterDeviceResponseSchema),
    'notify.sendTest': adminCallable('fn-assist-notify', notifySendTestRequestSchema, notifySendTestResponseSchema),
    // M5 many cities (owner fn-cities, docs/research/M5-interfaces.md §1.3, §1.6 to §1.8): the project owner creates cities
    // and sets their budgets; a city's owner sets its admins' roles.
    'cities.create': projectOwner('fn-cities', citiesCreateRequestSchema, citiesCreateResponseSchema),
    'cities.locate': projectOwner('fn-cities', citiesLocateRequestSchema, citiesLocateResponseSchema),
    'cities.setLimits': projectOwner('fn-cities', citiesSetLimitsRequestSchema, citiesSetLimitsResponseSchema),
    'admins.setRole': cityOwner('fn-admin', citySetRoleRequestSchema, citySetRoleResponseSchema),
    // M5 static export (owner fn-export, docs/research/M5-interfaces.md §5.3): a city's owners export it and download it.
    'export.start': cityOwner('fn-export', exportStartRequestSchema, exportStartResponseSchema),
    'export.download': cityOwner('fn-export', exportDownloadRequestSchema, exportDownloadResponseSchema),
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
    // M4 assists and notifications (owner fn-assist-notify).
    'assist.geocode': { trigger: 'taskQueue', source: ASSIST_GEOCODE_QUEUE, owner: 'fn-assist-notify' },
    'notify.onEvent': { trigger: 'firestore', source: 'notificationEvents/{eventId}', owner: 'fn-assist-notify' },
    // M5 static export (owner fn-export): the zip's build, one task per export.
    'export.build': { trigger: 'taskQueue', source: EXPORT_QUEUE, owner: 'fn-export' },
} as const satisfies Readonly<Record<string, { trigger: BackgroundTrigger; source: string; owner: FunctionOwner }>>;

/** Firebase names a function after its export path: the namespace `admin` and the export `claim` deploy as `admin-claim`. */
export function deployedName(name: string): string {
    return name.replace('.', '-');
}
