/**
 * The `admin.*` and `admins.*` callables (fn-admin, `docs/research/M2-interfaces.md` §3.1). Each family is built from
 * the composition root's `getDeps`, so the deployed names follow the registry: the integrator's
 * `functions/src/index.ts` exports `admin = adminFunctions(getDeps)` (`admin-session`, `admin-claim`, `admin-join`)
 * and `admins = adminsFunctions(getDeps)` (`admins-invite`, `admins-revoke`, `admins-list`, `admins-setRole`); Firebase deploys an
 * exported object's functions as `<export>-<key>`.
 */
import type { CallableDeps } from '../api/callable.js';
import { claimFunction, type ClaimDeps } from './claim.js';
import { inviteFunction, type InviteDeps } from './invite.js';
import { joinFunction, type JoinDeps } from './join.js';
import { listFunction, type ListDeps } from './list.js';
import { revokeFunction, type RevokeDeps } from './revoke.js';
import { sessionFunction, type SessionDeps } from './session.js';
import { setRoleFunction, type SetRoleDeps } from './set-role.js';

export type AdminFamilyDeps = CallableDeps & SessionDeps & ClaimDeps & JoinDeps;
export type AdminsFamilyDeps = CallableDeps & InviteDeps & RevokeDeps & ListDeps & SetRoleDeps;

/** `admin.session`, `admin.claim`, `admin.join`: any verified Google account may call them. */
export function adminFunctions(getDeps: () => AdminFamilyDeps) {
    return { session: sessionFunction(getDeps), claim: claimFunction(getDeps), join: joinFunction(getDeps) };
}

/** `admins.invite`, `admins.revoke`, `admins.list` and (M5) `admins.setRole`: a city's admins, per city. */
export function adminsFunctions(getDeps: () => AdminsFamilyDeps) {
    return {
        invite: inviteFunction(getDeps),
        revoke: revokeFunction(getDeps),
        list: listFunction(getDeps),
        setRole: setRoleFunction(getDeps),
    };
}
