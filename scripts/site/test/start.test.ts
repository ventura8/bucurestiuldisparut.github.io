import { GENERIC_INSTALL_PROJECT, startConfigSchema, startReleaseSchema } from '@hcm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { SiteBuildError } from '../src/errors.js';
import type { SiteFileSystem } from '../src/files.js';
import { buildStartSite, EXIT_INVALID, EXIT_OK, EXIT_USAGE, runStartCli } from '../src/start/build.js';
import { servingConfigOf } from '../src/start/hosting-config.js';
import { renderStartPage, startPagePolicy, takenByStartTree } from '../src/start/tree.js';
import { cleanup, recordingLogger, repositoryWithTemporaryDist } from './support.js';

/**
 * The start site (docs/research/M14-start-your-map.md §5, §6) from the repository's real inputs and a public Hosting tree faked
 * in a temporary `dist/`: the tree names no project, Bucharest stays out, the manifest lists every file with its digest.
 */
const STEPS = new Map([['steps/steps.mjs', new TextEncoder().encode('export {};\n')]]);
const ENV = { HCM_COMMIT: 'a'.repeat(40), SOURCE_DATE_EPOCH: '1700000000', HCM_START_OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com' };
const PROJECT = { projectId: 'bucurestiul-disparut', publicBucket: 'bucurestiul-disparut-public' };
const OPTIONS = {
    publicTree: 'dist/hosting-public',
    appDir: 'dist/start-app',
    outDir: 'dist/start',
    functionsDir: 'dist/functions',
    project: PROJECT,
};

function world(): { readonly files: SiteFileSystem } {
    const { files } = repositoryWithTemporaryDist();
    for (const [path, content] of Object.entries({
        'dist/hosting-public/index.html': '<!doctype html>bucharest',
        'dist/hosting-public/config.js': 'bucharest',
        'dist/hosting-public/data/manifest.json': '{}',
        'dist/hosting-public/city/index.html': '<!doctype html>city',
        'dist/hosting-public/city/config.js': 'https://storage.googleapis.com/bucurestiul-disparut-public/cities/',
        'dist/hosting-public/engine/engine.mjs': 'export {};',
        'dist/hosting-public/404.html': '<!doctype html>404',
        'dist/hosting-public/hosting.css': 'body{}',
        'dist/hosting-public/admin/index.html': '<!doctype html>admin bucurestiul-disparut',
        'dist/hosting-public/admin/admin.mjs': 'export {};',
        'dist/hosting-public/admin/admin.mjs.map': '{}',
        'dist/hosting-public/admin/project.json': '{}',
        'dist/hosting-public/admin/runtime.json': '{}',
        'dist/hosting-public/admin/legacy/bucharest/city.json': '{}',
        'dist/start-app/start.mjs': 'export {};',
        'dist/functions/index.js': 'exports.a = 1;',
        'dist/functions/package.json': '{}',
        'dist/functions/package-lock.json': '{}',
        'dist/functions/.env.bucurestiul-disparut': 'HCM_VIEWER_ORIGINS=https://a.b\nHCM_APP_CHECK=monitor\nHCM_RELEASE=1.0.0+aaaaaaa\n',
    })) {
        files.write(path, content);
    }
    return { files };
}

afterEach(cleanup);

describe('the start site', () => {
    it('happyPath_aReleaseThatNamesNoProject', () => {
        const { files } = world();
        const report = buildStartSite(OPTIONS, { files, env: ENV }, STEPS);
        const config = startConfigSchema.parse(JSON.parse(files.readText('dist/start/start-config.json')));
        expect(config.oauthClientId).toBe(ENV.HCM_START_OAUTH_CLIENT_ID);
        const manifest = startReleaseSchema.parse(JSON.parse(files.readText(`dist/start/release/${config.release}/start-release.json`)));
        expect(report).toEqual({ release: manifest.release, files: manifest.files.length });
        const paths = manifest.files.map((file) => file.path);
        expect(paths).toEqual(
            expect.arrayContaining([
                'index.html',
                'city/index.html',
                'engine/engine.mjs',
                'admin/index.html',
                'admin/runtime.json',
                'release.json',
            ]),
        );
        expect(paths).not.toContain('config.js');
        expect(paths).not.toContain('admin/project.json');
        expect(paths.filter((path) => /(?:legacy|data\/|\.map$)/.test(path))).toEqual([]);
        expect(manifest.files.find((file) => file.path === 'city/config.js')?.template).toBe(true);
        expect(manifest.files.find((file) => file.path === 'hosting.css')?.template).toBeUndefined();
        const tree = (path: string): string => files.readText(`dist/start/release/${config.release}/tree/${path}`);
        expect(tree('city/config.js')).toContain('__HCM_PROJECT_ID__-public');
        expect(tree('admin/runtime.json')).toContain('"startUp": true');
        expect(tree('release.json')).toContain('"variant": "start-up"');
        expect(JSON.stringify(manifest.hosting)).toContain('__HCM_PROJECT_ID__');
        expect(JSON.stringify(manifest.hosting)).not.toContain(PROJECT.projectId);
        const bundle = JSON.parse(tree(`admin/install/${config.release}/manifest.json`)) as { readonly projectId: string };
        expect(bundle.projectId).toBe(GENERIC_INSTALL_PROJECT);
        expect(files.readText('dist/start/start.mjs')).toBe('export {};');
    });

    it('happyPath_withoutAClientThePageIsClosed', () => {
        const { files } = world();
        buildStartSite(OPTIONS, { files, env: { ...ENV, HCM_START_OAUTH_CLIENT_ID: '' } }, STEPS);
        expect(JSON.parse(files.readText('dist/start/start-config.json'))).not.toHaveProperty('oauthClientId');
    });

    it('badPath_aMissingPageBuildIsNamed', () => {
        const { files } = world();
        files.remove('dist/start-app');
        expect(() => buildStartSite(OPTIONS, { files, env: ENV }, STEPS)).toThrow(SiteBuildError);
    });

    it('happyPath_thePageAllowsOnlyItsOwnFilesAndGooglesFiveHosts', () => {
        const policy = startPagePolicy();
        expect(policy).toContain('https://upload-firebasehosting.googleapis.com');
        expect(policy).not.toContain('accounts.google.com');
        expect(renderStartPage()).toContain('<hcm-start-page>');
    });

    it.each([
        ['admin/admin.mjs', true],
        ['admin/legacy/x', false],
        ['admin/install/x', false],
        ['admin/project.json', false],
        ['engine/engine.mjs', true],
        ['data/manifest.json', false],
        ['config.js', false],
        ['hosting.css', true],
        ['admin/a.map', false],
    ])('the tree takes %s: %s', (path, taken) => {
        expect(takenByStartTree(path)).toBe(taken);
    });

    it('happyPath_hostingsRulesBecomeAServingConfig', () => {
        expect(
            servingConfigOf(
                {
                    cleanUrls: true,
                    trailingSlash: false,
                    rewrites: [{ regex: '^/a$', destination: '/b' }],
                    redirects: [{ source: '/c', destination: '/d', type: 302 }, { regex: '^/e$' }],
                    headers: [{ source: '**', headers: [{ key: 'X-Site', value: 'my-project' }] }, { source: '/f' }],
                },
                'my-project',
            ),
        ).toEqual({
            cleanUrls: true,
            trailingSlashBehavior: 'REMOVE',
            rewrites: [{ regex: '^/a$', path: '/b' }],
            redirects: [
                { glob: '/c', location: '/d', statusCode: 302 },
                { regex: '^/e$', location: '', statusCode: 301 },
            ],
            headers: [
                { glob: '**', headers: { 'X-Site': '__HCM_PROJECT_ID__' } },
                { glob: '/f', headers: {} },
            ],
        });
        expect(servingConfigOf({ trailingSlash: true }, 'x')).toMatchObject({ trailingSlashBehavior: 'ADD', rewrites: [] });
        expect(servingConfigOf(undefined, 'x')).toEqual({ rewrites: [], redirects: [], headers: [] });
        expect(() => servingConfigOf({ redirects: [{ source: '/c', type: 200 }] }, 'x')).toThrow(SiteBuildError);
    });

    it('cli_exitStatuses', async () => {
        const { files } = world();
        const { log } = recordingLogger();
        const context = { files, log, env: ENV, steps: () => Promise.resolve(STEPS) };
        expect(await runStartCli(['--bad'], context)).toBe(EXIT_USAGE);
        expect(
            await runStartCli(['--public-tree', OPTIONS.publicTree, '--app', 'dist/none', '--functions', OPTIONS.functionsDir], context),
        ).toBe(EXIT_INVALID);
        expect(
            await runStartCli(['--public-tree', OPTIONS.publicTree, '--app', OPTIONS.appDir, '--functions', OPTIONS.functionsDir], context),
        ).toBe(EXIT_OK);
    });
});
