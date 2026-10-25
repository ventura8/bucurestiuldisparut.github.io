/**
 * Many cities in one project (M5, behaviours A49 to A52; `docs/research/M5-interfaces.md` §1): who may do what in which
 * city, each city's share of the project's budgets, what the New city flow derives from a name and a drawn rectangle,
 * and the admin's links that name a city. Every city keeps its own documents (`cities/{city}/**`), manifest, public
 * site and admins; the Mapbox and USGS accounts, the Google Cloud budget and the Setup Assistant stay the project's.
 *
 * Membership lives on the admin's own document (`admins/{uid}.cities`, written by the functions only): the security
 * rules read it with one `get` per request, and the callables through `AdminDirectory`. The project owner (the
 * account that claimed the project, `setup/owner`) creates cities and sets their budgets; a city's `owner` invites and
 * removes its admins and exports it; an `editor` edits its content.
 */
import { z } from 'zod';

import { JOBS_PER_DAY } from '../api/imagery.js';
import { slugify, truncateSlug } from '../migration/slug.js';
import { AI_MONTHLY_CAP, GEOCODE_DAILY_CAP } from './assist.js';
import { EXPORT_LIMITS } from './city-export.js';
import type { CityRole, CityRoles } from './city-roles.js';
import { stamp, timestampSchema } from './firestore-common.js';
import { MAPBOX_FREE_COMPUTE_UNITS } from './imagery-publish.js';
import { CITY_ID_PATTERN } from './paths.js';
import { coded, idSchema, isoDateSchema } from './primitives.js';

export { CITY_ROLES, MAX_CITIES, cityRolesSchema, type CityRole, type CityRoles } from './city-roles.js';

/** The longest city id (`CITY_ID_PATTERN`: it names Storage folders and the public site's path). */
export const MAX_CITY_ID_LENGTH = 32;

/** The admin's role in `cityId`, or null (an own key only: `constructor` or `__proto__` are never roles). */
export function cityRoleOf(roles: CityRoles | undefined, cityId: string): CityRole | null {
    return roles !== undefined && Object.hasOwn(roles, cityId) ? (roles[cityId] ?? null) : null;
}

/** Whether `roles` give `cityId` at least `needed` (an owner may do everything an editor may). */
export function hasCityRole(roles: CityRoles | undefined, cityId: string, needed: CityRole): boolean {
    const role = cityRoleOf(roles, cityId);
    return role === 'owner' || (role === 'editor' && needed === 'editor');
}

/** The ids of an admin's cities, sorted (the switcher lists them by name; this order is the fallback). */
export function cityIdsOf(roles: CityRoles | undefined): string[] {
    return Object.keys(roles ?? {}).sort((a, b) => a.localeCompare(b));
}

/**
 * The roles a pre-M5 admin document gets at its first M5 session (`admin.session`) or `ops.tick`: before M5 every admin
 * edited every city, so the project's owner owns every existing city and every other admin edits them all.
 */
export function legacyCityRoles(projectRole: 'owner' | 'admin', cityIds: readonly string[]): Record<string, CityRole> {
    const role: CityRole = projectRole === 'owner' ? 'owner' : 'editor';
    return Object.fromEntries(cityIds.map((cityId) => [cityId, role]));
}

/**
 * Ids no city may take: the folders of a public site, the starter kit and the export (`engine/`, `photos/`, ...) and
 * the admin's own words, so `/<city>/` on GitHub Pages and `#/c/<city>/` in the admin never collide with them.
 */
export const RESERVED_CITY_IDS = [
    'admin',
    'api',
    'assets',
    'cdn',
    'cities',
    'data',
    'engine',
    'export',
    'fonts',
    'legacy',
    'media',
    'new',
    'photos',
    'rasters',
    'starter-kit',
    'templates',
] as const;

/** A well-formed id that is not reserved. */
export function isUsableCityId(cityId: string): boolean {
    return CITY_ID_PATTERN.test(cityId) && !(RESERVED_CITY_IDS as readonly string[]).includes(cityId);
}

function unavailable(cityId: string, taken: ReadonlySet<string>): boolean {
    return taken.has(cityId) || !isUsableCityId(cityId);
}

/**
 * The id the New city flow suggests for a name (`Cluj-Napoca` → `cluj-napoca`, `Iași` → `iasi`): the slug cut to
 * `MAX_CITY_ID_LENGTH` at a word boundary, `city` when the name has no letter or digit, then `-2`, `-3`, ... while it
 * is taken or reserved.
 */
export function suggestCityId(name: string, taken: readonly string[] = []): string {
    const used = new Set(taken);
    const slug = truncateSlug(slugify(name), MAX_CITY_ID_LENGTH);
    const root = slug.length >= 2 ? slug : 'city';
    let id = root;
    let suffix = 1;
    while (unavailable(id, used)) {
        suffix += 1;
        id = `${truncateSlug(root, MAX_CITY_ID_LENGTH - String(suffix).length - 1)}-${String(suffix)}`;
    }
    return id;
}

/** A city's rectangle: at least this many degrees on its shorter side, at most this many on its longer one. */
export const CITY_SPAN_LIMITS = { minDeg: 0.01, maxDeg: 2 } as const;

/** `{west, south, east, north}` in degrees, as the city document stores it. */
export interface CityBounds {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
}

/** Why a drawn rectangle cannot be a city (`validation.bounds`, `.tooSmall`, `.tooBig`), or null when it can. */
export function cityBoundsProblem(bounds: CityBounds): 'validation.bounds' | 'validation.tooSmall' | 'validation.tooBig' | null {
    const width = bounds.east - bounds.west;
    const height = bounds.north - bounds.south;
    if (!(width > 0 && height > 0)) {
        return 'validation.bounds';
    }
    if (Math.min(width, height) < CITY_SPAN_LIMITS.minDeg) {
        return 'validation.tooSmall';
    }
    return Math.max(width, height) > CITY_SPAN_LIMITS.maxDeg ? 'validation.tooBig' : null;
}

/** The narrowest side New city offers for a place found by name (a district; `CITY_SPAN_LIMITS.minDeg` is a block). */
const FOUND_MIN_DEG = 0.02;
const FOUND_DECIMALS = 1e4;

/** `[low, high]` around its centre, at least `FOUND_MIN_DEG` and at most `CITY_SPAN_LIMITS.maxDeg` wide, rounded. */
function fittedSpan(low: number, high: number): readonly [number, number] {
    const centre = (low + high) / 2;
    const half = Math.min(Math.max(high - low, FOUND_MIN_DEG), CITY_SPAN_LIMITS.maxDeg) / 2;
    return [Math.round((centre - half) * FOUND_DECIMALS) / FOUND_DECIMALS, Math.round((centre + half) * FOUND_DECIMALS) / FOUND_DECIMALS];
}

/**
 * The rectangle New city offers for a place found by its name (`cities.locate`): the place's own box, each side widened
 * to a district or narrowed to `CITY_SPAN_LIMITS.maxDeg` around its centre, so it can always be a city.
 */
export function cityAreaAround(bounds: CityBounds): CityBounds {
    const [west, east] = fittedSpan(bounds.west, bounds.east);
    const [south, north] = fittedSpan(bounds.south, bounds.north);
    return { west, south, east, north };
}

/** The view a new city starts with: its rectangle's centre, the zoom that fits it in 1024 × 768 px, and the zoom range. */
export interface CityStartView {
    readonly center: { readonly lat: number; readonly lng: number };
    readonly zoom: number;
    readonly minZoom: number;
    readonly maxZoom: number;
}

const FIT_VIEWPORT_PX = { width: 1024, height: 768 } as const;
const TILE_PX = 512;
const CITY_MAX_ZOOM = 20;

/** Web Mercator's y of a latitude, in radians of the projected plane (the world is 2π tall). */
function mercatorY(lat: number): number {
    return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

/** The start view of `bounds` (`cities.create` writes it; Settings may change it later), zoom in half steps. */
export function startViewForBounds(bounds: CityBounds): CityStartView {
    const zoomX = Math.log2((FIT_VIEWPORT_PX.width * 360) / ((bounds.east - bounds.west) * TILE_PX));
    const zoomY = Math.log2((FIT_VIEWPORT_PX.height * 2 * Math.PI) / ((mercatorY(bounds.north) - mercatorY(bounds.south)) * TILE_PX));
    const zoom = Math.min(CITY_MAX_ZOOM, Math.max(0, Math.floor(Math.min(zoomX, zoomY) * 2) / 2));
    return {
        center: { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 },
        zoom,
        minZoom: Math.max(0, Math.floor(zoom) - 3),
        maxZoom: CITY_MAX_ZOOM,
    };
}

/** The seed colours the New city flow offers (the first is chosen; Settings changes it later with a live preview). */
export const NEW_CITY_SEEDS = ['#8B5E3C', '#3D6B8C', '#4F7A4A', '#8C3D5E', '#6B5B95', '#B5651D'] as const;

/**
 * `cities/{city}.limits` (server-owned, `cities.setLimits` by the project owner): the city's share of the project's
 * monthly Mapbox compute units and of the daily and monthly caps. A city without `limits` (Bucharest, created before
 * M5) is held only by the project's own caps; the project's caps always hold as well.
 */
export const cityLimitsSchema = z.strictObject({
    computeUnitsPerMonth: z.number().min(0).max(1_000_000),
    rasterJobsPerDay: z.number().int().min(0).max(JOBS_PER_DAY),
    aiRequestsPerMonth: z.number().int().min(0).max(AI_MONTHLY_CAP.requests),
    geocodeCellsPerDay: z.number().int().min(0).max(GEOCODE_DAILY_CAP),
    exportsPerDay: z.number().int().min(0).max(EXPORT_LIMITS.perDayMax),
});

export type CityLimits = z.infer<typeof cityLimitsSchema>;

/** What `cities.create` gives a new city: a quarter of the free compute units, a few jobs, drafts and exports a day. */
/**
 * The most a city's share may be: the schema's own maxima. A field left empty for a city without limits saves at its
 * maximum, so setting one limit never imposes the others (the M5 UX review; `docs/LESSONS.md` 256): the project's own
 * caps still hold for every city.
 */
export const MAX_CITY_LIMITS: CityLimits = {
    computeUnitsPerMonth: 1_000_000,
    rasterJobsPerDay: JOBS_PER_DAY,
    aiRequestsPerMonth: AI_MONTHLY_CAP.requests,
    geocodeCellsPerDay: GEOCODE_DAILY_CAP,
    exportsPerDay: EXPORT_LIMITS.perDayMax,
};

export const DEFAULT_NEW_CITY_LIMITS: CityLimits = {
    computeUnitsPerMonth: MAPBOX_FREE_COMPUTE_UNITS / 4,
    rasterJobsPerDay: 3,
    aiRequestsPerMonth: 100,
    geocodeCellsPerDay: 100,
    exportsPerDay: EXPORT_LIMITS.perDayDefault,
};

const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/**
 * `cities/{city}/usage/{YYYY-MM}`: the city's month-to-date counters beside the project's (`usage/mapbox-YYYY-MM`,
 * `usage/ai-YYYY-MM`), written in the same transactions, so a city never spends past its share.
 */
export const cityUsageDocSchema = z.strictObject({
    month: z.string().regex(MONTH_PATTERN),
    computeUnits: z.number().min(0),
    /** Compute units held by this city's publishes under way (by layer version), as the project's document holds them. */
    reservations: z
        .record(idSchema, z.strictObject({ computeUnits: z.number().min(0), at: timestampSchema }))
        .refine((held) => Object.keys(held).length <= 50, coded('validation.tooBig'))
        .optional(),
    aiRequests: z.number().int().min(0),
    /** The UTC day `geocodeToday` counts (`assist.suggestTitle`'s cells queued for this city). */
    geocodeDay: isoDateSchema.optional(),
    geocodeToday: z.number().int().min(0).optional(),
    ...stamp,
});

export type CityUsageDoc = z.infer<typeof cityUsageDocSchema>;

type CityUsageCounters = Pick<CityUsageDoc, 'computeUnits' | 'reservations'>;

/** Compute units spent and held by the city's other publishes this month. */
function spentAndHeld(usage: CityUsageCounters, versionId: string): number {
    const held = Object.entries(usage.reservations ?? {})
        .filter(([id]) => id !== versionId)
        .reduce((sum, [, reservation]) => sum + reservation.computeUnits, 0);
    return usage.computeUnits + held;
}

/**
 * Compute units this city may still spend this month before this version (whose own reservation is not counted twice);
 * `Infinity` for a city without `limits`.
 */
export function cityComputeUnitsAvailable(
    limits: Pick<CityLimits, 'computeUnitsPerMonth'> | undefined,
    usage: CityUsageCounters | undefined,
    versionId: string,
): number {
    if (limits === undefined) {
        return Number.POSITIVE_INFINITY;
    }
    return limits.computeUnitsPerMonth - (usage === undefined ? 0 : spentAndHeld(usage, versionId));
}

/** The admin's address of a city's page: `#/c/<city>/<route>` (the router's city prefix; §1.5 of the contract). */
export const ADMIN_CITY_SEGMENT = 'c';

const ADMIN_ROUTE_PATH = /^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64}){0,2}$/;

/**
 * The link a notification or a screen gives to `route` (`imagery/version/v1`) of `cityId`; the inbox items keep
 * `ADMIN_LINK_PATTERN`. Throws a `RangeError` for an id or a route the router would refuse (a programming error).
 */
export function adminCityLink(cityId: string, route: string): string {
    if (!CITY_ID_PATTERN.test(cityId) || !ADMIN_ROUTE_PATH.test(route)) {
        throw new RangeError(`not an admin city link: ${JSON.stringify([cityId, route])}`);
    }
    return `#/${ADMIN_CITY_SEGMENT}/${cityId}/${route}`;
}
