/**
 * The address and the shell's page (`docs/research/M2b-interfaces.md` §1.1): while the shell shows (start-up or normal
 * mode) every hash change resolves to a route; before that the address asked for is kept in `sessionStorage` and opened
 * once the shell shows (a deep link while signed out leads to sign-in, then to the page). A redirect rewrites the address
 * without a history entry and shows why in the snackbar. Every route shown is one GA4 page view (behind consent).
 */
import { showsShell } from '../auth/auth-state.js';
import type { PageRegistry } from '../routing/pages.js';
import { navigationDestinations, resolveAdminRoute, RETURN_TO_KEY, type RouteContext } from '../routing/router.js';
import { adminRouteHash, type AdminRoute } from '../routing/routes.js';
import type { ShellState, ShellStateAccess } from '../state/state.js';
import type { HashLocation, KeyValueStore, Unsubscribe } from './ports.js';
import type { AdminEvent } from './telemetry.js';

export interface NavigationDeps {
    readonly shell: ShellStateAccess;
    readonly location: HashLocation;
    readonly session: KeyValueStore;
    readonly pages: PageRegistry;
    readonly track: (event: AdminEvent) => void;
}

export class Navigation {
    readonly #deps: NavigationDeps;
    readonly #stop: Unsubscribe;
    #shown = false;
    #mode: ShellState['mode'] = null;
    /** The address of the last page view (one per route shown). */
    #tracked: string | null = null;

    constructor(deps: NavigationDeps) {
        this.#deps = deps;
        this.#stop = deps.location.onHashChange((hash) => {
            this.#apply(hash);
        });
    }

    /** Called on every state change: the shell appearing, or the mode changing, resolves the address again. */
    stateChanged(state: ShellState): void {
        const shown = showsShell(state.auth);
        if (shown === this.#shown && state.mode === this.#mode) {
            return;
        }
        this.#shown = shown;
        this.#mode = state.mode;
        if (shown) {
            this.#apply(this.#returnTo() ?? this.#deps.location.hash());
        } else {
            this.#keep(this.#deps.location.hash());
        }
    }

    navigate(route: AdminRoute): void {
        this.#deps.location.setHash(adminRouteHash(route), false);
    }

    stop(): void {
        this.#stop();
    }

    #context(): RouteContext {
        return { mode: this.#deps.shell.get().mode, hasPage: (id) => this.#deps.pages.has(id) };
    }

    /** The kept address (removed once read); it replaces the current one. */
    #returnTo(): string | null {
        const kept = this.#deps.session.get(RETURN_TO_KEY);
        this.#deps.session.remove(RETURN_TO_KEY);
        if (kept !== null) {
            this.#deps.location.setHash(kept, true);
        }
        return kept;
    }

    /** Keeps a route hash for after sign-in (anything else is not kept). */
    #keep(hash: string): void {
        if (/^#\/[\w/-]{1,200}$/.test(hash)) {
            this.#deps.session.set(RETURN_TO_KEY, hash);
        }
    }

    #apply(hash: string): void {
        if (!showsShell(this.#deps.shell.get().auth)) {
            this.#keep(hash);
            return;
        }
        const context = this.#context();
        const resolved = resolveAdminRoute(hash, context);
        const address = adminRouteHash(resolved.route);
        if (resolved.notice !== null) {
            this.#deps.location.setHash(address, true);
            this.#deps.shell.update({ notice: this.#deps.shell.notice({ key: resolved.notice }) });
        }
        this.#deps.shell.update({ route: resolved.route, destinations: navigationDestinations(context) });
        if (address !== this.#tracked) {
            this.#tracked = address;
            this.#deps.track({ name: 'page_view', route: resolved.route.id });
        }
    }
}
