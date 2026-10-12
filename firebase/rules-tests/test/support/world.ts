/**
 * Test world for the security-rules matrix: personas, emulator contexts, seeding and verdicts.
 *
 * Runs only under `firebase emulators:exec --project demo-hcm --only auth,firestore,storage`
 * (scripts/ci/run-emulated-tests.sh): initializeTestEnvironment discovers the emulators through the
 * hub, and the emulators load firebase/firestore.rules and firebase/storage.rules from firebase.json
 * once at start-up, so the Firestore rule coverage accumulates over every test file (loading rules
 * from a test would reset it). Test files run in parallel against the same emulators, so every file
 * owns a `scope`: its persona uids and its city ids start with it, and nothing is ever cleared.
 */
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment, type TokenOptions } from '@firebase/rules-unit-testing';
import { FIRESTORE_PATHS, inviteIdFor } from '@hcm/shared';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { vi } from 'vitest';

const PROJECT_ID = 'demo-hcm';

// The SDK logs every PERMISSION_DENIED it receives; denials are the expected outcome of half the matrix.
firebase.firestore.setLogLevel('silent');

// Every request is a round trip to the emulators (a 60 MiB upload among them), so each test file that
// uses this world gets generous timeouts (set here rather than in the shared vitest.config.ts).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Who is asking. Every persona but `admin` misses at least one admin condition (docs/research/M2-interfaces.md §3.1):
 * a verified Google account, the `admin` claim and an admins/{uid} document.
 */
export type Persona =
    | 'anonymous' // no Firebase Auth user
    | 'stranger' // verified Google account, no claim, no admins doc
    | 'invited' // a stranger with a pending invitation (invites/{sha256}): admin.join has not run yet
    | 'unverified' // claim + admins doc, but email_verified is false
    | 'otherProvider' // claim + admins doc, but signed in with a password, not Google
    | 'revoked' // claim but no admins doc: admins.revoke deleted it and the ID token still carries the claim
    | 'pending' // admins doc but no claim yet: admin.join or admin.claim ran, the ID token is not refreshed
    | 'admin'; // verified Google account with the claim and the admins doc

/** Every persona, `admin` last: a test that lets the admin write runs it after the denials. */
export const EVERYONE: readonly Persona[] = [
    'anonymous',
    'stranger',
    'invited',
    'unverified',
    'otherProvider',
    'revoked',
    'pending',
    'admin',
];
/** The personas `authed()` accepts: a verified Google sign-in, whatever else they hold. */
export const GOOGLE_ACCOUNTS: readonly Persona[] = ['stranger', 'invited', 'revoked', 'pending', 'admin'];
export const ADMIN_ONLY: readonly Persona[] = ['admin'];
export const NOBODY: readonly Persona[] = [];

interface PersonaSpec {
    readonly claims: TokenOptions | null;
    readonly adminDoc: boolean;
    readonly invite: boolean;
}

const GOOGLE: TokenOptions = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };

const PERSONAS: Readonly<Record<Persona, PersonaSpec>> = {
    anonymous: { claims: null, adminDoc: false, invite: false },
    stranger: { claims: GOOGLE, adminDoc: false, invite: false },
    invited: { claims: GOOGLE, adminDoc: false, invite: true },
    unverified: { claims: { ...GOOGLE, email_verified: false, admin: true }, adminDoc: true, invite: false },
    otherProvider: {
        claims: { email_verified: true, firebase: { sign_in_provider: 'password' }, admin: true },
        adminDoc: true,
        invite: false,
    },
    revoked: { claims: { ...GOOGLE, admin: true }, adminDoc: false, invite: false },
    pending: { claims: GOOGLE, adminDoc: true, invite: false },
    admin: { claims: { ...GOOGLE, admin: true }, adminDoc: true, invite: false },
};

type Context = ReturnType<RulesTestEnvironment['unauthenticatedContext']>;
type Db = firebase.firestore.Firestore;
type Storage = firebase.storage.Storage;
export type Data = firebase.firestore.DocumentData;
export type Timestamp = firebase.firestore.Timestamp;

/** The rules' answer to one request. */
export type Verdict = 'allow' | 'deny';

export interface World {
    readonly env: RulesTestEnvironment;
    uid(persona: Persona): string;
    email(persona: Persona): string;
    db(persona: Persona): Db;
    storage(persona: Persona): Storage;
    /** Writes a Firestore document with rules disabled (the Admin SDK's view). */
    seed(path: string, data: Data): Promise<void>;
    /** Uploads an object with rules disabled (what Cloud Functions or the Cloud Run job would write). */
    seedObject(path: string, contentType: string): Promise<void>;
}

/** A fixed timestamp for seeded documents (never equal to request.time). */
export function past(): Timestamp {
    return firebase.firestore.Timestamp.fromMillis(Date.UTC(2026, 0, 1));
}

/** A fixed later timestamp (an invitation's expiry, a lease). */
export function later(): Timestamp {
    return firebase.firestore.Timestamp.fromMillis(Date.UTC(2026, 0, 15));
}

/** `request.time` on the server: the only accepted value for a client's createdAt/updatedAt. */
export function serverTime(): firebase.firestore.FieldValue {
    return firebase.firestore.FieldValue.serverTimestamp();
}

/** Removes a field in an update. */
export function deleted(): firebase.firestore.FieldValue {
    return firebase.firestore.FieldValue.delete();
}

/**
 * `base` with `changes` applied, where a `deleted()` value removes the field: what an update with the same changes
 * leaves, for writes that replace the whole document (`set`, which refuses the delete sentinel).
 */
export function withChanges(base: Data, changes: Data): Data {
    const removed = new Set(Object.keys(changes).filter((field) => isDeletion(changes[field])));
    return Object.fromEntries(Object.entries({ ...base, ...changes }).filter(([field]) => !removed.has(field)));
}

function isDeletion(value: unknown): boolean {
    return value instanceof firebase.firestore.FieldValue && value.isEqual(deleted());
}

/** The audit fields every client write carries. */
export function stampedBy(uid: string): Data {
    return { updatedBy: uid, updatedAt: serverTime() };
}

/** A server write's stamp (`systemWriter`), at a fixed time in the past. */
export function systemStamp(writer: string): Data {
    return { updatedBy: `system:${writer}`, updatedAt: past() };
}

function seedPersonas(world: World): Promise<unknown> {
    const seeds = EVERYONE.flatMap((persona) => {
        const spec = PERSONAS[persona];
        const writes: Promise<void>[] = [];
        if (spec.adminDoc) {
            const admin = { role: 'admin', email: world.email(persona), createdAt: past(), ...systemStamp('bootstrap') };
            writes.push(world.seed(FIRESTORE_PATHS.admin(world.uid(persona)), admin));
        }
        if (spec.invite) {
            const invite = {
                role: 'admin',
                invitedBy: world.uid('admin'),
                createdAt: past(),
                expiresAt: later(),
                ...systemStamp('admins'),
            };
            writes.push(inviteIdFor(world.email(persona)).then((id) => world.seed(FIRESTORE_PATHS.invite(id), invite)));
        }
        return writes;
    });
    return Promise.all(seeds);
}

export async function createWorld(scope: string): Promise<World> {
    const env = await initializeTestEnvironment({ projectId: PROJECT_ID });
    const uid = (persona: Persona): string => `${scope}-${persona}`;
    const email = (persona: Persona): string => `${uid(persona)}@example.test`;
    // One context per persona: every context starts its own Firebase app, which costs more than the request.
    const contexts = new Map<Persona, Context>();
    const context = (persona: Persona): Context => {
        const known = contexts.get(persona);
        if (known !== undefined) {
            return known;
        }
        const { claims } = PERSONAS[persona];
        const created =
            claims === null ? env.unauthenticatedContext() : env.authenticatedContext(uid(persona), { ...claims, email: email(persona) });
        contexts.set(persona, created);
        return created;
    };
    const seed = (path: string, data: Data): Promise<void> =>
        env.withSecurityRulesDisabled(async (admin) => {
            await admin.firestore().doc(path).set(data);
        });
    const seedObject = (path: string, contentType: string): Promise<void> =>
        env.withSecurityRulesDisabled(async (admin) => {
            await admin.storage().ref(path).put(bytes(16), { contentType });
        });
    const world: World = {
        env,
        uid,
        email,
        db: (persona) => context(persona).firestore(),
        storage: (persona) => context(persona).storage(),
        seed,
        seedObject,
    };
    await seedPersonas(world);
    return world;
}

export function bytes(size: number): Uint8Array {
    return new Uint8Array(size);
}

/**
 * Runs a request and reports whether the rules allowed it. Any failure other than a permission
 * denial (emulator down, bad request) is rethrown by assertFails, so a broken test never reads as "deny".
 */
export async function verdict(request: Promise<unknown>): Promise<Verdict> {
    try {
        await request;
        return 'allow';
    } catch (error) {
        await assertFails(Promise.reject(error instanceof Error ? error : new Error(String(error))));
        return 'deny';
    }
}

/** The verdict of the same request for each persona, in order (sequential: writes may touch one document). */
export async function verdicts(
    personas: readonly Persona[],
    request: (persona: Persona) => Promise<unknown>,
): Promise<Partial<Record<Persona, Verdict>>> {
    const result: Partial<Record<Persona, Verdict>> = {};
    for (const persona of personas) {
        result[persona] = await verdict(request(persona));
    }
    return result;
}

/** `{persona: verdict}` where only `allowed` personas get 'allow'. */
export function expected(personas: readonly Persona[], allowed: readonly Persona[]): Partial<Record<Persona, Verdict>> {
    return Object.fromEntries(personas.map((persona) => [persona, allowed.includes(persona) ? 'allow' : 'deny']));
}
