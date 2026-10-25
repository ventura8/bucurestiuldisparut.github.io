import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SITES, EXIT_INVALID, EXIT_OK, EXIT_USAGE, PLACEHOLDER_TOKEN, runCli } from '../src/cli.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { ROOT, cleanup, recordingLogger, temporaryDir } from './support.js';

const ENTRY = join(ROOT, 'scripts/site/build-site.ts');
const HOOK = join(ROOT, 'scripts/site/register-ts.mjs');

/** Both default sites in a temporary root: the starter kit's inputs twice, small media, a fake engine and Mapbox GL. */
function syntheticRepository(): { root: string; files: SiteFileSystem } {
    const root = temporaryDir();
    const files = nodeFileSystem(root);
    const repository = nodeFileSystem(ROOT);
    for (const site of DEFAULT_SITES) {
        for (const name of ['site.json', 'config.js', 'site.css']) {
            files.write(`${site}/${name}`, repository.readText(`starter-kit/${name}`));
        }
    }
    files.write('starter-kit/data/manifest.json', repository.readText('starter-kit/data/manifest.json'));
    for (const id of ['mihai-voda-1978', 'realitatea-ilustrata-1934-6-1']) {
        files.write(`seed/bucharest/derived/${id}/web.webp`, 'web');
        files.write(`seed/bucharest/derived/${id}/thumb.webp`, 'thumb');
    }
    for (const name of ['engine.mjs', 'engine.css']) {
        files.write(`packages/engine/dist/${name}`, name);
    }
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.js', 'js');
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.css', 'css');
    return { root, files };
}

afterEach(cleanup);

describe('runCli', () => {
    it('happyPath_buildsEveryDefaultSiteWithTheTokenFromTheEnvironment', () => {
        const { files } = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runCli([], { env: { MAPBOX_PUBLIC_TOKEN: 'pk.from-env' }, files, log })).toBe(EXIT_OK);

        expect(files.readText('dist/site/bucharest/data/manifest.json')).toContain('"publicToken":"pk.from-env"');
        expect(files.isFile('dist/site/starter-kit/index.html')).toBe(true);
        expect(records.map((record) => `${record.level} ${record.message} ${String(record.data?.['outDir'])}`)).toEqual([
            'info HCM_PUBLIC_BUCKET is not set: every site bundles its manifest (the seed snapshot) undefined',
            'info site built dist/site/bucharest',
            'info site built dist/site/starter-kit',
        ]);
        expect(JSON.stringify(records)).not.toContain('pk.from-env');
    });

    it('happyPath_withoutATokenThePlaceholderIsUsedAndSaidSo', () => {
        const { files } = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runCli(['--site', 'starter-kit', '--out', 'dist/e2e'], { env: { MAPBOX_PUBLIC_TOKEN: '' }, files, log })).toBe(EXIT_OK);

        expect(files.readText('dist/e2e/starter-kit/data/manifest.json')).toContain(`"publicToken":"${PLACEHOLDER_TOKEN}"`);
        expect(records[0]?.level).toBe('warn');
        expect(records[0]?.message).toContain('MAPBOX_PUBLIC_TOKEN is not set');
    });

    it('happyPath_theBucketFromTheEnvironmentReachesTheSitesThatReadIt', () => {
        const { files } = syntheticRepository();
        const spec = JSON.parse(files.readText('sites/bucharest/site.json')) as Record<string, unknown>;
        files.write('sites/bucharest/site.json', JSON.stringify({ ...spec, publicManifest: true }));
        files.write('infra/project.json', JSON.stringify({ projectId: 'exemplu-proiect', region: 'europe-west1' }));
        const { log, records } = recordingLogger();

        expect(runCli([], { env: { MAPBOX_PUBLIC_TOKEN: 'pk.x', HCM_PUBLIC_BUCKET: 'exemplu-proiect-public' }, files, log })).toBe(EXIT_OK);

        expect(files.readText('dist/site/bucharest/config.js')).toContain(
            '"manifestUrl":"https://storage.googleapis.com/exemplu-proiect-public/cities/exemplu/manifest.json"',
        );
        expect(files.isFile('dist/site/bucharest/data/manifest.json')).toBe(false);
        expect(files.isFile('dist/site/starter-kit/data/manifest.json')).toBe(true);
        expect(records[0]).toMatchObject({
            message: 'the sites that read the public bucket use its manifest',
            data: { bucket: 'exemplu-proiect-public' },
        });
    });

    it('badPath_anInputProblemExitsWithOne', () => {
        const { files } = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runCli(['--site', 'sites/nowhere'], { env: {}, files, log })).toBe(EXIT_INVALID);
        expect(records.at(-1)?.level).toBe('error');
        expect(records.at(-1)?.message).toContain('sites/nowhere/site.json is missing');
    });

    it('badPath_anUnknownOptionExitsWithTwo', () => {
        const { files } = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runCli(['--token', 'pk.x'], { env: {}, files, log })).toBe(EXIT_USAGE);
        expect(records[0]?.level).toBe('error');
        expect(records[0]?.message).toContain('usage: build-site.ts');
    });

    it('badPath_aBugIsNotSwallowed', () => {
        const { files } = syntheticRepository();
        const broken: SiteFileSystem = {
            ...files,
            write: () => {
                throw new Error('disk full');
            },
        };

        expect(() => runCli([], { env: {}, files: broken, log: recordingLogger().log })).toThrow('disk full');
    });
});

describe('build-site.ts (the Node entry)', () => {
    it('happyPath_runsUnderNodeWithTheTypeScriptHook', () => {
        const { root, files } = syntheticRepository();

        const result = spawnSync(process.execPath, ['--import', HOOK, ENTRY, '--site', 'starter-kit'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, MAPBOX_PUBLIC_TOKEN: 'pk.child' },
        });

        // On a failure the diff shows the whole result, stderr included.
        expect(result).toMatchObject({ status: EXIT_OK });
        expect(files.readText('dist/site/starter-kit/data/manifest.json')).toContain('"publicToken":"pk.child"');
    });

    it('badPath_usageErrorsExitWithTwo', () => {
        const result = spawnSync(process.execPath, ['--import', HOOK, ENTRY, '--bogus'], { cwd: temporaryDir(), encoding: 'utf8' });

        expect(result.status).toBe(EXIT_USAGE);
        expect(result.stderr).toContain('usage: build-site.ts');
    });
});
