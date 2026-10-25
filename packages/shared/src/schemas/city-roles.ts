/**
 * Who belongs to which city (M5; `docs/research/M5-interfaces.md` §1.2): the roles of `admins/{uid}.cities` and of an
 * invitation's `cities`. Kept apart from `cities.ts` so the document schemas of `firestore-ops.ts` can use it: `cities.ts`
 * imports the imagery API, which imports `firestore-ops.ts`, and a module cycle would read a schema before it exists.
 */
import { z } from 'zod';

import { cityIdSchema } from './paths.js';
import { coded } from './primitives.js';

/** A city admin's role: `owner` (its admins, its export, everything an editor does) or `editor` (its content). */
export const CITY_ROLES = ['owner', 'editor'] as const;

export type CityRole = (typeof CITY_ROLES)[number];

/** At most this many cities in one project (the Mapbox account's 24-tileset cap is shared by all of them). */
export const MAX_CITIES = 20;

/** `admins/{uid}.cities`: the cities an admin belongs to, each with its role. */
export const cityRolesSchema = z
    .record(cityIdSchema, z.enum(CITY_ROLES))
    .refine((roles) => Object.keys(roles).length <= MAX_CITIES, coded('validation.tooBig'));

export type CityRoles = Readonly<Record<string, CityRole>>;
