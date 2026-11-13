/**
 * M7's local worker as its elements read it (`docs/research/M7-local-worker.md` §7), mirroring
 * `packages/admin/src/worker/feed.ts` structurally (`packages/admin/test/app/admin-port.test.ts` checks it at compile
 * time). The elements get their feed from the Jobs area's store (`JobsIntentsPort.worker`), which the page they sit on
 * loads through the app (`WorkerHostPort`: the Jobs page, the pipeline card, a version's page).
 */
import type {
    JobStatus,
    JobWaitReason,
    RunChoice,
    RunPlace,
    WorkerAi,
    WorkerMachine,
    WorkerProfileChoice,
    WorkerStarterUpdate,
} from '@hcm/shared';

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
    /** The pipeline version it runs. */
    readonly version: string;
    readonly outdated: boolean;
    readonly revoked: boolean;
    /** Its local AI (`docs/research/M10-local-ai.md`), or null for a worker older than it. */
    readonly ai: WorkerAi | null;
}

export interface WorkerJobPort {
    readonly id: string;
    readonly status: JobStatus;
    readonly runOn: RunPlace | null;
    readonly waitReason: JobWaitReason | null;
    readonly estimate: CloudRunUsePort;
    readonly step: string | null;
    readonly progress: number | null;
    readonly overdue: boolean;
    /** M20: its files are only on the computer (an archive's series): the cloud is never offered. */
    readonly localOnly?: boolean;
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

/** The systems a starter file is made for (finding 72). */
export type WorkerOsPort = 'linux' | 'mac' | 'windows';

/** A starter file as its link gives it (finding 73 of 2026-11-03): `worker.starter`'s address and the file's name. */
export interface StarterLinkPort {
    readonly url: string;
    readonly name: string;
}

/** M26's "This computer" (`packages/admin/src/worker/machine.ts`): nothing heard yet, a worker older than the governor, or its word. */
export type MachineViewPort =
    | { readonly kind: 'unknown' }
    | { readonly kind: 'old' }
    | { readonly kind: 'known'; readonly machine: WorkerMachine; readonly failed: boolean };

/** The worker's and its starter file's versions beside the installed release's (`packages/admin/src/worker/machine.ts`). */
export interface VersionsViewPort {
    readonly said: boolean;
    readonly image: string | null;
    readonly imageCurrent: boolean;
    readonly starter: string | null;
    readonly starterCurrent: boolean;
    readonly update: WorkerStarterUpdate | null;
}

/** "Use this computer" as `packages/admin/src/worker/local.ts` keeps it (finding 72 of 2026-11-02). */
export interface LocalViewPort {
    readonly os: WorkerOsPort;
    readonly phase: 'none' | 'downloaded' | 'looking' | 'connecting' | 'connected' | 'stopped';
    /** The Advanced command's one-time code (null until Advanced asked for one). */
    readonly code: string | null;
    /** Finding 73: whether the server makes the starter file; null until it answered. */
    readonly starter: boolean | null;
    /** The starter file and the removal file for `os`. */
    readonly files: { readonly install: StarterLinkPort; readonly uninstall: StarterLinkPort };
    /** M26: what the worker says of this computer. */
    readonly machine: MachineViewPort;
    /** The worker's and its starter's versions; null until it answered. */
    readonly versions: VersionsViewPort | null;
}

/** This computer's part of the panel: the starter file, the auto-pair, Stop using this computer, the Advanced command. */
export interface LocalPort {
    readonly state: LocalViewPort;
    subscribe(listener: (state: LocalViewPort) => void): () => void;
    readonly intents: {
        setOs(os: WorkerOsPort): void;
        use(): void;
        find(): void;
        stop(): Promise<void>;
        command(): Promise<void>;
        profile(choice: WorkerProfileChoice): Promise<void>;
    };
    start(): void;
    stop(): void;
}

interface WorkerIntentsPort {
    setChoice(choice: RunChoice): Promise<boolean>;
    runJob(runOn: RunPlace, freeTierOk: boolean): Promise<boolean>;
    retry(): void;
    disconnect(): Promise<boolean>;
    /** Finding 72: this computer's part, from the lazy `worker-local` chunk (its element registered first). */
    local(project: string): Promise<LocalPort>;
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
