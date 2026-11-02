/**
 * "Use this computer" (finding 72 of 2026-11-02, the user: "I should not have to copy and paste"; the user's decision
 * "Starter file + auto-pair"; `docs/research/M7-local-worker.md` §1.5, §2.7), in the lazy `worker-local` chunk:
 *
 * - **The starter file.** One click gives a small file for this computer's system (Linux `hcm-worker.sh`, macOS
 *   `hcm-worker.command`, Windows `hcm-worker.bat`), made from the template the site build publishes next to the admin
 *   (`/admin/worker/hcm-worker.sh`, `hcm-worker.bat`: `packages/admin/starter/`) with the project, the city and the action
 *   filled in; it holds no secret. Opened once, it checks Docker and installs a supervisor of the owner's user that runs the
 *   worker in the background and keeps it on the installed pipeline image. Stop using this computer gives the same file
 *   with `uninstall`, and disconnects the computer's worker (`worker.revoke`).
 * - **Auto-pair.** While the panel is shown or the admin is open (`../app/local-watch.ts`: one instance per city and project,
 *   started by each that shows it), and this browser set the computer up for the city (`LOCAL_KEY`), it looks at
 *   the worker's local state (`GET http://127.0.0.1:8765/state`) every `PROBE_MS`; a worker of this city and project that
 *   takes a code (`pairable`) gets a fresh one (`worker.pairCode`, posted to `POST /pair`), so nothing is copied or pasted.
 *   The worker answers those two requests for the project's Hosting origins only (CORS, Private Network Access).
 * - **Advanced.** The copyable command of finding 66, with its own one-time code (minted when Advanced is opened, renewed
 *   a minute before it expires).
 */
import { WORKER_PAIR_SECONDS, WORKER_PORT, WORKER_STARTER_PLACEHOLDERS, WORKER_STARTER_TEMPLATES } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import { Store } from '../state/store.js';
import { LOCAL_KEY } from './local-key.js';

export { LOCAL_KEY } from './local-key.js';

/** The systems a starter file is made for. */
export const WORKER_OSES = ['linux', 'mac', 'windows'] as const;
export type WorkerOs = (typeof WORKER_OSES)[number];

/** Where this computer's worker answers (the loopback address its command publishes the port on). */
export const LOCAL_WORKER = `http://127.0.0.1:${String(WORKER_PORT)}`;
/** How often the panel looks at this computer's worker. */
export const PROBE_MS = 5000;
/** A code is posted again only after this long without the worker signing in with the last one. */
const PAIR_AGAIN_MS = 60_000;
/** The Advanced command's code is minted again this long before it expires. */
const RENEW_MS = (WORKER_PAIR_SECONDS - 60) * 1000;

/** The file's name, by system and action. */
const FILE_NAMES: Readonly<Record<'install' | 'uninstall', Readonly<Record<WorkerOs, string>>>> = {
    install: { linux: 'hcm-worker.sh', mac: 'hcm-worker.command', windows: 'hcm-worker.bat' },
    uninstall: { linux: 'hcm-worker-remove.sh', mac: 'hcm-worker-remove.command', windows: 'hcm-worker-remove.bat' },
};

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const CITY_ID = /^[a-z0-9-]{2,32}$/;

/** What the panel shows of this computer: nothing yet, the file given, pairing, connected, removed, or the file failed. */
type LocalPhase = 'none' | 'downloaded' | 'connecting' | 'connected' | 'stopped' | 'failed';

export interface LocalState {
    readonly os: WorkerOs;
    readonly phase: LocalPhase;
    /** The Advanced command's one-time code (null until Advanced asked for one, or when none could be minted). */
    readonly code: string | null;
}

/** A starter file as the browser saves it. */
export interface StarterFile {
    readonly name: string;
    readonly text: string;
}

export interface LocalIntents {
    setOs(os: WorkerOs): void;
    /** The starter file (null when it could not be made), and the auto-pair from now on. */
    use(): Promise<StarterFile | null>;
    /** The removal file, the computer's worker disconnected, and no more auto-pair. */
    stop(): Promise<StarterFile | null>;
    /** A one-time code for the Advanced command, renewed while the panel is shown. */
    command(): Promise<void>;
}

/** What the worker's `GET /state` answers that matters here. */
interface LocalAnswer {
    readonly workerId: string;
    readonly signedIn: boolean;
    readonly pairable: boolean;
    readonly city: string;
    readonly project: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The system of the browser's computer: Windows, macOS, else Linux. */
export function osOf(userAgent: string): WorkerOs {
    if (/Windows/i.test(userAgent)) {
        return 'windows';
    }
    return /Macintosh|Mac OS X/i.test(userAgent) ? 'mac' : 'linux';
}

/** The template filled with the project, the city and the action (checked first: null for any other shape); CRLF on Windows. */
export function starterText(
    template: string,
    values: { readonly project: string; readonly city: string; readonly action: string },
    os: WorkerOs,
): string | null {
    if (!PROJECT_ID.test(values.project) || !CITY_ID.test(values.city)) {
        return null;
    }
    const marks = WORKER_STARTER_PLACEHOLDERS;
    const text = template
        .replaceAll(marks.project, values.project)
        .replaceAll(marks.city, values.city)
        .replaceAll(marks.action, values.action);
    return os === 'windows' ? text.replace(/\r?\n/g, '\r\n') : text;
}

/** The worker's answer, when it is one (any other shape: none). */
function answerOf(value: unknown): LocalAnswer | null {
    const answer = value as Partial<LocalAnswer> | null;
    const fields = [answer?.workerId, answer?.city, answer?.project];
    return fields.every((field) => typeof field === 'string') ? (answer as LocalAnswer) : null;
}

export class LocalComputer {
    readonly #services: ContentServices;
    readonly #project: string;
    readonly #fetch: Fetch;
    readonly #cell: Store<LocalState>;
    readonly intents: LocalIntents;
    #timer: unknown = null;
    #renew: unknown = null;
    /** How many show it (the panels, the shell's watch): it looks while any does. */
    #users = 0;
    #pairedAt = Number.NEGATIVE_INFINITY;
    #workerId: string | null = null;

    constructor(services: ContentServices, project: string, fetch: Fetch, userAgent: string) {
        this.#services = services;
        this.#project = project;
        this.#fetch = fetch;
        const remembered = services.local.get(LOCAL_KEY) === services.cityId;
        this.#cell = new Store<LocalState>({ os: osOf(userAgent), phase: remembered ? 'downloaded' : 'none', code: null }, services.log);
        this.intents = {
            setOs: (os) => {
                this.#cell.update({ os });
            },
            use: () => this.#use(),
            stop: () => this.#stop(),
            command: () => this.#mint(),
        };
    }

    get state(): LocalState {
        return this.#cell.state;
    }

    subscribe(listener: (state: LocalState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    /** One more shows it: it looks at this computer's worker while any does, when this browser set it up for the city. */
    start(): void {
        this.#users += 1;
        this.#look();
    }

    /** One fewer shows it; with none left, it stops looking. */
    stop(): void {
        this.#users = Math.max(0, this.#users - 1);
        if (this.#users === 0) {
            this.#halt();
        }
    }

    get #running(): boolean {
        return this.#users > 0;
    }

    /** The first look, unless one is under way or scheduled. */
    #look(): void {
        if (this.#remembered() && this.#timer === null) {
            void this.#probe();
        }
    }

    #halt(): void {
        const { clock } = this.#services;
        clock.clearTimeout(this.#timer);
        clock.clearTimeout(this.#renew);
        this.#timer = null;
        this.#renew = null;
    }

    #remembered(): boolean {
        return this.#services.local.get(LOCAL_KEY) === this.#services.cityId;
    }

    async #use(): Promise<StarterFile | null> {
        const file = await this.#file('install');
        if (file === null) {
            this.#cell.update({ phase: 'failed' });
            return null;
        }
        this.#services.local.set(LOCAL_KEY, this.#services.cityId);
        this.#cell.update({ phase: 'downloaded' });
        this.#look();
        return file;
    }

    async #stop(): Promise<StarterFile | null> {
        const file = await this.#file('uninstall');
        if (file === null) {
            this.#cell.update({ phase: 'failed' });
            return null;
        }
        this.#services.local.remove(LOCAL_KEY);
        this.#halt();
        this.#cell.update({ phase: 'stopped' });
        await this.#disconnect();
        return file;
    }

    /** This computer's worker, when it answered, disconnected in the admin (a failure leaves it: the file removes it anyway). */
    async #disconnect(): Promise<void> {
        const workerId = this.#workerId;
        if (workerId === null) {
            return;
        }
        await this.#services.callables.call('worker.revoke', { cityId: this.#services.cityId, workerId }).catch(() => undefined);
    }

    /** The starter file for the chosen system and `action`, from the template next to the admin; null when it cannot be made. */
    async #file(action: 'install' | 'uninstall'): Promise<StarterFile | null> {
        const { os } = this.#cell.state;
        const template = await this.#template(os === 'windows' ? WORKER_STARTER_TEMPLATES.windows : WORKER_STARTER_TEMPLATES.posix);
        const values = { project: this.#project, city: this.#services.cityId, action };
        const text = template === null ? null : starterText(template, values, os);
        return text === null ? null : { name: FILE_NAMES[action][os], text };
    }

    async #template(file: string): Promise<string | null> {
        try {
            const response = await this.#fetch(`${import.meta.env.BASE_URL}worker/${file}`, { cache: 'no-cache' });
            return response.ok ? await response.text() : null;
        } catch {
            return null;
        }
    }

    /** One look at this computer's worker, and the next one `PROBE_MS` later while the panel is shown. */
    async #probe(): Promise<void> {
        this.#timer = 'looking';
        await this.#seen(await this.#ask());
        this.#timer = null;
        if (this.#running && this.#remembered()) {
            this.#timer = this.#services.clock.setTimeout(() => void this.#probe(), PROBE_MS);
        }
    }

    /** The worker's state, or null (none answers on this computer, or not with a state). */
    async #ask(): Promise<LocalAnswer | null> {
        try {
            const response = await this.#fetch(`${LOCAL_WORKER}/state`, { credentials: 'omit', cache: 'no-store' });
            return response.ok ? answerOf(await response.json()) : null;
        } catch {
            return null;
        }
    }

    /** Connected, or a code for a worker of this city and project that takes one; anything else changes nothing. */
    async #seen(answer: LocalAnswer | null): Promise<void> {
        if (!this.#ours(answer)) {
            return;
        }
        this.#workerId = answer.workerId;
        if (answer.signedIn) {
            this.#cell.update({ phase: 'connected' });
        } else if (this.#pairs(answer)) {
            await this.#pair();
        }
    }

    /** A worker of this city and this project answered. */
    #ours(answer: LocalAnswer | null): answer is LocalAnswer {
        return answer?.city === this.#services.cityId && answer.project === this.#project;
    }

    /** It takes a code, and none was posted in the last minute. */
    #pairs(answer: LocalAnswer): boolean {
        return answer.pairable && this.#services.clock.now() - this.#pairedAt >= PAIR_AGAIN_MS;
    }

    /** A fresh code, posted to the worker, which pairs with it at once. */
    async #pair(): Promise<void> {
        const { callables, cityId, clock } = this.#services;
        this.#pairedAt = clock.now();
        this.#cell.update({ phase: 'connecting' });
        try {
            const { code } = await callables.call('worker.pairCode', { cityId });
            const body = JSON.stringify({ code });
            await this.#fetch(`${LOCAL_WORKER}/pair`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                credentials: 'omit',
            });
        } catch (error) {
            this.#services.log.warn('this computer could not be paired', { error: String(error) });
        }
    }

    /** The Advanced command's code, minted again a minute before it expires while the panel is shown. */
    async #mint(): Promise<void> {
        const { callables, cityId, clock } = this.#services;
        clock.clearTimeout(this.#renew);
        try {
            const { code } = await callables.call('worker.pairCode', { cityId });
            this.#cell.update({ code });
            this.#renew = this.#running ? clock.setTimeout(() => void this.#mint(), RENEW_MS) : null;
        } catch {
            this.#cell.update({ code: null });
        }
    }
}

/** One instance per area's services and project: the panels and the shell's watch share it (and its looks). */
const SHARED = new WeakMap<ContentServices, Map<string, LocalComputer>>();

/** This computer's part of the worker's panel, over the area's services and the page's `fetch`; shared, see `SHARED`. */
export function createLocal(services: ContentServices, project: string): LocalComputer {
    const byProject = SHARED.get(services) ?? new Map<string, LocalComputer>();
    SHARED.set(services, byProject);
    const local =
        byProject.get(project) ??
        new LocalComputer(services, project, (url, init) => globalThis.fetch(url, init), globalThis.navigator.userAgent);
    byProject.set(project, local);
    return local;
}
