/**
 * The Setup Assistant composed for the shell (CR-M2b-15): setup-ui's module (`../setup/module.ts`) over google-clients'
 * Cloud port (`createSetupCloud`) and legacy import (`createLegacyImport` with admin-shell's `legacyPhotoStore`), the
 * project of `/project.json` and `setup.createCity` with the bundled city (CR-M2b-1). Without a project file (a build
 * whose page does not serve one) there is no Setup Assistant: the page says it is not available.
 */
import type { Logger } from '@hcm/shared';

import type { FirebasePorts } from '../firebase/ports.js';
import { bundleUrl } from '../import/bundle.js';
import { legacyCityFields, type LegacyCityFields } from '../import/city.js';
import { createLegacyImport } from '../import/legacy-import.js';
import type { ProjectConfig } from '../provision/project-config.js';
import { createSetupCloud } from '../provision/setup-cloud.js';
import { createSetupModule, type SetupModule, type SetupModuleOptions } from '../setup/module.js';
import type { FirebaseWebConfig } from './config.js';
import { legacyPhotoStore } from './legacy-photos.js';
import type { Clock } from './ports.js';

/** The city of this repository, when a project names none (its schema requires one). */
const DEFAULT_CITY = 'bucharest';

export interface SetupWiringDeps {
    readonly config: FirebaseWebConfig;
    readonly project: ProjectConfig;
    readonly firebase: FirebasePorts;
    readonly fetch: typeof fetch;
    readonly clock: Clock;
    readonly log: Logger;
    /** The admin's absolute base URL, where `legacy/<city>/` is served. */
    readonly baseUrl: string;
    /** A fresh upload file name stem (`crypto.randomUUID()`). */
    readonly nonce: () => string;
}

/** The bundled city as `setup.createCity` takes it; a missing or invalid file fails the step. */
async function bundledCity(deps: SetupWiringDeps, cityId: string): Promise<LegacyCityFields> {
    const response = await deps.fetch(bundleUrl(deps.baseUrl, cityId, 'city.json'), { cache: 'no-store' });
    const city = response.ok ? legacyCityFields(await response.json()) : undefined;
    if (city === undefined) {
        throw new Error(`the bundled city of ${cityId} is missing or invalid`);
    }
    return city;
}

/** The signed-in admin and the clock, as the Cloud port and the import read them. */
export interface WiringHelpers {
    readonly uid: () => string | null;
    readonly ownerEmail: () => string | null;
    readonly sleep: (ms: number) => Promise<void>;
}

export function wiringHelpers(firebase: Pick<FirebasePorts, 'auth'>, clock: Clock): WiringHelpers {
    return {
        uid: () => firebase.auth.currentUser()?.uid ?? null,
        ownerEmail: () => firebase.auth.currentUser()?.email ?? null,
        sleep: (ms) =>
            new Promise((resolve) => {
                clock.setTimeout(resolve, ms);
            }),
    };
}

/** setup-ui's module options over google-clients' ports and the shell's. */
export function setupOptionsFor(deps: SetupWiringDeps): SetupModuleOptions {
    const { config, project, firebase, log } = deps;
    const cityId = project.cities[0] ?? DEFAULT_CITY;
    const { uid, ownerEmail, sleep } = wiringHelpers(firebase, deps.clock);
    const cloud = createSetupCloud({
        ...{ fetch: deps.fetch, sleep, log: log.child('cloud'), project, ownerEmail },
        web: { projectId: config.projectId, appId: config.appId, apiKey: config.apiKey },
    });
    const store = legacyPhotoStore(firebase, uid);
    const importer = createLegacyImport({
        fetch: deps.fetch,
        store,
        cityId,
        baseUrl: deps.baseUrl,
        uid,
        nonce: deps.nonce,
        sleep,
        log: log.child('import'),
    });
    const createCity = async (): Promise<{ readonly created: boolean }> =>
        firebase.callables.call('setup.createCity', { cityId, city: await bundledCity(deps, cityId) });
    return { cloud, importer, createCity, cityId, cityBBox: null };
}

export function setupModuleFor(deps: SetupWiringDeps): SetupModule {
    return createSetupModule(setupOptionsFor(deps));
}
