import '../global-options.js';

import {
    CLAIM_OAUTH_SCOPE,
    FIRESTORE_PATHS,
    OWNER_PERMISSION,
    adminDocSchema,
    normalizeEmail,
    ownerDocSchema,
    timestampFromDate,
    type AdminDoc,
    type CallableRequest,
    type CallableResponse,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { GoogleIam } from '../ports/google-iam.js';
import type { Ports } from '../ports/index.js';
import { adminRecord, callerStamp, displayNameOf, type NewAdmin } from './records.js';

export type ClaimDeps = Pick<Ports, 'documents' | 'auth' | 'iam' | 'config' | 'clock' | 'log'>;

/** `cloud-platform` covers `cloud-platform.read-only` (an admin who already granted provisioning needs no second popup). */
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

type TokenInfo = Awaited<ReturnType<GoogleIam['tokenInfo']>>;

/** The account claiming the map, as its `admins/{uid}` document records it. */
type OwnerAccount = Omit<NewAdmin, 'role' | 'createdAt'>;

/** Google refusing the caller's own access token (expired, revoked, malformed) is `claim.tokenInvalid`. */
function rethrowTokenInvalid(error: unknown): never {
    if (error instanceof UpstreamError && (error.failure === 'unauthorized' || error.failure === 'invalid')) {
        throw new ApiError('apiError.claim.tokenInvalid');
    }
    throw error;
}

/** Google says the token was granted by this address, verified (case aside). */
function isGrantedBy(email: string, info: TokenInfo): boolean {
    return info.emailVerified && normalizeEmail(info.email) === normalizeEmail(email);
}

function hasClaimScope(info: TokenInfo): boolean {
    return info.scopes.includes(CLAIM_OAUTH_SCOPE) || info.scopes.includes(CLOUD_PLATFORM_SCOPE);
}

/**
 * The caller's verified address, once the token is shown to belong to the signed-in account and to this project's
 * OAuth client, with a scope that suffices.
 */
function tokenOwner(deps: ClaimDeps, caller: VerifiedCaller, info: TokenInfo): string {
    const email = caller.email;
    if (email === undefined || !isGrantedBy(email, info) || !deps.config.oauthClientIds.includes(info.audience)) {
        throw new ApiError('apiError.claim.tokenMismatch');
    }
    if (!hasClaimScope(info)) {
        throw new ApiError('apiError.claim.scopeMissing');
    }
    return email;
}

/** Resource Manager, asked with the caller's token: only an owner (or an IAM admin) may set the project's IAM policy. */
async function checkOwner(deps: ClaimDeps, accessToken: string): Promise<void> {
    const projectId = deps.config.projectId;
    const granted = await deps.iam.testProjectPermissions(projectId, accessToken, [OWNER_PERMISSION]).catch(rethrowTokenInvalid);
    if (!granted.includes(OWNER_PERMISSION)) {
        throw new ApiError('apiError.claim.notOwner', { projectId });
    }
}

/** The owner's `admins/{uid}`, unless it already says `owner` (a repeat claim changes nothing). */
async function ensureOwnerAdmin(transaction: DocumentTransaction, existing: AdminDoc | undefined, owner: OwnerAccount): Promise<void> {
    if (existing?.role === 'owner') {
        return;
    }
    const record = adminRecord({ ...owner, role: 'owner', createdAt: existing?.createdAt });
    await transaction.set(FIRESTORE_PATHS.admin(owner.uid), adminDocSchema, record);
}

/**
 * Creates `setup/owner` once and the owner's `admins/{uid}`. Another uid's claim → `claim.alreadyClaimed`; the owner's
 * own repeat changes nothing (idempotent), whatever the order of concurrent claims.
 */
async function recordOwner(deps: ClaimDeps, owner: OwnerAccount): Promise<void> {
    const { uid } = owner;
    await deps.documents.transaction(async (transaction) => {
        const claimed = await transaction.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema);
        if (claimed !== undefined && claimed.uid !== uid) {
            throw new ApiError('apiError.claim.alreadyClaimed');
        }
        const existing = await transaction.get(FIRESTORE_PATHS.admin(uid), adminDocSchema);
        if (claimed === undefined) {
            const record = { uid, claimedAt: timestampFromDate(owner.now), ...callerStamp(uid, owner.now) };
            await transaction.create(FIRESTORE_PATHS.setupOwner, ownerDocSchema, record);
        }
        await ensureOwnerAdmin(transaction, existing, owner);
    });
}

/**
 * `admin.claim` (any verified Google account, App Check consumed; S-A01-HAPPY, S-A01-BAD-NOT-OWNER,
 * S-A01-BAD-FOREIGN-TOKEN, S-A01-BAD-ALREADY-CLAIMED): the Google Cloud project's owner becomes the map's owner
 * without any address being configured anywhere. Google's `tokeninfo` proves the access token was granted by the
 * signed-in account to this project's web client with a sufficient scope, then Resource Manager's
 * `testIamPermissions`, called with that same token, proves ownership; the owner record and the `admin` claim follow.
 * The token is used for these two calls only: never stored, never logged.
 */
async function adminClaim(
    deps: ClaimDeps,
    caller: VerifiedCaller,
    data: CallableRequest<'admin.claim'>,
): Promise<CallableResponse<'admin.claim'>> {
    const info = await deps.iam.tokenInfo(data.googleAccessToken).catch(rethrowTokenInvalid);
    const email = tokenOwner(deps, caller, info);
    await checkOwner(deps, data.googleAccessToken);
    const displayName = await displayNameOf(deps.auth, caller.uid);
    await recordOwner(deps, { uid: caller.uid, email, displayName, now: deps.clock.now() });
    await deps.auth.setAdminClaim(caller.uid, true);
    deps.log.info('map owner claimed', { uid: caller.uid, projectId: deps.config.projectId });
    return { role: 'owner', refreshToken: true };
}

/** The `admin-claim` callable. */
export function claimFunction(getDeps: () => ClaimDeps & CallableDeps) {
    return defineCallable('admin.claim', adminClaim, getDeps);
}
