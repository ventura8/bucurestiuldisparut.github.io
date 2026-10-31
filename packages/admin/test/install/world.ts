// The installer's test world (docs/research/M6-interfaces.md §1.10): the fake upstreams of @hcm/test-support (Cloud
// Build, Cloud Logging, Cloud Functions, Cloud Run, Artifact Registry, IAM) behind the admin's own origin, which serves
// the install bundle's manifest and the site's `release.json`, and the Cloud Build installer over both.
import { createLogger } from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';
import { createUpstreamFakes, GOOGLE_TOKENS, jsonResponse, type UpstreamFakes } from '@hcm/test-support/fakes';

import { createIamClient } from '../../src/google/iam.js';
import { createGoogleTransport } from '../../src/google/transport.js';
import { bundleOnce, hostingOrigins, loadInstallBundle, sha256Hex } from '../../src/install/bundle.js';
import { createCloudBuildInstaller } from '../../src/install/cloud-build-installer.js';
import type { InstallerPort } from '../../src/install/ports.js';

export const RELEASE = '1.0.0+abc1234';
const ORIGIN = 'https://demo-hcm.web.app';
const BASE = `${ORIGIN}/admin/`;
const NODE_IMAGE = `node:24-bookworm-slim@sha256:${'d'.repeat(64)}`;
const DOCKER_IMAGE = `gcr.io/cloud-builders/docker@sha256:${'e'.repeat(64)}`;
export const ACCESS = { token: GOOGLE_TOKENS.owner };

/** A manifest of the admin's own release (with the docker builder pinned unless `changes` says otherwise). */
export function installManifest(changes: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    const file = (name: string, char: string) => ({ name, bytes: 10, sha256: char.repeat(64) });
    return {
        format: 1,
        release: RELEASE,
        slug: '1-0-0-abc1234',
        projectId: 'demo-hcm',
        files: { server: file('server.tgz', 'a'), pipeline: file('pipeline.tgz', 'b'), site: file('hosting.tgz', 'c') },
        functions: ['admin-session'],
        tools: { firebaseTools: '15.33.0', node: NODE_IMAGE, docker: DOCKER_IMAGE },
        estimates: { server: { buildMinutes: 85 }, pipeline: { buildMinutes: 20 }, site: { buildMinutes: 5 } },
        ...changes,
    };
}

export interface InstallWorld {
    readonly fakes: UpstreamFakes;
    readonly installer: InstallerPort;
    readonly sink: RecordingSink;
    /** What the admin's origin serves: the manifest (null: none) and `/release.json` (null: none). */
    manifest: Record<string, unknown> | null;
    release: Record<string, unknown> | null;
    /** Whether the first city has a published manifest. */
    published: boolean;
}

function ownOrigin(world: InstallWorld, url: URL): Response {
    if (url.pathname.endsWith('/manifest.json')) {
        return world.manifest === null ? new Response('missing', { status: 404 }) : jsonResponse(world.manifest);
    }
    if (url.pathname === '/release.json') {
        return world.release === null ? new Response('missing', { status: 404 }) : jsonResponse(world.release);
    }
    return new Response('missing', { status: 404 });
}

/** A fresh world: a provisioned project on Blaze whose installer account and repository exist, unless told otherwise. */
export async function installWorld(options: { readonly provisioned?: boolean } = {}): Promise<InstallWorld> {
    const fakes = createUpstreamFakes();
    fakes.scenario('google.provisioned');
    const sink = createRecordingSink();
    const log = createLogger('test', { sink: sink.sink, minLevel: 'debug' });
    const world: InstallWorld = {
        fakes,
        installer: undefined as unknown as InstallerPort,
        sink,
        manifest: installManifest(),
        release: null,
        published: true,
    };
    const fetcher: typeof fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        return url.origin === ORIGIN ? Promise.resolve(ownOrigin(world, url)) : fakes.fetch(input, init);
    };
    const bundle = bundleOnce(() =>
        loadInstallBundle({
            fetch: fetcher,
            baseUrl: BASE,
            release: RELEASE,
            projectId: 'demo-hcm',
            origins: hostingOrigins('demo-hcm'),
            digest: sha256Hex,
        }),
    );
    const installer = createCloudBuildInstaller({
        ...{ fetch: fetcher, sleep: () => Promise.resolve(), log, projectId: 'demo-hcm', region: 'us-central1', bundle },
        origin: ORIGIN,
        hasPublishedMap: () => Promise.resolve(world.published),
    });
    if (options.provisioned !== false) {
        fakes.scenario('artifact-registry.provisioned');
        // Prepare the project's `service-accounts` item makes the installer's account (CR-M6-2): through IAM's own API here.
        const iam = createIamClient(
            createGoogleTransport({ fetch: fakes.fetch, token: () => ACCESS.token, sleep: () => Promise.resolve(), log }),
        );
        await iam.createServiceAccount('demo-hcm', 'hcm-installer', 'Cloud Build: the in-app installer');
    }
    return Object.assign(world, { installer });
}
