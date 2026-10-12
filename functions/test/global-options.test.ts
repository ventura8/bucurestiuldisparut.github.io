import { CALLABLES, type CallableName } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { GLOBAL_OPTIONS, RUNTIME_ACCOUNTS, runAs } from '../src/global-options.js';

describe('GLOBAL_OPTIONS', () => {
    it('happyPath_everythingRunsInUsCentral1WithAnInstanceCapAndTheLeastPrivilegedAccount', () => {
        expect(GLOBAL_OPTIONS).toEqual({ region: 'us-central1', maxInstances: 5, concurrency: 80, serviceAccount: 'fn-events@' });
    });
});

describe('runAs', () => {
    it('happyPath_callablesRunAsFnAdminInTheDeployingProject', () => {
        expect(runAs('admin.claim')).toEqual({ serviceAccount: 'fn-admin@' });
        expect((Object.keys(CALLABLES) as CallableName[]).filter((name) => RUNTIME_ACCOUNTS[name] !== 'fn-admin')).toEqual([]);
    });

    it('happyPath_triggersAndThePublicEndpointRunAsFnEvents', () => {
        expect(runAs('photos.onUpload')).toEqual({ serviceAccount: 'fn-events@' });
        expect(runAs('telemetry.reportError')).toEqual({ serviceAccount: 'fn-events@' });
        expect(runAs('history.onCityWrite')).toEqual({ serviceAccount: 'fn-events@' });
    });

    it('badPath_theSchedulerNeverRunsAsTheTriggerAccount', () => {
        // ops.tick retires Mapbox tokens and deletes stale accounts: fn-admin@ only (DECISIONS-for-review.md §19b).
        expect(runAs('ops.tick')).toEqual({ serviceAccount: 'fn-admin@' });
        expect(runAs('ops.onBudget')).toEqual({ serviceAccount: 'fn-admin@' });
    });
});
