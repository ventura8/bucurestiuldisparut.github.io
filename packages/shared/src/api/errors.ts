/**
 * How the backend reports a failure (`docs/research/M2-interfaces.md` → *Error codes*). A callable throws
 * `new HttpsError(API_ERRORS[code].status, code, details)` with `details` = {@link ApiErrorDetails}; the HTTPS endpoint
 * answers `API_ERRORS[code].httpStatus` with the same details as its JSON body. The admin shows
 * `translateApiError(locale, details.code, details.params)` and, for `apiError.invalidRequest`, each issue next to its
 * field. A code is an i18n key of `packages/shared/src/i18n/api/ro.ts`, so every failure has a Romanian and an English
 * message, and nothing user-visible is ever English-only text from the server.
 */
import { z } from 'zod';

import { isApiErrorCode, type ApiErrorCode } from '../i18n/api/index.js';
import { coded, type ValidationCode } from '../schemas/primitives.js';
import { isValidationCode, type ValidationIssue } from '../schemas/validation.js';

/** The Firebase callable error statuses the API uses (a subset of `FunctionsErrorCode`). */
export const FUNCTIONS_ERROR_STATUSES = [
    'invalid-argument',
    'unauthenticated',
    'permission-denied',
    'not-found',
    'already-exists',
    'aborted',
    'failed-precondition',
    'resource-exhausted',
    'unavailable',
    'internal',
] as const;

export type FunctionsErrorStatus = (typeof FUNCTIONS_ERROR_STATUSES)[number];

export interface ApiErrorSpec {
    /** The callable status (`HttpsError.code`). */
    readonly status: FunctionsErrorStatus;
    /** The HTTP status of the HTTPS endpoint's error response (the Firebase mapping, unless stated). */
    readonly httpStatus: number;
    /** True when the same request may succeed later without any change (the admin offers Retry). */
    readonly retryable: boolean;
}

/** The HTTP status Firebase's callable protocol uses for each status. */
const HTTP_STATUS: Readonly<Record<FunctionsErrorStatus, number>> = {
    'invalid-argument': 400,
    unauthenticated: 401,
    'permission-denied': 403,
    'not-found': 404,
    'already-exists': 409,
    aborted: 409,
    'failed-precondition': 400,
    'resource-exhausted': 429,
    unavailable: 503,
    internal: 500,
};

const RETRYABLE: ReadonlySet<FunctionsErrorStatus> = new Set(['aborted', 'resource-exhausted', 'unavailable', 'internal']);

function spec(status: FunctionsErrorStatus, httpStatus = HTTP_STATUS[status]): ApiErrorSpec {
    return { status, httpStatus, retryable: RETRYABLE.has(status) };
}

/** Every error code with its status; a code missing here (or a stray one) is a compile error. */
export const API_ERRORS: Readonly<Record<ApiErrorCode, ApiErrorSpec>> = {
    'apiError.unauthenticated': spec('unauthenticated'),
    'apiError.accountNotAllowed': spec('permission-denied'),
    'apiError.notAdmin': spec('permission-denied'),
    'apiError.appCheck': spec('unauthenticated'),
    'apiError.invalidRequest': spec('invalid-argument'),
    'apiError.notFound': spec('not-found'),
    'apiError.conflict': spec('aborted'),
    'apiError.rateLimited': spec('resource-exhausted'),
    'apiError.unavailable': spec('unavailable'),
    'apiError.internal': spec('internal'),
    'apiError.guardPaused': spec('failed-precondition'),
    'apiError.claim.tokenInvalid': spec('unauthenticated'),
    'apiError.claim.tokenMismatch': spec('permission-denied'),
    'apiError.claim.scopeMissing': spec('permission-denied'),
    'apiError.claim.notOwner': spec('permission-denied'),
    'apiError.claim.alreadyClaimed': spec('already-exists'),
    'apiError.invite.alreadyAdmin': spec('already-exists'),
    'apiError.invite.notFound': spec('not-found'),
    'apiError.invite.expired': spec('failed-precondition'),
    'apiError.revoke.owner': spec('failed-precondition'),
    'apiError.revoke.self': spec('failed-precondition'),
    'apiError.history.notFound': spec('not-found'),
    'apiError.history.nothingToRestore': spec('failed-precondition'),
    'apiError.history.invalidSnapshot': spec('failed-precondition'),
    'apiError.history.layerGone': spec('failed-precondition'),
    'apiError.mapbox.publicToken': spec('invalid-argument'),
    'apiError.mapbox.tokenFormat': spec('invalid-argument'),
    'apiError.mapbox.tokenInvalid': spec('permission-denied'),
    'apiError.mapbox.missingScopes': spec('permission-denied'),
    'apiError.mapbox.mintRefused': spec('failed-precondition'),
    'apiError.mapbox.notConfigured': spec('failed-precondition'),
    'apiError.mapbox.unavailable': spec('unavailable'),
    'apiError.usgs.credentials': spec('permission-denied'),
    'apiError.usgs.maintenance': spec('unavailable'),
    'apiError.usgs.notConfigured': spec('failed-precondition'),
    'apiError.usgs.unavailable': spec('unavailable'),
    'apiError.usgs.accessPending': spec('failed-precondition'),
    'apiError.usgs.alreadyAvailable': spec('failed-precondition'),
    'apiError.usgs.orderState': spec('failed-precondition'),
    'apiError.analytics.notEnabled': spec('failed-precondition'),
    'apiError.analytics.noWebApp': spec('failed-precondition'),
    'apiError.cloud.permission': spec('failed-precondition'),
    'apiError.cloud.apiDisabled': spec('failed-precondition'),
    'apiError.errorReporting.unavailable': spec('unavailable'),
    'apiError.secrets.unavailable': spec('failed-precondition'),
    'apiError.photo.unsupportedType': spec('invalid-argument'),
    'apiError.photo.heicUnsupported': spec('invalid-argument'),
    'apiError.photo.tooLarge': spec('invalid-argument'),
    'apiError.photo.unreadable': spec('invalid-argument'),
    'apiError.photo.duplicate': spec('already-exists'),
    'apiError.layers.alreadyLinked': spec('already-exists'),
    'apiError.layers.busy': spec('failed-precondition'),
    'apiError.layers.foreignTileset': spec('permission-denied'),
    'apiError.layers.secretInAddress': spec('invalid-argument'),
    'apiError.imagery.notScanned': spec('failed-precondition'),
    'apiError.imagery.alreadyImported': spec('already-exists'),
    'apiError.imagery.dailyLimit': spec('resource-exhausted'),
    'apiError.imagery.browseUnavailable': spec('unavailable'),
    'apiError.imagery.notTiff': spec('invalid-argument'),
    'apiError.imagery.unreadableRaster': spec('invalid-argument'),
    'apiError.imagery.processingFailed': spec('internal'),
    'apiError.imagery.archiveCorrupt': spec('failed-precondition'),
    'apiError.imagery.downloadIncomplete': spec('unavailable'),
    'apiError.imagery.referenceUnavailable': spec('unavailable'),
    'apiError.imagery.noMatch': spec('failed-precondition'),
    'apiError.imagery.noSpread': spec('failed-precondition'),
    'apiError.imagery.tooFewGcps': spec('invalid-argument'),
    'apiError.imagery.degenerateGcps': spec('invalid-argument'),
    'apiError.imagery.gcpOutside': spec('invalid-argument'),
    'apiError.imagery.cropOutsideLayer': spec('invalid-argument'),
    'apiError.imagery.noScan': spec('failed-precondition'),
    'apiError.imagery.versionState': spec('failed-precondition'),
    'apiError.imagery.overBudget': spec('failed-precondition'),
    'apiError.imagery.tilesetLimit': spec('failed-precondition'),
    'apiError.imagery.studioNotFound': spec('not-found'),
    'apiError.imagery.mtsRefused': spec('failed-precondition'),
    'apiError.imagery.sourceTooLarge': spec('failed-precondition'),
    'apiError.imagery.tilesNotFound': spec('not-found'),
    'apiError.imagery.tilesNotImage': spec('invalid-argument'),
    'apiError.imagery.tilesUnreachable': spec('unavailable'),
    'apiError.imagery.addressRefused': spec('invalid-argument'),
    'apiError.imagery.outOfMemory': spec('failed-precondition'),
    'apiError.imagery.attemptsExhausted': spec('failed-precondition'),
    'apiError.imagery.mapboxFinishing': spec('failed-precondition'),
    'apiError.telemetry.origin': spec('permission-denied'),
    'apiError.telemetry.tooLarge': spec('invalid-argument', 413),
    'apiError.assist.rateLimited': spec('resource-exhausted'),
    'apiError.assist.unavailable': spec('unavailable'),
    'apiError.assist.monthlyCap': spec('failed-precondition'),
    'apiError.assist.noDraft': spec('failed-precondition'),
    'apiError.assist.linksChanged': spec('failed-precondition'),
    'apiError.assist.dailyCap': spec('resource-exhausted'),
    'apiError.notify.deviceInvalid': spec('invalid-argument'),
};

export const apiErrorCodeSchema = z.custom<ApiErrorCode>(isApiErrorCode, coded('validation.value'));

const PARAM_NAME = /^[a-zA-Z]{1,30}$/;
const MAX_PARAMS = 10;

/** The `{placeholder}` values of a message: plain strings, never markup (rendered as text). */
export const apiErrorParamsSchema = z
    .record(z.string().regex(PARAM_NAME), z.string().max(500))
    .refine((params) => Object.keys(params).length <= MAX_PARAMS, coded('validation.tooBig'));

export const validationIssueSchema = z.strictObject({
    path: z.string().max(200),
    code: z.custom<ValidationCode>((value) => typeof value === 'string' && isValidationCode(value), coded('validation.value')),
});

/** At most this many field issues travel with `apiError.invalidRequest` (the count says how many there were). */
export const MAX_ERROR_ISSUES = 50;

/** `HttpsError.details` of every callable failure, and the JSON body of an HTTPS error response. */
export const apiErrorDetailsSchema = z.strictObject({
    code: apiErrorCodeSchema,
    params: apiErrorParamsSchema.optional(),
    issues: z.array(validationIssueSchema).max(MAX_ERROR_ISSUES).optional(),
});

export type ApiErrorDetails = z.infer<typeof apiErrorDetailsSchema>;

/** The details of a failure; `apiError.invalidRequest` gets the first issues and their total as `{count}`. */
export function apiErrorDetails(
    code: ApiErrorCode,
    params?: Readonly<Record<string, string>>,
    issues?: readonly ValidationIssue[],
): ApiErrorDetails {
    if (issues === undefined) {
        return params === undefined ? { code } : { code, params: { ...params } };
    }
    return { code, params: { ...params, count: String(issues.length) }, issues: issues.slice(0, MAX_ERROR_ISSUES) };
}

/** The code a client shows when a failure carries no readable details (a network error, an old server). */
const FALLBACK_BY_STATUS: Readonly<Record<string, ApiErrorCode>> = {
    unauthenticated: 'apiError.unauthenticated',
    'permission-denied': 'apiError.notAdmin',
    'not-found': 'apiError.notFound',
    aborted: 'apiError.conflict',
    'resource-exhausted': 'apiError.rateLimited',
    unavailable: 'apiError.unavailable',
    'deadline-exceeded': 'apiError.unavailable',
    'invalid-argument': 'apiError.invalidRequest',
};

/**
 * What a client shows for a failed call: the server's details when they validate, otherwise the generic code of the
 * status (the Firebase JS SDK reports `functions/<status>`), else `apiError.internal`. Never throws.
 */
export function apiErrorFromFailure(status: unknown, details: unknown): ApiErrorDetails {
    const parsed = apiErrorDetailsSchema.safeParse(details);
    if (parsed.success) {
        return parsed.data;
    }
    const bare = typeof status === 'string' ? status.replace(/^functions\//, '') : '';
    return { code: FALLBACK_BY_STATUS[bare] ?? 'apiError.internal' };
}
