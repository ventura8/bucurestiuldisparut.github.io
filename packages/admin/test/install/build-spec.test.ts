import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildDefinition, installerServiceAccount, releaseTag, targetTag, type BuildParams } from '../../src/install/build-spec.js';
import { FETCH_BUNDLE_SCRIPT } from '../../src/install/fetch-script.js';

/**
 * The three install builds as the admin submits them (`docs/research/M6-interfaces.md` §1.4), pinned against golden
 * JSON (`golden/<target>.json`; the inline `fetch` program is pinned by `fetch-script.test.ts`, which runs it).
 */

const PARAMS: BuildParams = {
    projectId: 'demo-hcm',
    region: 'us-central1',
    origin: 'https://demo-hcm.web.app',
    basePath: '/admin/',
    release: '1.0.0+abc1234',
    slug: '1-0-0-abc1234',
    manifestSha256: 'a'.repeat(64),
    fileSha256: 'b'.repeat(64),
    images: { node: `node:24-bookworm-slim@sha256:${'d'.repeat(64)}`, docker: `gcr.io/cloud-builders/docker@sha256:${'e'.repeat(64)}` },
};

const TARGETS = ['server', 'pipeline', 'site'] as const;

function golden(target: string): unknown {
    return JSON.parse(readFileSync(new URL(`golden/${target}.json`, import.meta.url), 'utf8')) as unknown;
}

/** The definition with the inline fetch program replaced by its placeholder, as the golden files hold it. */
function comparable(target: (typeof TARGETS)[number]): unknown {
    const definition = buildDefinition(target, PARAMS) as { steps: Record<string, unknown>[] };
    const steps = definition.steps.map((step) => {
        if (step['id'] !== 'fetch') {
            return step;
        }
        expect(step['args']).toEqual(['--input-type=module', '--eval', FETCH_BUNDLE_SCRIPT]);
        return { ...step, args: ['--input-type=module', '--eval', '<FETCH_BUNDLE_SCRIPT>'] };
    });
    return { ...definition, steps };
}

describe('buildDefinition', () => {
    it.each(TARGETS)('happyPath_the %s build is the golden one', (target) => {
        expect(comparable(target)).toEqual(golden(target));
    });

    it('happyPath_everyBuildRunsAsTheInstallerLogsToCloudLoggingAndCarriesItsTags', () => {
        for (const target of TARGETS) {
            const definition = buildDefinition(target, PARAMS);

            expect(definition).toMatchObject({
                serviceAccount: installerServiceAccount('demo-hcm'),
                options: { logging: 'CLOUD_LOGGING_ONLY' },
                tags: ['hcm-install', targetTag(target), releaseTag('1-0-0-abc1234')],
            });
        }
    });

    it('happyPath_everyStepNamesItsImageByDigest', () => {
        const images = TARGETS.flatMap((target) =>
            (buildDefinition(target, PARAMS)['steps'] as { name: string }[]).map((step) => step.name),
        );

        expect(images.every((image) => /@sha256:[0-9a-f]{64}$/.test(image))).toBe(true);
    });

    it('happyPath_theServerDeploysWithForce_theSiteKeepsTheBundleInItsTree', () => {
        const server = JSON.stringify(buildDefinition('server', PARAMS));
        const site = buildDefinition('site', PARAMS)['steps'] as { env?: string[] }[];

        expect(server).toContain('"steps/deploy-with-retry.mjs","--project","$PROJECT_ID","--force"');
        expect(site[0]?.env).toContain('HCM_KEEP_BUNDLE=public${_BASE}install/${_SLUG}');
        expect(site[0]?.env).toContain('HCM_FILES=site,server,pipeline');
    });

    it('badPath_noValueFromTheOwnersTokenOrDataReachesTheBuild', () => {
        const text = JSON.stringify(TARGETS.map((target) => buildDefinition(target, PARAMS)));

        expect(text).not.toMatch(/ya29\.|sk\.|Bearer/);
        expect(FETCH_BUNDLE_SCRIPT).not.toContain('$');
    });
});
