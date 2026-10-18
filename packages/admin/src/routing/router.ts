/**
 * Which page an address opens (`docs/research/M2b-interfaces.md` §1.1). Anything that is not exactly a known route opens
 * Setup with `adminShell.route.notFound` (S-A29-BAD-UNKNOWN-ROUTE); a page that needs the server, opened in start-up
 * mode, opens Setup with `adminShell.route.needsBackend` (S-A25-BAD-PAGE-NEEDS-SERVER); a page not built yet opens Setup
 * like an unknown one. Signed out, the address asked for is kept (`hcm:admin:returnTo`) and opened after sign-in
 * (S-A20-BAD-SIGNED-OUT-DEEP-LINK).
 */
import type { AdminShellKey } from '@hcm/shared';

import type { AdminMode } from '../auth/auth-state.js';
import type { AdminDestination } from '../state/state.js';
import { ADMIN_ROUTE_SPECS, ADMIN_ROUTES, DEFAULT_ADMIN_ROUTE, parseAdminRoute, type AdminRoute, type AdminRouteId } from './routes.js';

/** `sessionStorage`: the route hash a signed-out visitor asked for (a route hash only, never a token). */
export const RETURN_TO_KEY = 'hcm:admin:returnTo';

/** What decides a route: the mode and which pages exist. */
export interface RouteContext {
    readonly mode: AdminMode | null;
    readonly hasPage: (id: AdminRouteId) => boolean;
}

export interface ResolvedRoute {
    readonly route: AdminRoute;
    /** Why the address was not opened as asked; null when it was. */
    readonly notice: AdminShellKey | null;
}

/** No route at all (`''`, `#`, `#/`): Setup, without a message. */
function isBlank(hash: string): boolean {
    return hash.replace(/^#\/?/, '') === '';
}

/** Why an existing route cannot open now, or null. Setup always opens (the shell shows its own placeholder). */
function refusal(route: AdminRoute, context: RouteContext): AdminShellKey | null {
    if (route.id === 'setup') {
        return null;
    }
    if (ADMIN_ROUTE_SPECS[route.id].needsBackend && context.mode !== 'normal') {
        return 'adminShell.route.needsBackend';
    }
    return context.hasPage(route.id) ? null : 'adminShell.route.notFound';
}

export function resolveAdminRoute(hash: string, context: RouteContext): ResolvedRoute {
    if (isBlank(hash)) {
        return { route: DEFAULT_ADMIN_ROUTE, notice: null };
    }
    const route = parseAdminRoute(hash);
    const notice = route === null ? 'adminShell.route.notFound' : refusal(route, context);
    return notice === null && route !== null ? { route, notice: null } : { route: DEFAULT_ADMIN_ROUTE, notice };
}

/**
 * The navigation's destinations: Setup alone in start-up mode; in normal mode Setup and every route whose page exists,
 * in `ADMIN_ROUTES` order. History joined once its page existed (M2c, CR-M2c-8): the city's recent changes are a page of
 * their own, and an item's History opens `#/history/<entity>/<id>`.
 */
export function navigationDestinations(context: RouteContext): readonly AdminDestination[] {
    const ids = context.mode === 'normal' ? ADMIN_ROUTES.filter((id) => id === 'setup' || context.hasPage(id)) : ['setup' as const];
    return ids.map(destinationOf);
}

export function destinationOf(id: AdminRouteId): AdminDestination {
    return { id, icon: ADMIN_ROUTE_SPECS[id].icon, compact: ADMIN_ROUTE_SPECS[id].inCompactBar };
}
