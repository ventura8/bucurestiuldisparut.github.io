import { API_ERRORS, type ApiErrorCode } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';

/**
 * How the `setup.*` handlers turn an outside failure into what the admin sees (M2-interfaces §4.1): each call maps the
 * failures it expects to a specific error code with the parameters its message needs; an unmapped one is left to the
 * plumbing's fallback (`toHttpsError`). `setup/status` keeps the same code as an area's `detail`.
 */
type Params = Readonly<Record<string, string>>;

/** The error code (and its message parameters) each expected failure becomes. */
export type FailureMap = Readonly<Partial<Record<UpstreamFailure, readonly [ApiErrorCode, Params?]>>>;

/** `error` as the `ApiError` its failure maps to, or unchanged. */
export function mapFailure(error: unknown, map: FailureMap): unknown {
    const mapped = error instanceof UpstreamError ? map[error.failure] : undefined;
    return mapped === undefined ? error : new ApiError(mapped[0], mapped[1]);
}

/** Awaits `work`, mapping its upstream failure (anything else passes through). */
export async function upstream<T>(work: Promise<T>, map: FailureMap): Promise<T> {
    try {
        return await work;
    } catch (error) {
        throw mapFailure(error, map);
    }
}

/** Awaits a Google API call of the runtime service account (see {@link cloudFailure}). */
export async function viaCloud<T>(work: Promise<T>, role: string, transient: FailureMap): Promise<T> {
    try {
        return await work;
    } catch (error) {
        throw cloudFailure(error, role, transient);
    }
}

/** The roles the runtime service account needs (security review §1.1, M2-interfaces §4.3), named in `cloud.permission`. */
export const ROLES = {
    firebaseViewer: 'roles/firebase.viewer',
    errorReportingViewer: 'roles/errorreporting.viewer',
    storageObjectAdmin: 'roles/storage.objectAdmin',
    cloudTasksEnqueuer: 'roles/cloudtasks.enqueuer',
    datastoreUser: 'roles/datastore.user',
} as const;

/** Failures that clear up by themselves: the area reads `unavailable` and is checked again later. */
export const TRANSIENT: FailureMap = {
    rateLimited: ['apiError.rateLimited'],
    maintenance: ['apiError.unavailable'],
    unavailable: ['apiError.unavailable'],
};

export const MAPBOX_FAILURES: FailureMap = {
    ...TRANSIENT,
    unauthorized: ['apiError.mapbox.tokenInvalid'],
    maintenance: ['apiError.mapbox.unavailable'],
    unavailable: ['apiError.mapbox.unavailable'],
};

/** Creating or updating a token: a demo account (403) or unconfirmed billing details (422) refuse it. */
export const MINT_FAILURES: FailureMap = {
    ...MAPBOX_FAILURES,
    forbidden: ['apiError.mapbox.mintRefused'],
    invalid: ['apiError.mapbox.mintRefused'],
};

export const SECRET_FAILURES: FailureMap = {
    unauthorized: ['apiError.secrets.unavailable'],
    forbidden: ['apiError.secrets.unavailable'],
    notFound: ['apiError.secrets.unavailable'],
    invalid: ['apiError.secrets.unavailable'],
    ...TRANSIENT,
};

/**
 * A Google API call with the runtime service account: a 403 is the missing `role`, or the disabled API when Google
 * named it (`UpstreamError.api`, CR-M2-11); other failures map as `transient` says.
 */
function cloudFailure(error: unknown, role: string, transient: FailureMap): unknown {
    if (!(error instanceof UpstreamError) || error.failure !== 'forbidden') {
        return mapFailure(error, transient);
    }
    return error.api === undefined
        ? new ApiError('apiError.cloud.permission', { role })
        : new ApiError('apiError.cloud.apiDisabled', { api: error.api });
}

/** A failure's code and parameters as a `setup/status` area records them. */
export interface FailureRecord {
    readonly state: 'invalid' | 'unavailable';
    readonly detail: ApiErrorCode;
    readonly params?: Params;
}

/** The record of a failure: `unavailable` when retrying may help, else `invalid`; an unexpected error is `internal`. */
export function failureRecord(error: unknown): FailureRecord {
    const apiError = error instanceof ApiError ? error : new ApiError('apiError.internal');
    const state = API_ERRORS[apiError.code].retryable ? 'unavailable' : 'invalid';
    return apiError.params === undefined ? { state, detail: apiError.code } : { state, detail: apiError.code, params: apiError.params };
}
