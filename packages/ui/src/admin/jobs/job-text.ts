/**
 * The jobs' words (`docs/research/M2c-interfaces.md` §9.3): a job's type and status, a step's name and state, a log line's
 * level. A type the admin does not know yet (the raster pipeline's next ones, M3) reads as "Job"; an unknown step keeps
 * its stored name.
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
    awaiting_gcps: 'adminContent.jobs.status.awaitingGcps',
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

/** The raster pipeline's steps (docs/research/PLAN.md → *Raster pipeline*) by their names in the admin's language. */
const STEP_NAMES: Readonly<Record<string, AdminContentKey>> = {
    doctor: 'adminContent.jobs.stepName.doctor',
    fetch: 'adminContent.jobs.stepName.fetch',
    locate: 'adminContent.jobs.stepName.locate',
    crop: 'adminContent.jobs.stepName.crop',
    georef: 'adminContent.jobs.stepName.georef',
    warp: 'adminContent.jobs.stepName.warp',
    export: 'adminContent.jobs.stepName.export',
    publish: 'adminContent.jobs.stepName.publish',
    delete: 'adminContent.jobs.stepName.delete',
    // M3 (CR-M3-5): the pipeline's other steps and the publisher's (`JOB_STEPS` in @hcm/shared).
    extract: 'adminContent.jobs.stepName.extract',
    stitch: 'adminContent.jobs.stepName.stitch',
    inspect: 'adminContent.jobs.stepName.inspect',
    reference: 'adminContent.jobs.stepName.reference',
    register: 'adminContent.jobs.stepName.register',
    guard: 'adminContent.jobs.stepName.guard',
    upload: 'adminContent.jobs.stepName.upload',
    tiles: 'adminContent.jobs.stepName.tiles',
    finalize: 'adminContent.jobs.stepName.finalize',
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

/** A step by its name in the admin's language ("Downloading the scene" for `fetch`); a step the admin does not know as stored. */
export function stepNameText(locale: Locale, name: string): string {
    const key = STEP_NAMES[name];
    return key === undefined ? name : contentText(locale, key);
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
