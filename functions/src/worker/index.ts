/**
 * The local worker's callables (fn-worker, `docs/research/M7-local-worker.md` §2.4): `functions/src/index.ts` exports
 * `worker = workerFunctions(getDeps)`, which Firebase deploys as `worker-hello`, `worker-claim`, `worker-step`,
 * `worker-urls` and `worker-end`. Access `cityEditor`, App Check off (a process on the owner's computer cannot be
 * attested): each call is bound to the one job the caller's worker claimed.
 */
import type { CallableDeps } from '../api/callable.js';
import { claimFunction, type ClaimDeps } from './claim.js';
import { endFunction, type EndDeps } from './end.js';
import { helloFunction, type HelloDeps } from './hello.js';
import { pairCodeFunction, type PairCodeDeps } from './pair-code.js';
import { pairFunction, type PairDeps } from './pair.js';
import { revokeFunction, type RevokeDeps } from './revoke.js';
import { stepFunction, type StepDeps } from './step.js';
import { urlsFunction, type UrlsDeps } from './urls.js';

export type WorkerFamilyDeps = CallableDeps & HelloDeps & ClaimDeps & StepDeps & UrlsDeps & EndDeps & PairDeps & PairCodeDeps & RevokeDeps;

/**
 * `worker.hello`, `worker.claim`, `worker.step`, `worker.urls`, `worker.end`; finding 67's pairing: `worker.pair` (the
 * worker's one-time code exchanged for a sign-in), `worker.pairCode` and `worker.revoke` (the admin's).
 */
export function workerFunctions(getDeps: () => WorkerFamilyDeps) {
    return {
        hello: helloFunction(getDeps),
        claim: claimFunction(getDeps),
        step: stepFunction(getDeps),
        urls: urlsFunction(getDeps),
        end: endFunction(getDeps),
        pair: pairFunction(getDeps),
        pairCode: pairCodeFunction(getDeps),
        revoke: revokeFunction(getDeps),
    };
}
