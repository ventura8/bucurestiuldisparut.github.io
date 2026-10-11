import '../global-options.js';

import { onCall } from 'firebase-functions/https';

import { getDeps } from '../deps.js';
import { setupStatus } from '../handlers/setup-status.js';
import { requireAdmin } from './admin-guard.js';

/**
 * `setup-status` (callable): the Setup Assistant's health card. Admins only, non-secret fields only.
 * App Check stays off until the admin ships its reCAPTCHA Enterprise provider and the one-week
 * monitoring period ends (security review §1.6, M2).
 */
export const status = onCall({ maxInstances: 3, enforceAppCheck: false }, async (request) => {
    const deps = getDeps();
    return setupStatus(deps, await requireAdmin(deps.admins, request.auth));
});
