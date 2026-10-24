/**
 * Which page an address opens (`docs/research/M2b-interfaces.md` §1.1). An empty address opens Setup, or the dashboard
 * once Setup is complete (`DECISIONS-for-review.md` §34i, S-A40-HAPPY-FIRST-SCREEN). Anything that is not exactly a known
 * route opens Setup with `adminShell.route.notFound` (S-A29-BAD-UNKNOWN-ROUTE); a page that needs the server, opened in start-up
 * mode, opens Setup with `adminShell.route.needsBackend` (S-A25-BAD-PAGE-NEEDS-SERVER); a page not built yet opens Setup
 * like an unknown one. Signed out, the address asked for is kept (`hcm:admin:returnTo`) and opened after sign-in
 * (S-A20-BAD-SIGNED-OUT-DEEP-LINK).
 */
import type { AdminShellKey } from '@hcm/shared';

import type { AdminMode } from '../auth/auth-state.js';
import type { AdminDestination } from '../state/state.js';
import {
    ADMIN_ROUTE_SPECS,
    ADMIN_ROUTES,
    DEFAULT_ADMIN_ROUTE,
    parseAdminRoute,
    SET_UP_ADMIN_ROUTE,
    type AdminRoute,
    type AdminRouteId,
} from './routes.js';

/** `sessionStorage`: the route hash a signed-out visitor asked for (a route hash only, never a token). */
export const RETURN_TO_KEY = 'hcm:admin:returnTo';

/** What decides a route: the mode, which pages exist and whether Setup is complete. */
export interface RouteContext {
    readonly mode: AdminMode | null;
    readonly hasPage: (id: AdminRouteId) => boolean;
    /** Setup's required steps are done (`setup/status`, `../app/setup-readiness.ts`); unknown counts as not. */
    readonly setupReady?: boolean;
}

export interface ResolvedRoute {
    readonly route: AdminRoute;
    /** Why the address was not opened as asked; null when it was. */
    readonly notice: AdminShellKey | null;
}

/** No route at all (`''`, `#`, `#/`): Setup or the dashboard, without a message. */
export function isBlankAddress(hash: string): boolean {
    return hash.replace(/^#\/?/, '') === '';
}

/** Whether the admin is set up: normal mode and Setup's required steps done. */
function setUp(context: RouteContext): boolean {
    return context.mode === 'normal' && context.setupReady === true;
}

/** The first screen: the dashboard once Setup is complete (and its page exists), else Setup. */
function firstRoute(context: RouteContext): AdminRoute {
    return setUp(context) && context.hasPage(SET_UP_ADMIN_ROUTE.id) ? SET_UP_ADMIN_ROUTE : DEFAULT_ADMIN_ROUTE;
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
    if (isBlankAddress(hash)) {
        return { route: firstRoute(context), notice: null };
    }
    const route = parseAdminRoute(hash);
    const notice = route === null ? 'adminShell.route.notFound' : refusal(route, context);
    return notice === null && route !== null ? { route, notice: null } : { route: DEFAULT_ADMIN_ROUTE, notice };
}

/**
 * The navigation's destinations: Setup alone in start-up mode; in normal mode Setup and every route whose page exists,
 * in `ADMIN_ROUTES` order. History joined once its page existed (M2c, CR-M2c-8): the city's recent changes are a page of
 * their own, and an item's History opens `#/history/<entity>/<id>`. Once Setup is complete the dashboard is on the
 * compact bar in Setup's place, and Setup under More (§34i). The georeferencer is no destination (M3, `inNavigation: false`).
 */
export function navigationDestinations(context: RouteContext): readonly AdminDestination[] {
    const ids = context.mode === 'normal' ? ADMIN_ROUTES.filter((id) => id === 'setup' || navigable(id, context)) : ['setup' as const];
    const done = setUp(context);
    return ids.map((id) => destinationOf(id, done));
}

/** A page of the navigation: built, and not one reached only from another page (the georeferencer). */
function navigable(id: AdminRouteId, context: RouteContext): boolean {
    return ADMIN_ROUTE_SPECS[id].inNavigation !== false && context.hasPage(id);
}

export function destinationOf(id: AdminRouteId, setUpDone = false): AdminDestination {
    const spec = ADMIN_ROUTE_SPECS[id];
    return { id, icon: spec.icon, compact: setUpDone ? spec.inCompactBarOnceSetUp : spec.inCompactBar };
}
