/**
 * The installer's Cloud Build adapter (`docs/research/M6-interfaces.md` §1.7, §1.10): each call builds its clients
 * around the access token it is given (memory only, never kept), as the Setup Assistant's Cloud port does. It reads
 * what is installed (the functions' `HCM_RELEASE`, the jobs' release label, the site's `/release.json`), the target's
 * newest build by tag, and why a build cannot be submitted (the installer's account, the bundle, the repository, the
 * docker builder's digest, a map to show); it submits the build of the admin's own bundle.
 */
import {
    CLOUD_RUN_JOBS,
    compareRelease,
    INSTALLER_ACCOUNT,
    PIPELINE_REPOSITORY,
    RELEASE_PATTERN,
    releaseOfSlug,
    type InstallTarget,
    type Logger,
} from '@hcm/shared';

import { createArtifactRegistryClient } from '../google/artifact-registry.js';
import { cloudBuildConsoleUrl, createCloudBuildClient, type CloudBuild } from '../google/cloud-build.js';
import { createFunctionsClient, deploymentStatus, type DeployedFunction } from '../google/functions.js';
import { createIamClient, serviceAccountEmail } from '../google/iam.js';
import { at, stringAt } from '../google/json.js';
import { createLoggingClient } from '../google/logging.js';
import { createRunJobsClient } from '../google/run-jobs.js';
import { createGoogleTransport, type GoogleTransport } from '../google/transport.js';
import { buildDefinition, targetTag } from './build-spec.js';
import { InstallBundleError, type InstallBundle } from './bundle.js';
import type { InstalledInfo, InstallMessage } from './model.js';
import type { InstallAccess, InstallerPort, ServerProgress, TargetObservation } from './ports.js';

export interface CloudBuildInstallerDeps {
    readonly fetch: typeof fetch;
    readonly sleep: (ms: number) => Promise<void>;
    readonly log: Logger;
    readonly projectId: string;
    readonly region: string;
    /** The admin's own bundle (read once it is found; `bundle.ts`). */
    readonly bundle: () => Promise<InstallBundle>;
    /** The admin's own origin: the site's `/release.json` is there. */
    readonly origin: string;
    /** The project's first city has a published manifest: Publish the map has something to show. */
    readonly hasPublishedMap: () => Promise<boolean>;
}

const NOT_INSTALLED: InstalledInfo = { complete: false, release: null, partial: false, newest: null };

/** The oldest of `releases` (a missing one makes the whole unknown: an update replaces it). */
function oldestRelease(releases: readonly (string | null)[]): string | null {
    if (releases.length === 0 || releases.includes(null)) {
        return null;
    }
    return (releases as readonly string[]).reduce((oldest, release) => (compareRelease(release, oldest) < 0 ? release : oldest));
}

/** The newest release any part names (parts naming none ignored), or null. */
function newestRelease(releases: readonly (string | null)[]): string | null {
    return releases.reduce<string | null>(
        (newest, release) => (release !== null && (newest === null || compareRelease(release, newest) > 0) ? release : newest),
        null,
    );
}

/**
 * What is installed of a target made of `parts` (null: a part not there): complete with its oldest release, or partial,
 * and in every case the newest release a part names, so a newer server missing a function is still never replaced.
 */
function installedOf(parts: readonly ({ readonly release: string | null } | null)[], complete: boolean): InstalledInfo {
    const present = parts.filter((part): part is { readonly release: string | null } => part !== null);
    const releases = present.map((part) => part.release);
    const newest = newestRelease(releases);
    if (complete) {
        return { complete, release: oldestRelease(releases), partial: false, newest };
    }
    return { complete, release: null, partial: present.length > 0, newest };
}

function serverInstalled(functions: readonly DeployedFunction[]): { installed: InstalledInfo; progress: ServerProgress } {
    const status = deploymentStatus(functions);
    const progress = { ready: status.ready, total: status.total, failed: status.failed };
    return { installed: installedOf(functions, status.state === 'ok'), progress };
}

/** What `/release.json` says of the public site (`{release, variant}`); a start-up root or no file is not installed. */
function siteInstalled(body: unknown): InstalledInfo {
    const release = stringAt(body, 'release');
    return at(body, 'variant') === 'public' && release !== undefined && RELEASE_PATTERN.test(release)
        ? { complete: true, release, partial: false, newest: release }
        : NOT_INSTALLED;
}

class CloudBuildInstaller implements InstallerPort {
    readonly #deps: CloudBuildInstallerDeps;
    /** The installer's account was seen once: it is not looked for again. */
    #accountSeen = false;

    constructor(deps: CloudBuildInstallerDeps) {
        this.#deps = deps;
    }

    async observe(target: InstallTarget, access: InstallAccess): Promise<TargetObservation> {
        const transport = this.#transport(access);
        const [installed, build, blocker] = await Promise.all([
            this.#installed(target, transport),
            this.#newestBuild(target, transport),
            this.#blocker(target, transport),
        ]);
        return { ...installed, build, blocker };
    }

    async submit(target: InstallTarget, access: InstallAccess): Promise<CloudBuild> {
        const bundle = await this.#deps.bundle();
        const { manifest } = bundle;
        if (target === 'pipeline' && manifest.tools.docker === null) {
            throw new InstallBundleError('apiError.install.notAvailable');
        }
        const definition = buildDefinition(target, {
            projectId: this.#deps.projectId,
            region: this.#deps.region,
            origin: bundle.origin,
            basePath: bundle.basePath,
            release: manifest.release,
            slug: manifest.slug,
            manifestSha256: bundle.sha256,
            fileSha256: manifest.files[target].sha256,
            images: { node: manifest.tools.node, docker: manifest.tools.docker ?? '' },
        });
        this.#deps.log.info('install build submitted', { target, release: manifest.release });
        return createCloudBuildClient(this.#transport(access)).create(this.#deps.projectId, this.#deps.region, definition);
    }

    buildLog(buildId: string, access: InstallAccess): ReturnType<InstallerPort['buildLog']> {
        return createLoggingClient(this.#transport(access)).buildLines(this.#deps.projectId, buildId);
    }

    consoleUrl(buildId: string): string {
        return cloudBuildConsoleUrl(this.#deps.projectId, this.#deps.region, buildId);
    }

    #transport(access: InstallAccess): GoogleTransport {
        return createGoogleTransport({ fetch: this.#deps.fetch, token: () => access.token, sleep: this.#deps.sleep, log: this.#deps.log });
    }

    async #installed(target: InstallTarget, transport: GoogleTransport): Promise<Pick<TargetObservation, 'installed' | 'progress'>> {
        const { projectId, region } = this.#deps;
        if (target === 'server') {
            return serverInstalled(await createFunctionsClient(transport).list(projectId, region));
        }
        if (target === 'pipeline') {
            const jobs = createRunJobsClient(transport);
            const found = await Promise.all(Object.values(CLOUD_RUN_JOBS).map((job) => jobs.get(projectId, region, job)));
            const parts = found.map((job) => (job === undefined ? null : { release: releaseOfSlug(job.releaseSlug) }));
            return {
                installed: installedOf(
                    parts,
                    parts.every((part) => part !== null),
                ),
                progress: null,
            };
        }
        return { installed: siteInstalled(await this.#releaseFile()), progress: null };
    }

    /** The site's `/release.json` (no token: the admin's own origin), or undefined without one. */
    async #releaseFile(): Promise<unknown> {
        try {
            const response = await this.#deps.fetch(new URL('/release.json', this.#deps.origin), { cache: 'no-store' });
            return response.ok ? ((await response.json()) as unknown) : undefined;
        } catch {
            return undefined;
        }
    }

    async #newestBuild(target: InstallTarget, transport: GoogleTransport): Promise<CloudBuild | null> {
        const [newest] = await createCloudBuildClient(transport).listByTag(this.#deps.projectId, this.#deps.region, targetTag(target), 1);
        return newest ?? null;
    }

    async #blocker(target: InstallTarget, transport: GoogleTransport): Promise<InstallMessage | null> {
        if (!(await this.#accountExists(transport))) {
            return {
                key: 'apiError.install.notProvisioned',
                params: { account: serviceAccountEmail(INSTALLER_ACCOUNT, this.#deps.projectId) },
            };
        }
        let bundle: InstallBundle;
        try {
            bundle = await this.#deps.bundle();
        } catch (error) {
            return { key: error instanceof InstallBundleError ? error.code : 'apiError.unavailable' };
        }
        return this.#targetBlocker(target, transport, bundle);
    }

    async #targetBlocker(target: InstallTarget, transport: GoogleTransport, bundle: InstallBundle): Promise<InstallMessage | null> {
        if (target === 'pipeline') {
            return this.#pipelineBlocker(transport, bundle);
        }
        return this.localBlocker(target);
    }

    async localBlocker(target: InstallTarget): Promise<InstallMessage | null> {
        return target === 'site' && !(await this.#deps.hasPublishedMap()) ? { key: 'apiError.install.nothingToShow' } : null;
    }

    async #pipelineBlocker(transport: GoogleTransport, bundle: InstallBundle): Promise<InstallMessage | null> {
        if (bundle.manifest.tools.docker === null) {
            return { key: 'apiError.install.notAvailable' };
        }
        const repository = await createArtifactRegistryClient(transport).get(this.#deps.projectId, this.#deps.region, PIPELINE_REPOSITORY);
        return repository === undefined ? { key: 'apiError.install.noRepository', params: { repository: PIPELINE_REPOSITORY } } : null;
    }

    async #accountExists(transport: GoogleTransport): Promise<boolean> {
        if (!this.#accountSeen) {
            this.#accountSeen = (await createIamClient(transport).listServiceAccounts(this.#deps.projectId)).includes(INSTALLER_ACCOUNT);
        }
        return this.#accountSeen;
    }
}

/** The installer over Google's REST APIs. */
export function createCloudBuildInstaller(deps: CloudBuildInstallerDeps): InstallerPort {
    return new CloudBuildInstaller(deps);
}
