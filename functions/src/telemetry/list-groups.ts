import '../global-options.js';

import { redactText, type CallableRequest, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

export type ListGroupsDeps = Pick<Ports, 'errors' | 'log'>;

/** The role `groupStats.list` needs on the runtime service account (CR-M2-5). */
export const ERROR_REPORTING_VIEWER_ROLE = 'roles/errorreporting.viewer';

/** `listGroupsResponseSchema` keeps at most this much of a group's message. */
const MAX_MESSAGE = 500;

/** A refused call names the missing role or the disabled API; anything else Error Reporting fails with is "unavailable, retry". */
function toApiError(error: unknown, deps: ListGroupsDeps): never {
    if (!(error instanceof UpstreamError)) {
        throw error;
    }
    deps.log.warn('error reporting groups unavailable', { failure: error.failure, status: error.status });
    if (error.failure === 'forbidden' && error.api !== undefined) {
        throw new ApiError('apiError.cloud.apiDisabled', { api: error.api });
    }
    if (error.failure === 'forbidden') {
        throw new ApiError('apiError.cloud.permission', { role: ERROR_REPORTING_VIEWER_ROLE });
    }
    throw new ApiError('apiError.errorReporting.unavailable');
}

/**
 * `telemetry.listGroups` (admins; S-A22-HAPPY, S-A22-BAD-ERROR-REPORTING-UNAVAILABLE): the Setup Assistant's "Crash
 * reports" panel, newest group first. Every message is redacted again before it leaves (a group's representative
 * message is whatever a crashing page sent).
 */
async function telemetryListGroups(
    deps: ListGroupsDeps,
    _caller: VerifiedCaller,
    data: CallableRequest<'telemetry.listGroups'>,
): Promise<CallableResponse<'telemetry.listGroups'>> {
    const page = await deps.errors.listGroups(data).catch((error: unknown) => toApiError(error, deps));
    return { ...page, groups: page.groups.map((group) => ({ ...group, message: redactText(group.message).slice(0, MAX_MESSAGE) })) };
}

/** The `telemetry-listGroups` callable. */
export function listGroupsFunction(getDeps: () => ListGroupsDeps & CallableDeps) {
    return defineCallable('telemetry.listGroups', telemetryListGroups, getDeps);
}
