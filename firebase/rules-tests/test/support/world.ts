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
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { vi } from 'vitest';

const PROJECT_ID = 'demo-hcm';

// The SDK logs every PERMISSION_DENIED it receives; denials are the expected outcome of half the matrix.
firebase.firestore.setLogLevel('silent');

// Every request is a round trip to the emulators (a 60 MiB upload among them), so each test file that
// uses this world gets generous timeouts (set here rather than in the shared vitest.config.ts).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/** Who is asking. Every non-admin persona fails exactly one of the admin conditions. */
export type Persona =
    | 'anonymous' // no Firebase Auth user
    | 'stranger' // verified Google account, no claim, no admins doc
    | 'unverified' // claim + admins doc, but email_verified is false
    | 'otherProvider' // claim + admins doc, but signed in with a password, not Google
    | 'claimOnly' // claim but no admins doc: a revoked admin whose ID token is still valid
    | 'docOnly' // admins doc but no claim: an admin whose claim was not set (yet)
    | 'admin'; // verified Google account with the claim and the admins doc

export const NON_ADMINS: readonly Persona[] = ['anonymous', 'stranger', 'unverified', 'otherProvider', 'claimOnly', 'docOnly'];
export const EVERYONE: readonly Persona[] = [...NON_ADMINS, 'admin'];

const GOOGLE: TokenOptions = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };

interface PersonaSpec {
    readonly token: TokenOptions | null;
    readonly adminDoc: boolean;
}

const PERSONAS: Readonly<Record<Persona, PersonaSpec>> = {
    anonymous: { token: null, adminDoc: false },
    stranger: { token: GOOGLE, adminDoc: false },
    unverified: { token: { ...GOOGLE, email_verified: false, admin: true }, adminDoc: true },
    otherProvider: { token: { email_verified: true, firebase: { sign_in_provider: 'password' }, admin: true }, adminDoc: true },
    claimOnly: { token: { ...GOOGLE, admin: true }, adminDoc: false },
    docOnly: { token: GOOGLE, adminDoc: true },
    admin: { token: { ...GOOGLE, admin: true }, adminDoc: true },
};

type Db = firebase.firestore.Firestore;
type Storage = firebase.storage.Storage;
export type Data = firebase.firestore.DocumentData;

/** The rules' answer to one request. */
export type Verdict = 'allow' | 'deny';

export interface World {
    readonly env: RulesTestEnvironment;
    uid(persona: Persona): string;
    db(persona: Persona): Db;
    storage(persona: Persona): Storage;
    /** Writes a Firestore document with rules disabled (the Admin SDK's view). */
    seed(path: string, data: Data): Promise<void>;
    /** Uploads an object with rules disabled (what Cloud Functions or the Cloud Run job would write). */
    seedObject(path: string, contentType: string): Promise<void>;
}

export async function createWorld(scope: string): Promise<World> {
    const env = await initializeTestEnvironment({ projectId: PROJECT_ID });
    const uid = (persona: Persona): string => `${scope}-${persona}`;
    const context = (persona: Persona): ReturnType<RulesTestEnvironment['unauthenticatedContext']> => {
        const { token } = PERSONAS[persona];
        return token === null ? env.unauthenticatedContext() : env.authenticatedContext(uid(persona), token);
    };
    const seed = (path: string, data: Data): Promise<void> =>
        env.withSecurityRulesDisabled(async (admin) => {
            await admin.firestore().doc(path).set(data);
        });
    const seedObject = (path: string, contentType: string): Promise<void> =>
        env.withSecurityRulesDisabled(async (admin) => {
            await admin.storage().ref(path).put(bytes(16), { contentType });
        });
    const admins = EVERYONE.filter((persona) => PERSONAS[persona].adminDoc);
    await Promise.all(admins.map((persona) => seed(`admins/${uid(persona)}`, { addedBy: 'bootstrap' })));
    return {
        env,
        uid,
        db: (persona) => context(persona).firestore(),
        storage: (persona) => context(persona).storage(),
        seed,
        seedObject,
    };
}

/** `request.time` on the server: the only accepted value for createdAt/updatedAt. */
export function serverTime(): firebase.firestore.FieldValue {
    return firebase.firestore.FieldValue.serverTimestamp();
}

/** The audit fields every admin write carries. */
export function stampedBy(uid: string): Data {
    return { updatedBy: uid, updatedAt: serverTime() };
}

/** A fixed timestamp for seeded documents (never equal to request.time). */
export function past(): firebase.firestore.Timestamp {
    return firebase.firestore.Timestamp.fromMillis(Date.UTC(2026, 0, 1));
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
