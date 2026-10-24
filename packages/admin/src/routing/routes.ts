/**
 * The admin's hash routes (`docs/research/M2b-interfaces.md` §1.1): `#/<route>` plus at most two id segments
 * (`#/photos/<photoId>`, `#/history/<entity>/<id>`, `#/setup/<step>`). Hash routing needs no Hosting rewrite and keeps
 * every address on the one `index.html`. `#/home` is the dashboard the M2c editors added (`docs/research/M2c-interfaces.md`
 * CR-M2c-24); `#/imagery` and `#/georef/<versionId>` are M3's (`docs/research/M3-interfaces.md` §10.1, CR-M3-9).
 */
export const ADMIN_ROUTES = [
    'home',
    'setup',
    'photos',
    'pois',
    'layers',
    'imagery',
    'jobs',
    'settings',
    'admins',
    'history',
    'crashes',
    'georef',
] as const;

export type AdminRouteId = (typeof ADMIN_ROUTES)[number];

export interface AdminRouteSpec {
    /** The navigation icon (a Material Symbols name the admin's icon subset bundles). */
    readonly icon: string;
    /** False only for Setup: every other page reads Firestore or calls a function, so it waits for the server. */
    readonly needsBackend: boolean;
    /** One of the four destinations of the compact navigation bar while Setup is not complete; the rest sit under "More". */
    readonly inCompactBar: boolean;
    /**
     * One of the four once Setup is complete: the dashboard takes Setup's place, Setup moves under "More"
     * (`DECISIONS-for-review.md` §34i).
     */
    readonly inCompactBarOnceSetUp: boolean;
    /** False for a page reached only from another (the georeferencer, from a version): never a navigation destination. */
    readonly inNavigation?: false;
}

export const ADMIN_ROUTE_SPECS: Readonly<Record<AdminRouteId, AdminRouteSpec>> = {
    /**
     * The dashboard (M2c, ops-screens): the first screen once Setup is complete, and then on the compact bar in Setup's
     * place (`DECISIONS-for-review.md` §34i); under More before.
     */
    home: { icon: 'home', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: true },
    setup: { icon: 'checklist', needsBackend: false, inCompactBar: true, inCompactBarOnceSetUp: false },
    photos: { icon: 'photo_library', needsBackend: true, inCompactBar: true, inCompactBarOnceSetUp: true },
    pois: { icon: 'place', needsBackend: true, inCompactBar: true, inCompactBarOnceSetUp: true },
    layers: { icon: 'layers', needsBackend: true, inCompactBar: true, inCompactBarOnceSetUp: true },
    /** M3's Imagery area: after Layers in the rail, under More on the compact bar (`docs/research/M3-interfaces.md` §10.1). */
    imagery: { icon: 'satellite_alt', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false },
    jobs: { icon: 'pending_actions', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false },
    settings: { icon: 'settings', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false },
    admins: { icon: 'group', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false },
    history: { icon: 'history', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false },
    crashes: { icon: 'bug_report', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false },
    /** The georeferencer: opened from a version or a layer (`#/georef/<versionId>`), never from the navigation. */
    georef: { icon: 'add_location_alt', needsBackend: true, inCompactBar: false, inCompactBarOnceSetUp: false, inNavigation: false },
};

export interface AdminRoute {
    readonly id: AdminRouteId;
    /** The id segments after the route, each `^[A-Za-z0-9_-]{1,64}$`; at most two. */
    readonly params: readonly string[];
}

/** Where an unknown or malformed address lands, and an empty one before Setup is complete. */
export const DEFAULT_ADMIN_ROUTE: AdminRoute = { id: 'setup', params: [] };

/** Where an empty address lands once Setup is complete (`DECISIONS-for-review.md` §34i). */
export const SET_UP_ADMIN_ROUTE: AdminRoute = { id: 'home', params: [] };

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
