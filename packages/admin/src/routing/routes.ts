/**
 * The admin's hash routes (`docs/research/M2b-interfaces.md` §1.1): `#/<route>` plus at most two id segments
 * (`#/photos/<photoId>`, `#/history/<entity>/<id>`, `#/setup/<step>`). Hash routing needs no Hosting rewrite and keeps
 * every address on the one `index.html`. `#/home` is the dashboard the M2c editors added (`docs/research/M2c-interfaces.md`
 * CR-M2c-24).
 */
export const ADMIN_ROUTES = ['home', 'setup', 'photos', 'pois', 'layers', 'jobs', 'settings', 'admins', 'history', 'crashes'] as const;

export type AdminRouteId = (typeof ADMIN_ROUTES)[number];

export interface AdminRouteSpec {
    /** The navigation icon (a Material Symbols name the admin's icon subset bundles). */
    readonly icon: string;
    /** False only for Setup: every other page reads Firestore or calls a function, so it waits for the server. */
    readonly needsBackend: boolean;
    /** One of the four destinations of the compact navigation bar; the rest sit under "More". */
    readonly inCompactBar: boolean;
}

export const ADMIN_ROUTE_SPECS: Readonly<Record<AdminRouteId, AdminRouteSpec>> = {
    /**
     * The dashboard (M2c, ops-screens): under More on the compact bar until it becomes the first screen
     * (`DECISIONS-for-review.md` §34i).
     */
    home: { icon: 'home', needsBackend: true, inCompactBar: false },
    setup: { icon: 'checklist', needsBackend: false, inCompactBar: true },
    photos: { icon: 'photo_library', needsBackend: true, inCompactBar: true },
    pois: { icon: 'place', needsBackend: true, inCompactBar: true },
    layers: { icon: 'layers', needsBackend: true, inCompactBar: true },
    jobs: { icon: 'pending_actions', needsBackend: true, inCompactBar: false },
    settings: { icon: 'settings', needsBackend: true, inCompactBar: false },
    admins: { icon: 'group', needsBackend: true, inCompactBar: false },
    history: { icon: 'history', needsBackend: true, inCompactBar: false },
    crashes: { icon: 'bug_report', needsBackend: true, inCompactBar: false },
};

export interface AdminRoute {
    readonly id: AdminRouteId;
    /** The id segments after the route, each `^[A-Za-z0-9_-]{1,64}$`; at most two. */
    readonly params: readonly string[];
}

/** Where an unknown or malformed address lands. */
export const DEFAULT_ADMIN_ROUTE: AdminRoute = { id: 'setup', params: [] };

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PARAMS = 2;

function isRouteId(value: string): value is AdminRouteId {
    return (ADMIN_ROUTES as readonly string[]).includes(value);
}

/** Reads `#/photos/abc` as `{id: 'photos', params: ['abc']}`; null for anything that is not exactly a known route. */
export function parseAdminRoute(hash: string): AdminRoute | null {
    const [first = '', ...params] = hash.replace(/^#\/?/, '').split('/');
    const valid = isRouteId(first) && params.length <= MAX_PARAMS && params.every((param) => SEGMENT.test(param));
    return valid ? { id: first, params } : null;
}

/** The address of a route, the inverse of `parseAdminRoute`. */
export function adminRouteHash(route: AdminRoute): string {
    return ['#', route.id, ...route.params].join('/');
}
