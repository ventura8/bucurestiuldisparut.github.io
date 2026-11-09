/**
 * `jobRetryable` (`packages/shared/src/api/imagery.ts`), which the Jobs page and the version page read: a dismissal leaves its
 * job failed, marked `cancelRequested`, and neither page offers a Retry `imagery.retry` would refuse; a runner older than the
 * job's type spent no attempt, so its failure offers Retry past the attempts (`failedOutdated`).
 */
import { describe, expect, it } from 'vitest';

import { JOB_MAX_ATTEMPTS, PIPELINE_OUTDATED, failedOutdated, jobRetryable } from '../../src/api/imagery.js';

const FAILED = { status: 'failed', type: 'usgs-import', layerId: 'corona-1966' } as const;

describe('jobRetryable: a dismissed job', () => {
    it('happyPath_aFailedJobNobodyDismissedOffersRetry', () => {
        expect(jobRetryable(FAILED)).toBe(true);
        expect(jobRetryable({ ...FAILED, cancelRequested: false })).toBe(true);
    });

    it('badPath_aDismissedJobOffersNoRetry', () => {
        expect(jobRetryable({ ...FAILED, cancelRequested: true })).toBe(false);
    });
});

describe('jobRetryable: a runner older than the job', () => {
    const EXHAUSTED = { ...FAILED, type: 'archive-series', attempt: JOB_MAX_ATTEMPTS } as const;
    const LEGACY = { code: 'apiError.invalidRequest', message: 'the pipeline does not run archive-series jobs' };

    it('happyPath_anOutdatedRunnersFailureOffersRetryPastTheAttempts', () => {
        expect(jobRetryable({ ...EXHAUSTED, error: { code: PIPELINE_OUTDATED, message: 'x' } })).toBe(true);
        expect(jobRetryable({ ...EXHAUSTED, error: LEGACY })).toBe(true);
        expect(failedOutdated({ error: LEGACY })).toBe(true);
    });

    it('badPath_anyOtherExhaustedFailureOffersNoRetry', () => {
        expect(jobRetryable({ ...EXHAUSTED, error: { code: 'apiError.invalidRequest', message: 'basedOn must be an id' } })).toBe(false);
        expect(jobRetryable({ ...EXHAUSTED, error: { code: 'apiError.internal', message: 'the pipeline does not run x jobs' } })).toBe(
            false,
        );
        expect(jobRetryable(EXHAUSTED)).toBe(false);
        expect(failedOutdated({})).toBe(false);
    });
});
