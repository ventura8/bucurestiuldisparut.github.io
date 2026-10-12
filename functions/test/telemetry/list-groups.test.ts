/**
 * `telemetry.listGroups` (`functions/src/telemetry/list-groups.ts`, M2-interfaces §3.4) through its callable's
 * `.run()`, Error Reporting scripted (`fakeErrors`), the admin check answered by a scripted directory.
 */
import { createLogger, type ListGroupsResponse } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { describe, expect, it } from 'vitest';

import type { ErrorReporter } from '../../src/ports/error-reporter.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { ERROR_REPORTING_VIEWER_ROLE, listGroupsFunction } from '../../src/telemetry/list-groups.js';
import { callableRequest, failureOf, fakeErrors, googleToken } from '../admin/world.js';

const PAGE: ListGroupsResponse = {
    groups: [
        {
            groupId: 'e2e-group-1',
            message: 'TypeError: tile https://api.mapbox.com/x.png?access_token=e2e-value failed for ana@example.test',
            service: 'viewer',
            version: '1.0.0',
            count: 3,
            firstSeen: '2026-10-11T08:00:00.000Z',
            lastSeen: '2026-10-12T08:00:00.000Z',
            resolution: 'OPEN',
        },
    ],
    nextPageToken: 'e2e-next-page',
};

function listGroups(errors: ErrorReporter) {
    const recording = createRecordingSink();
    const deps = { errors, log: createLogger('functions', { sink: recording.sink }), admins: { isAdmin: () => Promise.resolve(true) } };
    const auth = { uid: 'u-admin', token: googleToken('admin@example.test', { admin: true }) };
    const call = listGroupsFunction(() => deps).run(callableRequest({ hours: 24, pageSize: 20 }, auth));
    return { call, recording };
}

describe('telemetry.listGroups', () => {
    it('happyPath_theCrashPanelGetsTheGroupsRedacted', async () => {
        const errors = fakeErrors(PAGE);
        const { call } = listGroups(errors);

        const page = await call;

        expect(errors.requests).toEqual([{ hours: 24, pageSize: 20 }]);
        expect(page.nextPageToken).toBe('e2e-next-page');
        expect(page.groups[0]?.message).toBe('TypeError: tile https://api.mapbox.com/x.png failed for [redacted]');
    });

    it('badPath_aMissingRoleNamesTheRole', async () => {
        const { call, recording } = listGroups(fakeErrors(new UpstreamError('error-reporting', 'forbidden', { status: 403 })));

        await expect(failureOf(call)).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.cloud.permission', params: { role: ERROR_REPORTING_VIEWER_ROLE } },
        });
        expect(recording.records[0]?.data).toEqual({ failure: 'forbidden', status: 403 });
    });

    it('badPath_aDisabledApiIsNamed', async () => {
        const disabled = new UpstreamError('error-reporting', 'forbidden', { status: 403, api: 'clouderrorreporting.googleapis.com' });
        const { call } = listGroups(fakeErrors(disabled));

        await expect(failureOf(call)).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.cloud.apiDisabled', params: { api: 'clouderrorreporting.googleapis.com' } },
        });
    });

    it.each(['unavailable', 'rateLimited', 'invalid'] as const)('badPath_anErrorReporting_%s_offersRetry', async (failure) => {
        const { call } = listGroups(fakeErrors(new UpstreamError('error-reporting', failure)));

        await expect(failureOf(call)).resolves.toMatchObject({ details: { code: 'apiError.errorReporting.unavailable' } });
    });

    it('badPath_aBugIsAnInternalError', async () => {
        const { call } = listGroups({ ...fakeErrors(), listGroups: () => Promise.reject(new TypeError('adapter bug')) });

        await expect(failureOf(call)).resolves.toMatchObject({ code: 'internal', details: { code: 'apiError.internal' } });
    });
});
