/**
 * The install bundle of the e2e world's admin (docs/research/M6-interfaces.md §1.3): the release the admin's
 * `runtime.json` names in the install specs and the local stack, and the bundle's `manifest.json` as the site build
 * writes it (its bytes are what the admin hashes). No build runs a step in the e2e world (the fake Cloud Build plays
 * each build), so the files it names are placeholders of the right shape; no image is pulled.
 */

import { installReleaseSlug } from '@hcm/shared';

/** The admin's release in the install specs and the local stack, and its bundle folder (`installReleaseSlug`). */
export const INSTALL_RELEASE = '1.0.0+e2e0001';
export const INSTALL_SLUG = '1-0-0-e2e0001';

const NODE_IMAGE = `node:24-bookworm-slim@sha256:${'d6'.repeat(32)}`;
/** A digest for the Docker builder: no image is pulled, the fake runs no step (§67e pins the real one). */
const DOCKER_IMAGE = `gcr.io/cloud-builders/docker@sha256:${'e2'.repeat(32)}`;

function file(name: string, char: string): Record<string, unknown> {
    return { name, bytes: 1024, sha256: char.repeat(64) };
}

/**
 * `install/<slug>/manifest.json` of `release` for `projectId`; without the Docker builder (`docker` false) the pipeline
 * is off.
 */
export function installManifestText(projectId: string, docker = true, release = INSTALL_RELEASE): string {
    const manifest = {
        format: 1,
        release,
        slug: installReleaseSlug(release),
        projectId,
        files: { server: file('server.tgz', 'a'), pipeline: file('pipeline.tgz', 'b'), site: file('hosting.tgz', 'c') },
        functions: ['admin-session'],
        tools: { firebaseTools: '15.33.0', node: NODE_IMAGE, docker: docker ? DOCKER_IMAGE : null },
        estimates: { server: { buildMinutes: 85 }, pipeline: { buildMinutes: 20 }, site: { buildMinutes: 5 } },
    };
    return `${JSON.stringify(manifest, null, 4)}\n`;
}
