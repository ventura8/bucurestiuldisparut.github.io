import { describe, expect, it } from 'vitest';

import { GoogleApiError } from '../../src/google/failure.js';
import {
    ensureBindings,
    missingBindings,
    parsePolicy,
    POLICY_WRITE_ATTEMPTS,
    withBindings,
    type Policy,
    type PolicyAccess,
} from '../../src/google/iam-policy.js';

/** Read, merge, write with the etag, and merge again after a concurrent change (M2b §3.4: an IAM etag ABORTED, three times). */

const ADMIN = { role: 'roles/datastore.user', member: 'serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com' };
const EVENTS = { role: 'roles/datastore.user', member: 'serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com' };

function memoryPolicy(start: Policy, failures: readonly Error[] = []): PolicyAccess & { written: Policy[] } {
    let current = start;
    const pending = [...failures];
    const written: Policy[] = [];
    return {
        written,
        read: () => Promise.resolve(current),
        write: (policy) => {
            const failure = pending.shift();
            if (failure !== undefined) {
                return Promise.reject(failure);
            }
            written.push(policy);
            current = { ...policy, etag: `etag-${String(written.length)}` };
            return Promise.resolve(current);
        },
    };
}

const conflict = (): GoogleApiError =>
    new GoogleApiError('resource-manager.setIamPolicy', { kind: 'conflict', status: 409, reason: 'ABORTED' });

describe('parsePolicy', () => {
    it('happyPath_bindingsVersionEtagAndConditionsAreKept', () => {
        const policy = parsePolicy({ version: 3, etag: 'e', bindings: [{ role: 'r', members: ['m'], condition: { title: 't' } }] });

        expect(policy).toEqual({ version: 3, etag: 'e', bindings: [{ role: 'r', members: ['m'], condition: { title: 't' } }] });
    });

    it('badPath_anUnreadableAnswerIsAnEmptyPolicy', () => {
        expect(parsePolicy(undefined)).toEqual({ version: 1, bindings: [] });
    });
});

describe('withBindings', () => {
    it('happyPath_aMemberJoinsTheRolesUnconditionalBindingNeverAConditionalOne', () => {
        const policy: Policy = {
            version: 3,
            etag: 'e',
            bindings: [
                { role: ADMIN.role, members: ['user:x@example.test'], condition: { title: 'until' } },
                { role: ADMIN.role, members: ['user:y@example.test'] },
            ],
        };

        const merged = withBindings(policy, [ADMIN, EVENTS]);

        expect(merged.bindings).toEqual([
            { role: ADMIN.role, members: ['user:x@example.test'], condition: { title: 'until' } },
            { role: ADMIN.role, members: ['user:y@example.test', ADMIN.member, EVENTS.member] },
        ]);
        expect(merged.etag).toBe('e');
        expect(missingBindings(merged, [ADMIN, EVENTS])).toEqual([]);
    });
});

describe('ensureBindings', () => {
    it('happyPath_nothingIsWrittenWhenEveryBindingIsThere', async () => {
        const access = memoryPolicy({ version: 1, bindings: [{ role: ADMIN.role, members: [ADMIN.member] }] });

        await expect(ensureBindings(access, [ADMIN])).resolves.toBe(0);
        expect(access.written).toEqual([]);
    });

    it('happyPath_aConcurrentChangeIsMergedAgain', async () => {
        const access = memoryPolicy({ version: 1, etag: 'a', bindings: [] }, [conflict()]);

        await expect(ensureBindings(access, [ADMIN])).resolves.toBe(1);
        expect(access.written).toHaveLength(1);
    });

    it('badPath_threeConflictsInARowOrAnotherFailureAreThrown', async () => {
        const conflicts = Array.from({ length: POLICY_WRITE_ATTEMPTS }, conflict);
        const refused = new GoogleApiError('resource-manager.setIamPolicy', { kind: 'forbidden', status: 403 });

        await expect(ensureBindings(memoryPolicy({ version: 1, bindings: [] }, conflicts), [ADMIN])).rejects.toMatchObject({
            kind: 'conflict',
        });
        await expect(ensureBindings(memoryPolicy({ version: 1, bindings: [] }, [refused]), [ADMIN])).rejects.toBe(refused);
    });
});
