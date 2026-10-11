import type { Logger } from '@hcm/shared';

import type { AdminDirectory } from './admin-directory.js';
import type { Clock } from './clock.js';
import type { CloudRunJobs } from './cloud-run-jobs.js';
import type { MapboxApi } from './mapbox-api.js';
import type { SecretStore } from './secret-store.js';
import type { SetupRecords } from './setup-records.js';
import type { UsgsApi } from './usgs-api.js';

/**
 * Every outside dependency of the handlers. A handler declares the ports it uses with
 * `Pick<Ports, ...>`; tests pass fakes, deps.ts (the composition root) passes the adapters.
 */
export interface Ports {
    readonly log: Logger;
    readonly clock: Clock;
    readonly secrets: SecretStore;
    readonly admins: AdminDirectory;
    readonly setup: SetupRecords;
    readonly jobs: CloudRunJobs;
    readonly mapbox: MapboxApi;
    readonly usgs: UsgsApi;
}
