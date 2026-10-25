/**
 * The `cities.*` callables (fn-cities, `docs/research/M5-interfaces.md` §1.6, §1.8): the integrator's
 * `functions/src/index.ts` exports `cities = citiesFunctions(getDeps)`, which Firebase deploys as `cities-create`,
 * `cities-locate` (New city finds the named city on OpenStreetMap: the M5 UX review) and `cities-setLimits`. All are the
 * project owner's.
 */
import type { CallableDeps } from '../api/callable.js';
import { createFunction, type CreateDeps } from './create.js';
import { locateFunction, type LocateDeps } from './locate.js';
import { setLimitsFunction, type SetLimitsDeps } from './set-limits.js';

export type CitiesFamilyDeps = CallableDeps & CreateDeps & LocateDeps & SetLimitsDeps;

/** `cities.create`, `cities.locate`, `cities.setLimits`. */
export function citiesFunctions(getDeps: () => CitiesFamilyDeps) {
    return { create: createFunction(getDeps), locate: locateFunction(getDeps), setLimits: setLimitsFunction(getDeps) };
}
