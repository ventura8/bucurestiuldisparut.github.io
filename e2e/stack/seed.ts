import { createLogger, opsGuardDocSchema, PROVISION_ITEMS, setupStatusDocSchema } from '@hcm/shared';
import { request, type APIRequestContext } from '@playwright/test';

import { projectCity, type CityWorld } from '../admin/support/content.js';
import { EmulatorWorld, type SignedInAccount } from '../admin/support/emulators.js';
import { PERSONAS } from '../admin/world.js';
import { E2E_TOKEN, MOCK_API_ORIGIN } from '../fixtures/world.js';
import { editPlace, firestoreShape, seedCategories, seedCity, seedLayers, seedPhotos, seedPlaces } from './seed-content.js';
import { StackImagery, type ImagerySeed } from './seed-imagery.js';

/**
 * The local stack's world (docs/SETUP.md → *Local stack for manual testing*), written into the emulators and the fake
 * upstreams once they answer. Two profiles (`HCM_STACK_SEED`):
 *
 * - `city` (the default): the project as the owner left it after Setup and a season of editing. `owner@e2e.test` claimed
 *   the map; `admin@e2e.test` joined as an admin; `editor@e2e.test` has a pending invitation; `stranger@e2e.test` is
 *   nobody. Setup's required steps are green (`setup/status`, and the fake Google, Mapbox and USGS in the same state: the
 *   project provisioned and deployed, M2M downloads approved, Analytics linked, two crash groups), the budget guard is
 *   green, and the city `bucharest` has its content (seed-content.ts) and its imagery (seed-imagery.ts).
 * - `fresh`: nothing but the fake's one open billing account: a new map, its admin in start-up mode, for the Setup
 *   Assistant from the first sign-in.
 *
 * Every account is a test persona of e2e/admin/world.ts; the Google sign-in is the consent stand-in of the mock APIs.
 */

const log = createLogger('dev-stack-seed');

export type SeedProfile = 'city' | 'fresh';

/** When the map was claimed and set up (fixed: never the wall clock). */
const SETUP_AT = new Date('2026-10-01T09:00:00.000Z');
const JOINED_AT = new Date('2026-10-02T09:00:00.000Z');
const INVITE_DAYS = 14;

/** The fake upstreams' state of a set-up project (the shared partition `''`, which the browser and the server reach). */
const CITY_SCENARIOS = [
    'google.provisioned',
    'google.deployed',
    'imagery.ready',
    'usgs.m2mApproved',
    'mapbox.upgraded',
    'firebase-management.analyticsLinked',
    'monitoring.crashAlertsProvisioned',
    'error-reporting.twoGroups',
];
const FRESH_SCENARIOS = ['cloud-billing.accountOpen'];

const BUDGET_ID = 'billingAccounts/0E2E00-0E2E00-0E2E01/budgets/0e2e0000-0000-4000-8000-000000000001';

/** Every scenario of `names` the fake upstreams know, applied to the shared partition; an unknown one is logged. */
async function applyScenarios(api: APIRequestContext, names: readonly string[]): Promise<void> {
    const known = (await (await api.get(`${MOCK_API_ORIGIN}/__upstream/scenarios`)).json()) as string[];
    // The shared partition starts again (its setup runs anew: the runner, the synthetic scenes), and so does the runner.
    await api.post(`${MOCK_API_ORIGIN}/__upstream/reset?test=`);
    await api.post(`${MOCK_API_ORIGIN}/__imagery/reset`);
    for (const name of names) {
        if (!known.includes(name)) {
            log.warn('the fake upstreams have no such scenario', { name });
            continue;
        }
        const response = await api.post(`${MOCK_API_ORIGIN}/__upstream/scenario?test=`, { data: { name } });
        if (!response.ok()) {
            throw new Error(`scenario ${name}: ${String(response.status())} ${await response.text()}`);
        }
    }
}

/** `setup/status` with the required steps green, as Setup and its checks leave it (validated first). */
async function seedSetupStatus(emulators: EmulatorWorld, owner: SignedInAccount): Promise<void> {
    const ok = { state: 'ok', checkedAt: SETUP_AT };
    const status = {
        billing: { ...ok, budgetId: BUDGET_ID, budgetAmount: 5, currency: 'USD' },
        provision: { ...ok, items: PROVISION_ITEMS.map((id) => ({ id, ...ok })) },
        mapbox: { ...ok, user: 'e2e-mapbox', scopes: ['tilesets:write', 'tilesets:read'], adminToken: E2E_TOKEN },
        usgs: { ...ok, role: 'download' },
        updatedBy: owner.uid,
        updatedAt: SETUP_AT,
    };
    const guard = { state: 'green', updatedBy: 'system:ops', updatedAt: SETUP_AT };
    setupStatusDocSchema.parse(firestoreShape(status));
    opsGuardDocSchema.parse(firestoreShape(guard));
    await emulators.setDocument('setup/status', status);
    await emulators.setDocument('ops/guard', guard);
}

/** The owner's claim, an admin who joined and a pending invitation; the owner signed in again (its token has the claim). */
async function seedAdmins(emulators: EmulatorWorld): Promise<SignedInAccount> {
    const owner = await emulators.signIn('owner');
    await emulators.claimFor(owner, SETUP_AT);
    await emulators.addAdmin(await emulators.signIn('admin'), owner, JOINED_AT);
    const now = Date.now();
    await emulators.invite(PERSONAS.editor.email, owner, new Date(now), new Date(now + INVITE_DAYS * 24 * 3600 * 1000));
    return emulators.signIn('owner');
}

async function seedContent(world: CityWorld, api: APIRequestContext): Promise<void> {
    await seedCity(world);
    await seedCategories(world);
    await seedPhotos(world, api);
    await seedPlaces(world);
    await seedLayers(world);
    await editPlace(world);
}

/** The imagery through the real flows; a failure is logged and the stack comes up without it. */
async function seedImagery(api: APIRequestContext, world: CityWorld, owner: SignedInAccount): Promise<ImagerySeed | null> {
    const imagery = new StackImagery(api, world, owner);
    try {
        await imagery.harvest();
        return await imagery.imports();
    } catch (error: unknown) {
        log.error('the imagery seed failed; the rest of the city is seeded', { error: String(error) });
        return null;
    }
}

export interface StackSeed {
    /** Resolves when the work the seed left running (the background publish) is over; at once when there is none. */
    readonly settled: Promise<void>;
    /** Closes the seed's request context. */
    close(): Promise<void>;
}

/** Empties the emulators and the fake upstreams, then writes `profile`'s world. */
export async function seedStack(profile: SeedProfile): Promise<StackSeed> {
    const api = await request.newContext();
    const emulators = new EmulatorWorld(api);
    await emulators.reset();
    if (profile === 'fresh') {
        await applyScenarios(api, FRESH_SCENARIOS);
        log.info('fresh profile: a new map, Setup from the first sign-in');
        return { settled: Promise.resolve(), close: () => api.dispose() };
    }
    await applyScenarios(api, CITY_SCENARIOS);
    const owner = await seedAdmins(emulators);
    await seedSetupStatus(emulators, owner);
    const world = projectCity(emulators, owner.uid);
    await seedContent(world, api);
    log.info('city seeded: photos, places, categories, layers, admins, Setup green');
    const imagery = await seedImagery(api, world, owner);
    return { settled: imagery?.published ?? Promise.resolve(), close: () => api.dispose() };
}
