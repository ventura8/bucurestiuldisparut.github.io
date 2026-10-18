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
    /** Whether an editor area holds an edit leaving would lose (`docs/research/M2c-interfaces.md` §2.4). */
    readonly unsaved?: () => boolean;
}

export class Navigation {
    readonly #deps: NavigationDeps;
    readonly #stop: Unsubscribe;
    #shown = false;
    #mode: ShellState['mode'] = null;
    /** Set by Discard: the address change it makes is not questioned again. */
    #allowNext = false;
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
            // The shell appears (or its mode changes): no page holds an edit yet, so nothing is asked.
            this.#allowNext = true;
            this.#apply(this.#returnTo() ?? this.#deps.location.hash());
        } else {
            this.#keep(this.#deps.location.hash());
        }
    }

    /** Opens `route`; with an unsaved edit on screen the shell asks first (`leaving`) and goes nowhere yet. */
    navigate(route: AdminRoute): void {
        if (this.#guarded(route)) {
            return;
        }
        this.#deps.location.setHash(adminRouteHash(route), false);
    }

    /** Discard: the next address change goes through unasked (the page then closes its store, which forgets the edit). */
    leave(): void {
        const leaving = this.#deps.shell.get().leaving;
        this.#deps.shell.update({ leaving: null });
        if (leaving?.kind === 'route') {
            this.#allowNext = true;
            this.#deps.location.setHash(adminRouteHash(leaving.route), false);
        }
    }

    /** Keep editing: the question goes away and nothing moves. */
    stay(): void {
        this.#deps.shell.update({ leaving: null });
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

    /** True when leaving the current page for `route` would lose an edit: the shell then asks (`leaving`). */
    #guarded(route: AdminRoute): boolean {
        const current = this.#deps.shell.get().route;
        const unsaved = this.#deps.unsaved?.() ?? false;
        if (!unsaved || adminRouteHash(route) === adminRouteHash(current)) {
            return false;
        }
        this.#deps.shell.update({ leaving: { kind: 'route', route } });
        return true;
    }

    /**
     * An address typed or a Back with an unsaved edit: a hash change cannot be cancelled, so the editor's address is put
     * back (without a history entry) and the shell asks; Discard then opens the address asked for.
     */
    #heldBack(hash: string, context: RouteContext): boolean {
        if (this.#allowNext) {
            this.#allowNext = false;
            return false;
        }
        const route = resolveAdminRoute(hash, context).route;
        if (!this.#guarded(route)) {
            return false;
        }
        this.#deps.location.setHash(adminRouteHash(this.#deps.shell.get().route), true);
        return true;
    }

    #apply(hash: string): void {
        if (!showsShell(this.#deps.shell.get().auth)) {
            this.#keep(hash);
            return;
        }
        const context = this.#context();
        if (this.#heldBack(hash, context)) {
            return;
        }
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
