import type { APIRequestContext, APIResponse } from '@playwright/test';
import { inviteIdFor } from '@hcm/shared';

import { ADMIN_ORIGIN, ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin, PERSONAS, type PersonaName } from '../world.js';
import { decodeFields, encodeFields, type FirestoreFields } from './firestore-rest.js';

/**
 * The Firebase emulators of the admin tier, driven over their REST APIs from the test (never from the page): emptied
 * before every test (docs/research/M2b-interfaces.md §6.2), Google accounts signed in to the Auth emulator the way
 * Firebase Auth signs a Google credential in (`signInWithIdp` with the unsigned ID token the emulator accepts), and
 * Firestore documents seeded or read with the emulator's owner credential, which bypasses the security rules.
 */

/** The Auth and Firestore emulators' administrator credential (`Authorization: Bearer owner`). */
const EMULATOR_ADMIN = { authorization: 'Bearer owner' } as const;

const AUTH = `${emulatorOrigin('auth')}/identitytoolkit.googleapis.com/v1`;
const FIRESTORE_DOCUMENTS = `${emulatorOrigin('firestore')}/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents`;

/** A Google account signed in to the Auth emulator: what Firebase Auth keeps for its current user. */
export interface SignedInAccount {
    readonly persona: PersonaName;
    readonly uid: string;
    readonly email: string;
    /** The Firebase ID token (an unsigned JWT in the emulator) and its refresh token. */
    readonly idToken: string;
    readonly refreshToken: string;
    /** Seconds. */
    readonly expiresIn: number;
}

interface SignInWithIdpResponse {
    readonly localId: string;
    readonly email: string;
    readonly idToken: string;
    readonly refreshToken: string;
    readonly expiresIn: string;
}

async function ok(response: APIResponse, what: string): Promise<APIResponse> {
    if (!response.ok()) {
        throw new Error(`${what}: ${String(response.status())} ${await response.text()}`);
    }
    return response;
}

export class EmulatorWorld {
    readonly #api: APIRequestContext;

    constructor(api: APIRequestContext) {
        this.#api = api;
    }

    /** Empties Firestore, Auth and Storage (the rules stay loaded). */
    async reset(): Promise<void> {
        await ok(await this.#api.delete(FIRESTORE_DOCUMENTS.replace('/v1/', '/emulator/v1/'), { timeout: 30_000 }), 'Firestore reset');
        await ok(await this.#api.delete(`${emulatorOrigin('auth')}/emulator/v1/projects/${E2E_PROJECT_ID}/accounts`), 'Auth reset');
        await ok(await this.#api.post(`${emulatorOrigin('storage')}/internal/reset`), 'Storage reset');
    }

    /** Signs `persona` in with Google (creating the account on first use) and returns its fresh tokens. */
    async signIn(persona: PersonaName): Promise<SignedInAccount> {
        const { email, sub, displayName } = PERSONAS[persona];
        const idToken = JSON.stringify({ sub, email, email_verified: true, name: displayName });
        const response = await this.#api.post(`${AUTH}/accounts:signInWithIdp?key=${ADMIN_WEB_CONFIG.apiKey}`, {
            data: {
                postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`,
                requestUri: ADMIN_ORIGIN,
                returnIdpCredential: true,
                returnSecureToken: true,
            },
        });
        const body = (await (await ok(response, `sign-in of ${persona}`)).json()) as SignInWithIdpResponse;
        return {
            persona,
            uid: body.localId,
            email: body.email,
            idToken: body.idToken,
            refreshToken: body.refreshToken,
            expiresIn: Number(body.expiresIn),
        };
    }

    /** Sets an account's custom claims (`{admin: true}`), as `admin.claim` and `admin.join` do. */
    async setClaims(uid: string, claims: Readonly<Record<string, unknown>>): Promise<void> {
        const response = await this.#api.post(`${AUTH}/projects/${E2E_PROJECT_ID}/accounts:update`, {
            headers: EMULATOR_ADMIN,
            data: { localId: uid, customAttributes: JSON.stringify(claims) },
        });
        await ok(response, `claims of ${uid}`);
    }

    /** Writes a whole document (`setup/owner`, `admins/<uid>`), bypassing the rules. */
    async setDocument(path: string, data: Readonly<Record<string, unknown>>): Promise<void> {
        const response = await this.#api.patch(`${FIRESTORE_DOCUMENTS}/${path}`, {
            headers: EMULATOR_ADMIN,
            data: { fields: encodeFields(data) },
        });
        await ok(response, `write of ${path}`);
    }

    /** Changes some fields of a document (dotted paths of `data`'s top-level keys stay as given), bypassing the rules. */
    async updateFields(path: string, data: Readonly<Record<string, unknown>>, fieldPaths: readonly string[]): Promise<void> {
        const mask = fieldPaths.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&');
        const response = await this.#api.patch(`${FIRESTORE_DOCUMENTS}/${path}?${mask}`, {
            headers: EMULATOR_ADMIN,
            data: { fields: encodeFields(data) },
        });
        await ok(response, `update of ${path}`);
    }

    /**
     * Runs the scheduled `ops.tick` once, as Cloud Scheduler would: the Functions emulator cannot trigger a v2 scheduled
     * function from its Pub/Sub topic (its signature is `http`), so the event goes to the function's trigger route, whose
     * key carries the emulator's trigger generation (0 until the functions are reloaded). The server's clock cannot be
     * moved from a test.
     */
    async runOpsTick(): Promise<void> {
        const trigger = `${emulatorOrigin('functions')}/functions/projects/${E2E_PROJECT_ID}/triggers/us-central1-ops-tick-0`;
        const response = await this.#api.post(trigger, {
            headers: { 'content-type': 'application/cloudevents+json; charset=UTF-8' },
            data: { specversion: '1.0', id: 'e2e-ops-tick', source: 'e2e', type: 'google.cloud.scheduler.job.v1.executed', data: {} },
            timeout: 60_000,
        });
        await ok(response, 'ops.tick (restart the emulators if the functions were reloaded)');
    }

    /** A document's data, or undefined when it does not exist. */
    async document(path: string): Promise<Record<string, unknown> | undefined> {
        const response = await this.#api.get(`${FIRESTORE_DOCUMENTS}/${path}`, { headers: EMULATOR_ADMIN });
        if (response.status() === 404) {
            return undefined;
        }
        const body = (await (await ok(response, `read of ${path}`)).json()) as { readonly fields?: FirestoreFields };
        return decodeFields(body.fields ?? {});
    }

    /** Every document of a collection (`cities/bucharest/photos`), by id, read past the rules. */
    async collection(path: string): Promise<Record<string, Record<string, unknown>>> {
        const response = await this.#api.get(`${FIRESTORE_DOCUMENTS}/${path}?pageSize=1000`, { headers: EMULATOR_ADMIN });
        const body = (await (await ok(response, `list of ${path}`)).json()) as {
            readonly documents?: readonly { readonly name: string; readonly fields?: FirestoreFields }[];
        };
        return Object.fromEntries(
            (body.documents ?? []).map((document) => [
                document.name.slice(document.name.lastIndexOf('/') + 1),
                decodeFields(document.fields ?? {}),
            ]),
        );
    }

    /**
     * The map claimed by `account`, as `admin.claim` leaves it: `setup/owner`, the owner's `admins/<uid>` and the
     * `admin` claim (`functions/src/admin/claim.ts`).
     */
    async claimFor(account: SignedInAccount, at: Date): Promise<void> {
        const stamp = { updatedBy: account.uid, updatedAt: at };
        await this.setDocument('setup/owner', { uid: account.uid, claimedAt: at, ...stamp });
        await this.setDocument(`admins/${account.uid}`, { role: 'owner', email: account.email, createdAt: at, ...stamp });
        await this.setClaims(account.uid, { admin: true });
    }

    /** An invitation of `email` by `inviter`, as `admins.invite` stores it (the address hashed, never stored). */
    async invite(email: string, inviter: SignedInAccount, at: Date, expiresAt: Date): Promise<void> {
        const stamp = { updatedBy: inviter.uid, updatedAt: at };
        await this.setDocument(`invites/${await inviteIdFor(email)}`, {
            role: 'admin',
            invitedBy: inviter.uid,
            createdAt: at,
            expiresAt,
            ...stamp,
        });
    }

    /** `account` as an admin who already joined, as `admin.join` leaves it: `admins/<uid>` and the `admin` claim. */
    async addAdmin(account: SignedInAccount, inviter: SignedInAccount, at: Date): Promise<void> {
        const record = {
            role: 'admin',
            email: account.email,
            invitedBy: inviter.uid,
            createdAt: at,
            updatedBy: account.uid,
            updatedAt: at,
        };
        await this.setDocument(`admins/${account.uid}`, record);
        await this.setClaims(account.uid, { admin: true });
    }
}
