// The admin app must satisfy the structural ports its elements read (`docs/research/M2b-interfaces.md` §1.7): a change
// on either side that breaks the other fails `tsc` here, the Setup Assistant's state and intents (setup-ui's
// `SetupViewState`, `SetupIntentsPort`) included. The runtime assertions only keep the file a test.
import type { AdminAppPort, AdminPageElement } from '@hcm/ui/admin';
import { describe, expect, it } from 'vitest';

import { ADMIN_AUTH_STATES } from '../../src/auth/auth-state.js';
import type { AdminApp } from '../../src/app/mount.js';
import { ADMIN_ROUTES } from '../../src/routing/routes.js';
import type { SetupModule } from '../../src/setup/module.js';
import type { SetupState } from '../../src/setup/state.js';

type Assignable<Source, Target> = [Source] extends [Target] ? true : false;

/** The app as the entry mounts it: setup-ui's module (`createSetupModule`), or none. */
type EntryApp = AdminApp<SetupState | null, ReturnType<SetupModule['create']> | null>;

const APP_SATISFIES_PORT: Assignable<EntryApp, AdminAppPort> = true;
const MISSING_CONFIG_APP_SATISFIES_PORT: Assignable<AdminApp<null, null>, AdminAppPort> = true;
const STATES_MIRRORED: Assignable<(typeof ADMIN_AUTH_STATES)[number], AdminAppPort['state']['auth']> = true;
const ROUTES_MIRRORED: Assignable<(typeof ADMIN_ROUTES)[number], AdminAppPort['state']['route']['id']> = true;
const PAGE_GETS_THE_APP: Assignable<EntryApp, NonNullable<AdminPageElement['app']>> = true;

describe('the admin ports', () => {
    it('happyPath_theAppAndItsStateSatisfyTheElementsPorts', () => {
        expect([APP_SATISFIES_PORT, MISSING_CONFIG_APP_SATISFIES_PORT, STATES_MIRRORED, ROUTES_MIRRORED, PAGE_GETS_THE_APP]).toEqual([
            true,
            true,
            true,
            true,
            true,
        ]);
        expect(ADMIN_AUTH_STATES).toHaveLength(13);
        expect(ADMIN_ROUTES).toHaveLength(9);
    });
});
