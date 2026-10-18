/**
 * The jobs' words (`docs/research/M2c-interfaces.md` §9.3): a job's type and status, a step's state, a log line's level.
 * A type the admin does not know yet (the raster pipeline's next ones, M3) reads as "Job".
 */
import type { AdminContentKey, Locale } from '@hcm/shared';

import { contentText } from '../shell/text.js';
import type { JobFilterPort, JobItemPort, JobLogLinePort, JobStatusPort } from './jobs-port.js';

const TYPES: Readonly<Record<string, AdminContentKey>> = {
    'usgs-import': 'adminContent.jobs.type.usgsImport',
    'geotiff-import': 'adminContent.jobs.type.geotiffImport',
    regeoref: 'adminContent.jobs.type.regeoref',
    republish: 'adminContent.jobs.type.republish',
    'layer-delete': 'adminContent.jobs.type.layerDelete',
};

const STATUSES: Readonly<Record<JobStatusPort, AdminContentKey>> = {
    queued: 'adminContent.jobs.status.queued',
    starting: 'adminContent.jobs.status.starting',
    running: 'adminContent.jobs.status.running',
    waiting_usgs: 'adminContent.jobs.status.waitingUsgs',
    mts_processing: 'adminContent.jobs.status.mtsProcessing',
    awaiting_approval: 'adminContent.jobs.status.awaitingApproval',
    succeeded: 'adminContent.jobs.status.succeeded',
    failed: 'adminContent.jobs.status.failed',
    cancelled: 'adminContent.jobs.status.cancelled',
};

const STEP_STATES: Readonly<Record<string, AdminContentKey>> = {
    pending: 'adminContent.jobs.step.pending',
    running: 'adminContent.jobs.step.running',
    done: 'adminContent.jobs.step.done',
    failed: 'adminContent.jobs.step.failed',
    skipped: 'adminContent.jobs.step.skipped',
};

const LEVELS: Readonly<Record<JobLogLinePort['level'], AdminContentKey>> = {
    info: 'adminContent.jobs.level.info',
    warn: 'adminContent.jobs.level.warn',
    error: 'adminContent.jobs.level.error',
};

export const FILTERS: Readonly<Record<JobFilterPort, AdminContentKey>> = {
    all: 'adminContent.jobs.filter.all',
    active: 'adminContent.jobs.filter.active',
    failed: 'adminContent.jobs.filter.failed',
    done: 'adminContent.jobs.filter.done',
};

export function jobTypeText(locale: Locale, type: string): string {
    return contentText(locale, TYPES[type] ?? 'adminContent.jobs.type.other');
}

export function jobStatusText(locale: Locale, status: JobStatusPort): string {
    return contentText(locale, STATUSES[status]);
}

export function stepStateText(locale: Locale, state: string): string {
    return contentText(locale, STEP_STATES[state] ?? 'adminContent.jobs.step.pending');
}

export function levelText(locale: Locale, level: JobLogLinePort['level']): string {
    return contentText(locale, LEVELS[level]);
}

/** The status chip's tone: failed in the error colour, finished well in secondary, the rest waiting. */
export function statusTone(job: Pick<JobItemPort, 'status' | 'finished'>): 'error' | 'good' | 'wait' {
    if (job.status === 'failed') {
        return 'error';
    }
    return job.finished ? 'good' : 'wait';
}

/** A job's progress as a whole percentage, or null. */
export function percentOf(job: Pick<JobItemPort, 'progress'>): number | null {
    return job.progress === null ? null : Math.round(job.progress * 100);
}
