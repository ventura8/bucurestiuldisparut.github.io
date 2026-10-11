import type { Firestore } from 'firebase-admin/firestore';

import type { AdminDirectory } from '../ports/admin-directory.js';
import type { SetupRecords } from '../ports/setup-records.js';

/** admins/{uid} through the Admin SDK (which bypasses the security rules: the guard is the check). */
export function firestoreAdminDirectory(db: Firestore): AdminDirectory {
    return {
        isAdmin: async (uid) => (await db.collection('admins').doc(uid).get()).exists,
    };
}

/** setup/status: written by the setup.* callables, read by setup.status. */
export function firestoreSetupRecords(db: Firestore): SetupRecords {
    return {
        readStatus: async () => (await db.collection('setup').doc('status').get()).data(),
    };
}
