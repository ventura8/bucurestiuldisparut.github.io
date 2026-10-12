/** How the `setup.*` handlers map outside failures to error codes (M2-interfaces §4.1). */
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/api/api-error.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { TRANSIENT, failureRecord, mapFailure } from '../../src/setup/failures.js';

describe('mapFailure', () => {
    it('happyPath_anExpectedFailureBecomesItsCode', () => {
        expect(mapFailure(new UpstreamError('usgs', 'maintenance'), TRANSIENT)).toEqual(new ApiError('apiError.unavailable'));
    });

    it.each([
        ['an unexpected failure', new UpstreamError('usgs', 'conflict')],
        ['an error that is not an upstream failure', new Error('boom')],
    ])('badPath_%s_passesThrough', (_label, error) => {
        expect(mapFailure(error, TRANSIENT)).toBe(error);
    });
});

describe('failureRecord', () => {
    it.each([
        [
            new ApiError('apiError.mapbox.missingScopes', { scopes: 'tokens:read' }),
            { state: 'invalid', detail: 'apiError.mapbox.missingScopes', params: { scopes: 'tokens:read' } },
        ],
        [new ApiError('apiError.usgs.maintenance'), { state: 'unavailable', detail: 'apiError.usgs.maintenance' }],
        [new Error('boom'), { state: 'unavailable', detail: 'apiError.internal' }],
    ])('happyPath_recordsTheReason_%#', (error, record) => {
        expect(failureRecord(error)).toEqual(record);
    });
});
