import { CITY_ACCESSES, type CallableAccess, type CityRole } from '@hcm/shared';

import type { AdminDirectory, AdminMembership } from '../ports/admin-directory.js';
import { ApiError } from './api-error.js';

/** The claims of a verified Firebase ID token the access check reads (a subset of `DecodedIdToken`). */
export interface CallerToken {
    readonly email?: string;
    readonly email_verified?: boolean;
    readonly admin?: unknown;
    readonly firebase: { readonly sign_in_provider: string };
}

/** `request.auth` of a callable: undefined when the caller is not signed in. */
export interface Caller {
    readonly uid: string;
    readonly token: CallerToken;
}

/** Who a handler acts for, once the access rule admitted them. */
export interface VerifiedCaller {
    readonly uid: string;
    /** The verified Google address of the ID token (`admin.claim` compares it, `admin.join` hashes it); never logged. */
    readonly email: string | undefined;
    /** The ID token carries `admin: true` (for `signedIn` callables, which also serve non-admins). */
    readonly claim: boolean;
    /** M5: the caller's project and city roles, read once by the access check of a city or project callable. */
    readonly membership?: AdminMembership;
}

/** firestore.rules `authed()`: a verified Google account (admins only ever sign in with Google). */
function isVerifiedGoogle(token: CallerToken): boolean {
    return token.email_verified === true && token.firebase.sign_in_provider === 'google.com';
}

/** The claim AND the document; the document is read only when the token already qualifies. */
async function isAdmin(caller: Caller, admins: AdminDirectory): Promise<boolean> {
    return caller.token.admin === true && (await admins.isAdmin(caller.uid));
}

/** The membership behind an M5 access (`cityEditor`, `cityOwner`, `projectOwner`): the claim and the document. */
async function requireMembership(access: CallableAccess, caller: Caller, admins: AdminDirectory): Promise<AdminMembership> {
    const membership = caller.token.admin === true ? await admins.membership(caller.uid) : null;
    if (membership === null) {
        throw new ApiError('apiError.notAdmin');
    }
    if (access === 'projectOwner' && membership.projectRole !== 'owner') {
        throw new ApiError('apiError.city.notProjectOwner');
    }
    return membership;
}

/**
 * The access rule of a callable (`CALLABLES[name].access`), the same as the security rules: `signedIn` admits a
 * verified Google account, `admin` also needs the `admin` claim AND an `admins/{uid}` document, so deleting the
 * document revokes access at once although the claim stays in an ID token for up to an hour (S-A20-BAD-ADMIN-REMOVED).
 * M5's accesses read the document once (its membership) and `projectOwner` needs its `owner` role; the city of
 * `cityEditor` and `cityOwner` is checked by {@link requireCityRole} once the request is valid.
 */
export async function requireAccess(access: CallableAccess, caller: Caller | undefined, admins: AdminDirectory): Promise<VerifiedCaller> {
    if (caller === undefined) {
        throw new ApiError('apiError.unauthenticated');
    }
    if (!isVerifiedGoogle(caller.token)) {
        throw new ApiError('apiError.accountNotAllowed');
    }
    const verified = { uid: caller.uid, email: caller.token.email, claim: caller.token.admin === true };
    if (access === 'signedIn') {
        return verified;
    }
    if (access === 'admin') {
        return requireAdmin(caller, admins, verified);
    }
    return { ...verified, membership: await requireMembership(access, caller, admins) };
}

async function requireAdmin(caller: Caller, admins: AdminDirectory, verified: VerifiedCaller): Promise<VerifiedCaller> {
    if (!(await isAdmin(caller, admins))) {
        throw new ApiError('apiError.notAdmin');
    }
    return verified;
}

/** The `cityId` a valid request of a city callable names (the registry's test proves every one has it). */
function cityIdOf(request: unknown): string {
    const cityId = (request as { readonly cityId?: unknown }).cityId;
    if (typeof cityId !== 'string') {
        throw new ApiError('apiError.internal');
    }
    return cityId;
}

/**
 * M5 (`docs/research/M5-interfaces.md` §1.3; S-A51-BAD-OTHER-CITY-CALLABLE): after the request is validated and before
 * the handler reads or writes anything, `cityEditor` needs a role in the request's city (`apiError.city.notMember`) and
 * `cityOwner` its owner role (`apiError.city.notOwner`). Other accesses pass.
 */
export function requireCityRole(access: CallableAccess, caller: VerifiedCaller, request: unknown): void {
    if (CITY_ACCESSES.includes(access)) {
        const cityId = cityIdOf(request);
        requireRoleIn(cityId, roleOf(caller, cityId), access === 'cityOwner');
    }
}

function roleOf(caller: VerifiedCaller, cityId: string): CityRole | null {
    return caller.membership?.roleIn(cityId) ?? null;
}

function requireRoleIn(cityId: string, role: CityRole | null, owner: boolean): void {
    if (role === null) {
        throw new ApiError('apiError.city.notMember', { cityId });
    }
    if (owner && role !== 'owner') {
        throw new ApiError('apiError.city.notOwner', { cityId });
    }
}
