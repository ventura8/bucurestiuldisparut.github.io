/**
 * Whether Setup is complete (`DECISIONS-for-review.md` §34i): while an admin is signed in (normal mode) the shell watches
 * `setup/status` and sets `setupReady` once billing, provisioning, Mapbox and USGS are all `ok` (the Setup Assistant's
 * required steps, as its own `ready` counts them). Then an empty address opens the dashboard and the dashboard takes
 * Setup's place on the compact bar (`../routing/router.ts`). This browser remembers the answer per project
 * (`SETUP_READY_KEY`), so the next visit's empty address opens the dashboard before the watch answers; the watch corrects
 * it either way. A `permission-denied` (the admin was removed) asks the server again who this is, as the city's theme does.
 * A city of the `e2e` build's own (`?city=`) is not watched: its first screen is Setup, whatever another spec left there.
 */
import { FIRESTORE_PATHS, type SetupArea } from '@hcm/shared';

import type { DocumentData, DocumentsPort } from '../firebase/ports.js';
import type { ShellState, ShellStateAccess } from '../state/state.js';
import type { KeyValueStore, Unsubscribe } from './ports.js';

/** `localStorage`: the project whose Setup this browser last saw complete. */
export const SETUP_READY_KEY = 'hcm:admin:setupReady';

/** The Setup areas that must be `ok` (the Setup Assistant's required steps). */
const SETUP_REQUIRED_AREAS: readonly SetupArea[] = ['billing', 'provision', 'mapbox', 'usgs'];

/** The `state` an area of `setup/status` records (`ok`, `missing`, …), or undefined. */
function areaState(data: DocumentData | null, area: SetupArea): unknown {
    const record = data?.[area];
    return typeof record === 'object' && record !== null ? (record as Readonly<Record<string, unknown>>)['state'] : undefined;
}

/** `setup/status` complete: every required area `ok` (a missing document, or an area never checked, is not). */
export function setupReadyOf(data: DocumentData | null): boolean {
    return SETUP_REQUIRED_AREAS.every((area) => areaState(data, area) === 'ok');
}

/** What this browser remembers of `projectId`'s Setup: true when it was last seen complete, else unknown. */
export function rememberedSetupReady(local: KeyValueStore, projectId: string): true | null {
    return local.get(SETUP_READY_KEY) === projectId ? true : null;
}

export interface SetupReadinessDeps {
    readonly documents: DocumentsPort;
    readonly shell: ShellStateAccess;
    readonly local: KeyValueStore;
    readonly projectId: string;
    /** An admin read was denied. */
    readonly denied: () => void;
    /**
     * False in a city of the `e2e` build's own (`?city=`, CR-M2c-7), which never reads the singleton `setup/status` that the
     * Setup Assistant's specs rewrite meanwhile (as its map token); true otherwise, always in production.
     */
    readonly watch: boolean;
}

export class SetupReadiness {
    readonly #deps: SetupReadinessDeps;
    #stop: Unsubscribe | null = null;

    constructor(deps: SetupReadinessDeps) {
        this.#deps = deps;
    }

    /** Watches `setup/status` while an admin is signed in with the server (normal mode), and stops otherwise. */
    stateChanged(state: ShellState): void {
        const watching = this.#deps.watch && state.auth === 'admin' && state.mode === 'normal';
        if (watching === (this.#stop !== null)) {
            return;
        }
        if (watching) {
            this.#start();
        } else {
            this.stop();
        }
    }

    stop(): void {
        this.#stop?.();
        this.#stop = null;
    }

    #start(): void {
        this.#stop = this.#deps.documents.watch(
            FIRESTORE_PATHS.setupStatus,
            (data) => {
                this.#known(setupReadyOf(data));
            },
            (code) => {
                this.#stop = null;
                if (code === 'permission-denied') {
                    this.#deps.denied();
                }
            },
        );
    }

    #known(ready: boolean): void {
        const { local, shell, projectId } = this.#deps;
        if (ready) {
            local.set(SETUP_READY_KEY, projectId);
        } else {
            local.remove(SETUP_READY_KEY);
        }
        if (shell.get().setupReady !== ready) {
            shell.update({ setupReady: ready });
        }
    }
}
