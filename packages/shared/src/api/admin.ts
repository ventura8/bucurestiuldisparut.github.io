/**
 * Who administers a map (`docs/research/M2-interfaces.md` §3.1; scenarios A01, A02, A20). Callables of a signed-in,
 * verified Google account that is not necessarily an admin yet: `admin.session`, `admin.claim` (the project owner
 * becomes the map's owner, proved with Google's IAM and the owner's own OAuth token, so no e-mail address is ever
 * configured or committed), `admin.join` (an invited account becomes an admin). Admin-only: `admins.invite`,
 * `admins.revoke`, `admins.list`.
 */
import { z } from 'zod';

import { sha256Schema, uidSchema } from '../schemas/firestore-common.js';
import { ADMIN_ROLES } from '../schemas/firestore-ops.js';
import { httpsUrlSchema, plainText } from '../schemas/primitives.js';
import { emptyRequestSchema, googleAccessTokenSchema, isoTimeSchema } from './common.js';

/** The OAuth scope the claim popup asks for (incremental consent, read-only): enough for `testIamPermissions`. */
export const CLAIM_OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform.read-only';

/**
 * The permission that proves ownership: only Owners (and IAM admins, who could make themselves owners) may set a
 * project's IAM policy. Checked with `projects.testIamPermissions` of Resource Manager v3 and the caller's token.
 */
export const OWNER_PERMISSION = 'resourcemanager.projects.setIamPolicy';

/** An invitation expires after this many days (`ops.tick` deletes it). */
export const INVITE_TTL_DAYS = 14;

/** The form an e-mail address is hashed in: trimmed, lower case. */
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/** `invites/{id}`: the lowercase hex SHA-256 of the normalized address (Web Crypto: browsers and Node alike). */
export async function inviteIdFor(email: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeEmail(email)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const roleSchema = z.enum(ADMIN_ROLES);

/** `admin.session`: what the admin app shows after Google sign-in (any verified Google account may ask). */
export const sessionRequestSchema = emptyRequestSchema;
export const sessionResponseSchema = z.strictObject({
    /** `admins/{uid}` exists. */
    admin: z.boolean(),
    role: roleSchema.nullable(),
    /** The caller's ID token carries `admin: true`. */
    claim: z.boolean(),
    /** Document and claim disagree: refresh the ID token (`getIdToken(true)`) and ask again (S-A01-BAD-CLAIM-DELAY). */
    refreshToken: z.boolean(),
    /** False only before the first `admin.claim`: the app then offers "I own this Google Cloud project". */
    ownerClaimed: z.boolean(),
    /** An invitation for the caller's address waits: the app offers "Join". */
    invitePending: z.boolean(),
});

/** `admin.claim`: the project owner's token, granted with `CLAIM_OAUTH_SCOPE` in the sign-in popup. */
export const claimRequestSchema = z.strictObject({ googleAccessToken: googleAccessTokenSchema });
export const claimResponseSchema = z.strictObject({ role: z.literal('owner'), refreshToken: z.literal(true) });

/** `admin.join`: accepts the invitation of the caller's verified address. */
export const joinRequestSchema = emptyRequestSchema;
export const joinResponseSchema = z.strictObject({ role: roleSchema, refreshToken: z.literal(true) });

/** `admins.invite`: any admin invites an address; the response names the link the inviter sends themselves. */
export const inviteRequestSchema = z.strictObject({ email: z.email().max(254) });
export const inviteResponseSchema = z.strictObject({
    inviteId: sha256Schema,
    expiresAt: isoTimeSchema,
    /** The admin's address (`https://<project>.web.app/`): the invitee signs in there with Google and joins. */
    signInUrl: httpsUrlSchema,
});

/** `admins.revoke`: an admin (never the owner, never oneself) or a pending invitation. */
export const revokeRequestSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('admin'), uid: uidSchema }),
    z.strictObject({ kind: z.literal('invite'), inviteId: sha256Schema }),
]);
export const revokeResponseSchema = z.strictObject({ revoked: z.literal(true) });

/** `admins.list`: the admins and the pending invitations (an invitation shows no address: only its hash is kept). */
export const adminsListRequestSchema = emptyRequestSchema;
export const adminsListResponseSchema = z.strictObject({
    admins: z
        .array(
            z.strictObject({
                uid: uidSchema,
                role: roleSchema,
                email: z.email().max(254).optional(),
                displayName: plainText(200).optional(),
                invitedBy: uidSchema.optional(),
                createdAt: isoTimeSchema,
                /** The caller (the app hides Remove on this row). */
                self: z.boolean(),
            }),
        )
        .max(100),
    invites: z
        .array(
            z.strictObject({
                inviteId: sha256Schema,
                role: z.literal('admin'),
                invitedBy: uidSchema,
                createdAt: isoTimeSchema,
                expiresAt: isoTimeSchema,
            }),
        )
        .max(100),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type ClaimRequest = z.infer<typeof claimRequestSchema>;
export type ClaimResponse = z.infer<typeof claimResponseSchema>;
export type JoinResponse = z.infer<typeof joinResponseSchema>;
export type InviteRequest = z.infer<typeof inviteRequestSchema>;
export type InviteResponse = z.infer<typeof inviteResponseSchema>;
export type RevokeRequest = z.infer<typeof revokeRequestSchema>;
export type AdminsListResponse = z.infer<typeof adminsListResponseSchema>;
