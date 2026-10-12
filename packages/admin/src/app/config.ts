/**
 * The admin's start-up configuration (`docs/research/M2b-interfaces.md` §1.4): the Firebase web configuration Hosting
 * serves at its reserved URL `/__/firebase/init.json` (never committed; the e2e admin server answers it with the
 * `demo-hcm` emulator configuration), and the optional `/runtime.json` the deploy writes (the release and the App Check
 * site key, `DECISIONS-for-review.md` §23b).
 */
import { z } from 'zod';

import { parseProjectConfig, type ProjectConfig } from '../provision/project-config.js';

/** Hosting's reserved URL of the project's web configuration. */
export const WEB_CONFIG_URL = '/__/firebase/init.json';

/** Written by the deploy next to `index.html`; a 404 means none (bootstrap mode, the e2e build, the first deploys). */
export const RUNTIME_URL = '/runtime.json';

/**
 * `infra/project.json` as the page serves it (the admin's site build copies it next to `index.html`; the e2e admin server
 * answers the e2e world's): the project the provisioner works on (§3.7).
 */
export const PROJECT_URL = '/project.json';

/** The release a crash belongs to when no `runtime.json` names one. */
export const UNKNOWN_RELEASE = 'dev';

const identifier = z.string().min(1).max(200);

/**
 * What `initializeApp` needs. Hosting's file carries more keys (`databaseURL`, `locationId`, ...), which are dropped;
 * `messagingSenderId` is the project number.
 */
const firebaseWebConfigSchema = z.object({
    projectId: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/),
    appId: identifier,
    apiKey: identifier,
    authDomain: identifier,
    messagingSenderId: z.string().regex(/^\d{1,20}$/),
    storageBucket: identifier.optional(),
    measurementId: z
        .string()
        .regex(/^G-[A-Z0-9]{4,20}$/)
        .optional(),
});

export type FirebaseWebConfig = z.infer<typeof firebaseWebConfigSchema>;

const adminRuntimeSchema = z.object({
    release: z.string().min(1).max(64),
    /** The reCAPTCHA Enterprise site key of App Check; without it the admin runs without App Check. */
    appCheckSiteKey: z
        .string()
        .regex(/^[\w-]{10,100}$/)
        .optional(),
});

export type AdminRuntime = z.infer<typeof adminRuntimeSchema>;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The JSON of `url` (no credentials, never cached), or undefined when it cannot be fetched or read. */
async function readJson(fetch: Fetch, url: string): Promise<unknown> {
    try {
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        return response.ok ? ((await response.json()) as unknown) : undefined;
    } catch {
        return undefined;
    }
}

/** The web configuration, or null when it is missing or fails its schema (the `configMissing` state). */
export async function loadWebConfig(fetch: Fetch): Promise<FirebaseWebConfig | null> {
    const parsed = firebaseWebConfigSchema.safeParse(await readJson(fetch, WEB_CONFIG_URL));
    return parsed.success ? parsed.data : null;
}

/** The project file, or null when it is missing or fails its schema (the Setup Assistant then cannot run). */
export async function loadProject(fetch: Fetch): Promise<ProjectConfig | null> {
    return parseProjectConfig(await readJson(fetch, PROJECT_URL)) ?? null;
}

/** The runtime file, or `{release: 'dev'}` without one (an unreadable or invalid file counts as none). */
export async function loadRuntime(fetch: Fetch): Promise<AdminRuntime> {
    const parsed = adminRuntimeSchema.safeParse(await readJson(fetch, RUNTIME_URL));
    return parsed.success ? parsed.data : { release: UNKNOWN_RELEASE };
}
