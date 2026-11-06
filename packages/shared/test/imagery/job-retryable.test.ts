/**
 * `jobRetryable` (`packages/shared/src/api/imagery.ts`), which the Jobs page and the version page read: a dismissal leaves its
 * job failed, marked `cancelRequested`, and neither page offers a Retry `imagery.retry` would refuse.
 */
import { describe, expect, it } from 'vitest';

import { jobRetryable } from '../../src/api/imagery.js';

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
