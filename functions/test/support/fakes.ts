/** In-memory ports for handler tests: they record what the handler asked for. */
import { createLogger, type Logger } from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';

import type { AdminDirectory } from '../../src/ports/admin-directory.js';

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

export function recordingLogger(): { readonly log: Logger; readonly recording: RecordingSink } {
    const recording = createRecordingSink();
    return { log: createLogger('functions', { sink: recording.sink, minLevel: 'debug' }), recording };
}
