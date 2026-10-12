import type { Logger } from '@hcm/shared';

import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { UsgsApi } from '../ports/usgs-api.js';
import { at, failureOfStatus, readJson, send, strings, upstreamError, type Fetch } from './upstream-http.js';

/**
 * USGS M2M (EarthExplorer machine-to-machine) over REST with `fetch` (`.agent/skills/pipeline/usgs_m2m_skill.md`,
 * security review §4.2). The body is read on every status, because M2M answers its own errors as HTTP 500 JSON with an
 * `errorCode`, while the gateway in front of it answers HTML:
 *
 * | Answer | Failure |
 * | --- | --- |
 * | HTML 403 | `unauthorized` (an invalid or expired application token) |
 * | HTML 503 ("Application Offline") | `maintenance` (monthly, often on Wednesdays; retried later, never a hard failure) |
 * | 429, an `errorCode` starting with `RATE_LIMIT` | `rateLimited` |
 * | `AUTH_INVALID`, `AUTH_KEY_INVALID` | `unauthorized` |
 * | `AUTH_UNAUTHORIZED` (and the API's own spelling `AUTH_UNAUTHROIZED`) | `forbidden`: the account has no M2M access yet |
 * | another `errorCode` | `invalid` |
 * | other 5xx, network, timeout | `unavailable` |
 *
 * The application token goes only into the `login-token` body, the API key only into the `X-Auth-Token` header; the
 * error code is logged (it is not secret), the error message is not (it may repeat the username).
 */
export const USGS_M2M_API = 'https://m2m.cr.usgs.gov/api/api/json/stable';

const SERVICE = 'usgs';
const HTML_FAILURES: ReadonlyMap<number, UpstreamFailure> = new Map([
    [403, 'unauthorized'],
    [503, 'maintenance'],
]);
const ERROR_CODES: ReadonlyMap<string, UpstreamFailure> = new Map([
    ['AUTH_INVALID', 'unauthorized'],
    ['AUTH_KEY_INVALID', 'unauthorized'],
    ['AUTH_UNAUTHORIZED', 'forbidden'],
    ['AUTH_UNAUTHROIZED', 'forbidden'],
]);

function errorCodeFailure(code: string): UpstreamFailure {
    return code.startsWith('RATE_LIMIT') ? 'rateLimited' : (ERROR_CODES.get(code) ?? 'invalid');
}

function errorCodeOf(answer: unknown): string | undefined {
    const code = at(answer, 'errorCode');
    return typeof code === 'string' && code !== '' ? code : undefined;
}

/** The failure an M2M answer reports, or undefined for a success (`answer` is undefined when it was not JSON). */
function m2mFailure(response: Response, answer: unknown): UpstreamFailure | undefined {
    if (answer === undefined) {
        return HTML_FAILURES.get(response.status) ?? failureOfStatus(response.status);
    }
    const errorCode = errorCodeOf(answer);
    if (errorCode !== undefined) {
        return errorCodeFailure(errorCode);
    }
    return response.ok ? undefined : failureOfStatus(response.status);
}

interface UsgsOptions {
    readonly fetch: Fetch;
    readonly log: Logger;
}

export function createUsgsApi(options: UsgsOptions): UsgsApi {
    /** One M2M call: the `data` of a successful answer, else the failure of the table above. */
    async function m2m(endpoint: string, body: unknown, apiKey?: string): Promise<unknown> {
        const json = { 'content-type': 'application/json' };
        const headers = apiKey === undefined ? json : { ...json, 'x-auth-token': apiKey };
        const response = await send(options.fetch, SERVICE, `${USGS_M2M_API}/${endpoint}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        const answer = await readJson(response);
        const failure = m2mFailure(response, answer);
        if (failure !== undefined) {
            options.log.warn('usgs m2m call failed', { endpoint, status: response.status, errorCode: errorCodeOf(answer) });
            throw upstreamError(SERVICE, response, failure);
        }
        return at(answer, 'data');
    }

    return {
        login: async (username, applicationToken) => {
            const apiKey = await m2m('login-token', { username, token: applicationToken });
            if (typeof apiKey !== 'string' || apiKey === '') {
                throw new UpstreamError(SERVICE, 'invalid');
            }
            return apiKey;
        },
        permissions: async (apiKey) => {
            const permissions = await m2m('permissions', {}, apiKey);
            if (!Array.isArray(permissions)) {
                throw new UpstreamError(SERVICE, 'invalid');
            }
            return strings(permissions);
        },
        logout: async (apiKey) => {
            try {
                await m2m('logout', {}, apiKey);
            } catch (error) {
                options.log.debug('usgs logout failed (the key expires by itself)', { error: String(error) });
            }
        },
    };
}
