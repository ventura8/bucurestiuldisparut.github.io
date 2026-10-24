import { CALLABLES, validate, type CallableName, type CallableRequest, type CallableResponse, type Logger } from '@hcm/shared';
import { onCall, type CallableFunction, type CallableOptions } from 'firebase-functions/https';

import { runAs } from '../global-options.js';
import type { AdminDirectory } from '../ports/admin-directory.js';
import { requireAccess, type Caller, type VerifiedCaller } from './access.js';
import { ApiError, toHttpsError } from './api-error.js';

/** What every callable needs from the composition root, besides the ports its handler picks. */
export interface CallableDeps {
    readonly log: Logger;
    readonly admins: AdminDirectory;
}

/** A pure handler: validated input in, a response that `CALLABLES[name].response` accepts out; failures are `ApiError`s. */
export type CallableHandler<N extends CallableName, D> = (
    deps: D,
    caller: VerifiedCaller,
    data: CallableRequest<N>,
) => Promise<CallableResponse<N>>;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Callables that may run longer than the default 60 s (`docs/research/M3-interfaces.md` §3.5, CR-M3-22): the first
 * harvest searches three datasets, up to five pages each, and copies the best browse images ahead. The admin asks with
 * a timeout just over it (`IMAGERY_SEARCH_TIMEOUT_MS` of `packages/admin/src/imagery/search.ts`).
 */
const CALLABLE_TIMEOUT_SECONDS: Readonly<Partial<Record<CallableName, number>>> = { 'imagery.search': 300 };

/**
 * The deploy options of a callable: its `maxInstances`, a longer timeout where `CALLABLE_TIMEOUT_SECONDS` names one,
 * its runtime service account (`runAs`: `fn-admin@` for every callable), and App Check from `HCM_APP_CHECK` (security review §1.6: one week of `monitor`, which leaves enforcement
 * off, then `enforce`); `consume` callables then also consume the token (replay protection for ownership and secret
 * pastes).
 */
export function callableOptions(name: CallableName, env: Env): CallableOptions {
    const spec = CALLABLES[name];
    const enforce = env['HCM_APP_CHECK'] === 'enforce';
    const timeoutSeconds = CALLABLE_TIMEOUT_SECONDS[name];
    return {
        maxInstances: spec.maxInstances,
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
        ...runAs(name),
        enforceAppCheck: enforce,
        consumeAppCheckToken: enforce && spec.appCheck === 'consume',
    };
}

/**
 * One callable call without firebase-functions: access rule, request validation (`apiError.invalidRequest` with the
 * field issues), the handler, then the response checked against its schema (a mismatch is a server bug: logged,
 * answered `apiError.internal`, never sent).
 */
export async function runCallable<N extends CallableName, D extends CallableDeps>(
    name: N,
    handler: CallableHandler<N, D>,
    deps: D,
    request: { readonly auth: Caller | undefined; readonly data: unknown },
): Promise<CallableResponse<N>> {
    const spec = CALLABLES[name];
    const caller = await requireAccess(spec.access, request.auth, deps.admins);
    const input = validate<unknown>(spec.request, request.data);
    if (!input.ok) {
        throw new ApiError('apiError.invalidRequest', undefined, input.issues);
    }
    // The registry pairs each name with its schemas; TypeScript cannot narrow `CALLABLES[N]` for a generic N.
    const output = validate<unknown>(spec.response, await handler(deps, caller, input.value as CallableRequest<N>));
    if (!output.ok) {
        deps.log.error('callable response does not match its schema', { callable: name, issues: output.issues.length });
        throw new ApiError('apiError.internal');
    }
    return output.value as CallableResponse<N>;
}

/**
 * The callable `name` of the registry (`@hcm/shared` → `CALLABLES`), deployed as `deployedName(name)` by the export
 * path in `functions/src/index.ts`. Every failure leaves as `HttpsError(status, code, details)` (`toHttpsError`).
 */
export function defineCallable<N extends CallableName, D extends CallableDeps>(
    name: N,
    handler: CallableHandler<N, D>,
    getDeps: () => D,
    env: Env = process.env,
): CallableFunction<unknown, Promise<CallableResponse<N>>> {
    return onCall(callableOptions(name, env), async (request) => {
        const deps = getDeps();
        try {
            return await runCallable(name, handler, deps, { auth: request.auth, data: request.data });
        } catch (error) {
            throw toHttpsError(error, deps.log.child(name));
        }
    });
}
