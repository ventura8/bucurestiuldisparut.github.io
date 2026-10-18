/**
 * The jobs area as its page reads it (`docs/research/M2c-interfaces.md` §9.3), mirroring `packages/admin/src/jobs/jobs.ts`
 * (checked at compile time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { DocStatePort, ListStatePort } from '../area-port.js';

export type JobFilterPort = 'all' | 'active' | 'failed' | 'done';

export type JobStatusPort =
    'queued' | 'starting' | 'running' | 'waiting_usgs' | 'mts_processing' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';

export interface JobItemPort {
    readonly id: string;
    readonly type: string;
    readonly status: JobStatusPort;
    readonly finished: boolean;
    readonly progress: number | null;
    readonly step: string | null;
    readonly steps: readonly { readonly name: string; readonly status: string }[];
    readonly createdBy: string;
    readonly createdAt: string;
    readonly dispatchAt: string | null;
    readonly cancelRequested: boolean;
    readonly error: { readonly code: string; readonly message: string } | null;
}

export interface JobLogLinePort {
    readonly seq: number;
    readonly level: 'info' | 'warn' | 'error';
    readonly step: string | null;
    readonly message: string;
    readonly at: string;
}

export interface JobsViewState {
    readonly filter: JobFilterPort;
    readonly list: ListStatePort<JobItemPort>;
    readonly detail: { readonly id: string; readonly job: DocStatePort<JobItemPort>; readonly logs: ListStatePort<JobLogLinePort> } | null;
    readonly cancelling: boolean;
}

export interface JobsIntentsPort {
    setFilter(filter: JobFilterPort): void;
    more(): void;
    retry(): void;
    cancel(): Promise<unknown>;
}
