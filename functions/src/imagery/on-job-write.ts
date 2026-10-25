import '../global-options.js';

import { BACKGROUND_FUNCTIONS, CITY_ID_PATTERN, jobDocSchema, validate, type JobDoc } from '@hcm/shared';
import { onDocumentWritten } from 'firebase-functions/firestore';

import { runAs } from '../global-options.js';
import type { Ports } from '../ports/index.js';
import { applyApprovalPolicy } from './approval.js';
import { cancelJob } from './cancel.js';
import { dispatchJob } from './dispatch.js';
import { releaseCancelled } from './end.js';
import { noticeJobChange } from './job-notices.js';

/**
 * `imagery.onJobWrite` (Firestore trigger on `cities/{city}/jobs/{job}`; `docs/research/M3-interfaces.md` §4.2): the
 * dispatcher, acting on transitions only (the job before and after compared), each in its own transaction that reads
 * the job again, so a redelivered event finds the job already moved and does nothing (S-A12-HAPPY-DISPATCH). A job that
 * becomes `queued` is dispatched; a cancellation the admin asks for is carried out; a job that reaches
 * `awaiting_approval` gets the approval policy; a job that becomes `cancelled` (the pipeline's SIGTERM handler, CR-M3-18)
 * has what it still held released.
 */
export type JobWriteDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs' | 'tasks'>;

export interface JobChange {
    readonly before: unknown;
    readonly after: unknown;
}

/** What a transition calls for. */
export type JobTransition = 'dispatch' | 'cancel' | 'approval' | 'release' | 'none';

function parsed(data: unknown): JobDoc | undefined {
    const result = data === undefined ? undefined : validate(jobDocSchema, data);
    return result?.ok === true ? result.value : undefined;
}

type Acting = Exclude<JobTransition, 'none'>;

/** The conditions whose start calls for an action, the cancellation first (it wins over anything else the write did). */
const STARTS: readonly (readonly [Acting, (job: JobDoc) => boolean])[] = [
    ['cancel', (job) => job.cancelRequested === true],
    ['dispatch', (job) => job.status === 'queued'],
    ['approval', (job) => job.status === 'awaiting_approval'],
    ['release', (job) => job.status === 'cancelled'],
];

/** The transition from `before` to `after`: the first condition that holds now and did not hold before. */
export function transitionOf(before: JobDoc | undefined, after: JobDoc): JobTransition {
    return STARTS.find(([, holds]) => holds(after) && !(before !== undefined && holds(before)))?.[0] ?? 'none';
}

const ACTIONS: Readonly<Record<Acting, (deps: JobWriteDeps, cityId: string, jobId: string) => Promise<unknown>>> = {
    dispatch: dispatchJob,
    cancel: cancelJob,
    approval: applyApprovalPolicy,
    release: releaseCancelled,
};

/** Acts on one write of a job; returns the transition it acted on. */
export async function onJobWrite(deps: JobWriteDeps, cityId: string, jobId: string, change: JobChange): Promise<JobTransition> {
    const after = parsed(change.after);
    if (after === undefined || !CITY_ID_PATTERN.test(cityId)) {
        return 'none';
    }
    const before = parsed(change.before);
    const transition = transitionOf(before, after);
    if (transition !== 'none') {
        await ACTIONS[transition](deps, cityId, jobId);
    }
    // M4 (docs/research/M4-interfaces.md §5.1, assists-notify): a failed job, a version waiting for Approve or for points.
    await noticeJobChange(deps, { cityId, jobId, job: after }, before);
    return transition;
}

/**
 * The `imagery-onJobWrite` trigger (`fn-events@`). No automatic retry: every action is idempotent and `imagery.tick`
 * catches up with what a lost event left (a queued job, a cancellation, an approval never evaluated).
 */
export function onJobWriteFunction(getDeps: () => JobWriteDeps) {
    return onDocumentWritten(
        { document: BACKGROUND_FUNCTIONS['imagery.onJobWrite'].source, retry: false, maxInstances: 5, ...runAs('imagery.onJobWrite') },
        async (event) => {
            const params = event.params as { readonly city: string; readonly id: string };
            await onJobWrite(getDeps(), params.city, params.id, { before: event.data?.before.data(), after: event.data?.after.data() });
        },
    );
}
