/**
 * M7's local worker as its elements read it (`docs/research/M7-local-worker.md` §7), mirroring
 * `packages/admin/src/worker/feed.ts` structurally (`packages/admin/test/app/admin-port.test.ts` checks it at compile
 * time). The elements get their feed from the Jobs area's store (`JobsIntentsPort.worker`), which the page they sit on
 * loads through the app (`WorkerHostPort`: the Jobs page, the pipeline card, a version's page).
 */
import type { JobStatus, JobWaitReason, RunChoice, RunPlace } from '@hcm/shared';

import type { LoadStatusPort, StoreFailurePort } from '../area-port.js';
import type { AdminNoticeInputPort } from '../notice-port.js';

export interface CloudRunUsePort {
    readonly vcpuSeconds: number;
    readonly gibSeconds: number;
}

export interface WorkerSeenPort {
    readonly id: string;
    readonly state: 'idle' | 'busy';
    readonly seenAt: string;
    readonly jobId: string | null;
    readonly lastJob: { readonly id: string; readonly outcome: 'done' | 'failed'; readonly at: string } | null;
}

export interface WorkerJobPort {
    readonly id: string;
    readonly status: JobStatus;
    readonly runOn: RunPlace | null;
    readonly waitReason: JobWaitReason | null;
    readonly estimate: CloudRunUsePort;
}

export interface WorkerViewPort {
    readonly city: string;
    readonly status: LoadStatusPort;
    readonly failure: StoreFailurePort | null;
    readonly worker: WorkerSeenPort | null;
    readonly connected: boolean;
    readonly choice: RunChoice;
    /** The pipeline image's digest; null without one, undefined while asked for. */
    readonly image: string | null | undefined;
    readonly usage: CloudRunUsePort;
    readonly job: WorkerJobPort | null;
    readonly acting: boolean;
    readonly refusal: AdminNoticeInputPort | null;
}

interface WorkerIntentsPort {
    setChoice(choice: RunChoice): Promise<boolean>;
    runJob(runOn: RunPlace, freeTierOk: boolean): Promise<boolean>;
    retry(): void;
}

/** One element's feed: started when it connects (with its version's job, if any), stopped when it goes. */
export interface WorkerFeedPort {
    readonly state: WorkerViewPort;
    subscribe(listener: (state: WorkerViewPort) => void): () => void;
    readonly intents: WorkerIntentsPort;
    start(jobId: string | null): void;
    stop(): void;
}

/** What the elements need of the admin app (`AdminAppPort`): the Jobs area's chunk and its store, which hands out feeds. */
export interface WorkerHostPort {
    loadPage(id: 'jobs'): Promise<unknown>;
    readonly content: {
        readonly jobs: { readonly intents: { worker?(): Promise<WorkerFeedPort>; workerElements?(): Promise<void> } } | null;
    };
}
