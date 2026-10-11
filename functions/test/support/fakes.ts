/** In-memory ports for handler tests: they record what the handler asked for. */
import { createLogger, type Logger } from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';

import type { Caller, CallerToken } from '../../src/triggers/admin-guard.js';
import type { AdminDirectory } from '../../src/ports/admin-directory.js';
import type { Clock } from '../../src/ports/clock.js';
import type { SetupRecord, SetupRecords } from '../../src/ports/setup-records.js';

export const NOW = '2026-10-11T08:30:00.000Z';

interface FakeAdmins extends AdminDirectory {
    readonly lookups: string[];
}

/** admins/{uid} documents exist for `uids` only. */
export function fakeAdmins(uids: readonly string[]): FakeAdmins {
    const lookups: string[] = [];
    return {
        lookups,
        isAdmin: (uid) => {
            lookups.push(uid);
            return Promise.resolve(uids.includes(uid));
        },
    };
}

export function fakeSetup(record: SetupRecord | undefined): SetupRecords {
    return { readStatus: () => Promise.resolve(record) };
}

export function fixedClock(iso = NOW): Clock {
    return { now: () => new Date(iso) };
}

export function recordingLogger(): { readonly log: Logger; readonly recording: RecordingSink } {
    const recording = createRecordingSink();
    return { log: createLogger('functions', { sink: recording.sink, minLevel: 'debug' }), recording };
}

/** A verified Google admin's token; override one claim to build each bad case. */
export function adminToken(overrides: Partial<CallerToken> = {}): CallerToken {
    return { email_verified: true, admin: true, firebase: { sign_in_provider: 'google.com' }, ...overrides };
}

export function caller(uid: string, token: CallerToken = adminToken()): Caller {
    return { uid, token };
}
