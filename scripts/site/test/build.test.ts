import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseManifestJson } from '@hcm/shared';

import { buildSite, type SiteBuildOptions } from '../src/build.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { subresourceIntegrity } from '../src/sri.js';
import { readRepositoryJson } from './manifests.js';
import { ROOT, cleanup, htmlValidateMessages, repositoryWithTemporaryDist, temporaryDir } from './support.js';

const TOKEN = 'pk.e2e-fake-token';
const ENGINE_FILES = ['engine.css', 'engine.iife.js', 'engine.mjs', 'fonts/symbols.woff2'];

function fakeEngine(files: SiteFileSystem, dir: string): void {
    for (const name of ENGINE_FILES) {
        files.write(`${dir}/${name}`, `/* ${name} */\n`);
    }
}

/** A complete site in a temporary root: the starter kit's inputs, small media, a fake engine and Mapbox GL. */
function syntheticRoot(): { root: string; files: SiteFileSystem; options: SiteBuildOptions } {
    const root = temporaryDir();
    const files = nodeFileSystem(root);
    const repository = nodeFileSystem(ROOT);
    for (const name of ['site.json', 'config.js', 'site.css', 'data/manifest.json']) {
        files.write(`starter-kit/${name}`, repository.readText(`starter-kit/${name}`));
    }
    for (const id of ['mihai-voda-1978', 'realitatea-ilustrata-1934-6-1']) {
        files.write(`seed/bucharest/derived/${id}/web.webp`, `web ${id}`);
        files.write(`seed/bucharest/derived/${id}/thumb.webp`, `thumb ${id}`);
    }
    fakeEngine(files, 'packages/engine/dist');
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.js', 'mapbox js');
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.css', 'mapbox css');
    return { root, files, options: { siteDir: 'starter-kit', outDir: 'dist/site/starter-kit', token: TOKEN } };
}

afterEach(cleanup);

describe('buildSite (the committed sites)', () => {
    it('happyPath_buildsBucharestFromItsCommittedInputs', async () => {
        const { files, dist } = repositoryWithTemporaryDist();
        fakeEngine(files, 'dist/engine');

        const report = buildSite(
            { siteDir: 'sites/bucharest', outDir: 'dist/site/bucharest', token: TOKEN, engineDir: 'dist/engine' },
            files,
        );

        const seed = readRepositoryJson('seed/bucharest/manifest.static.json');
        const photoCount = (seed['photos'] as unknown[]).length;
        expect(report).toEqual({
            outDir: 'dist/site/bucharest',
            cityId: 'bucuresti',
            photos: photoCount,
            files: 4 + photoCount * 2 + ENGINE_FILES.length,
        });
        const out = dist.listFiles('dist/site/bucharest');
        expect(out).toEqual(
            expect.arrayContaining(['index.html', 'config.js', 'site.css', 'data/manifest.json', 'engine/fonts/symbols.woff2']),
        );
        expect(await htmlValidateMessages(dist.readText('dist/site/bucharest/index.html'))).toEqual([]);
        expect(dist.readText('dist/site/bucharest/config.js')).toBe(readFileSync(join(ROOT, 'sites/bucharest/config.js'), 'utf8'));
        const served = parseManifestJson(dist.readText('dist/site/bucharest/data/manifest.json'));
        expect(served.ok).toBe(true);
        const photo = served.ok ? served.value.photos[0] : undefined;
        expect(served.ok && served.value.city.mapbox.publicToken).toBe(TOKEN);
        expect(dist.readBytes(`dist/site/bucharest/data/${String(photo?.image.web)}`)).toEqual(
            readFileSync(join(ROOT, 'seed/bucharest/derived', String(photo?.id), 'web.webp')),
        );
    });

    it('happyPath_pinsTheIntegrityOfThePinnedMapboxRelease', () => {
        const { files, dist } = repositoryWithTemporaryDist();
        fakeEngine(files, 'dist/engine');

        buildSite({ siteDir: 'starter-kit', outDir: 'dist/site/starter-kit', token: TOKEN, engineDir: 'dist/engine' }, files);

        const html = dist.readText('dist/site/starter-kit/index.html');
        for (const file of ['mapbox-gl.js', 'mapbox-gl.css']) {
            expect(html).toContain(`integrity="${subresourceIntegrity(readFileSync(join(ROOT, 'node_modules/mapbox-gl/dist', file)))}"`);
        }
        expect(html).toContain('<title>Orașul meu</title>');
    });

    it('happyPath_aGivenManifestReplacesTheSiteOneAndShapesTheCsp', () => {
        const { files, dist } = repositoryWithTemporaryDist();
        fakeEngine(files, 'dist/engine');
        const seed = readRepositoryJson('seed/bucharest/manifest.static.json');
        const city = { ...(seed['city'] as Record<string, unknown>), analytics: { errorEndpoint: 'https://telemetry.e2e.test/report' } };

        buildSite(
            {
                siteDir: 'sites/bucharest',
                outDir: 'dist/e2e/bucharest',
                token: TOKEN,
                engineDir: 'dist/engine',
                manifest: { ...seed, city },
            },
            files,
        );

        expect(dist.readText('dist/e2e/bucharest/index.html')).toMatch(/connect-src [^;]* https:\/\/telemetry\.e2e\.test;/);
        expect(dist.readText('dist/e2e/bucharest/data/manifest.json')).toContain('"errorEndpoint":"https://telemetry.e2e.test/report"');
    });
});

describe('buildSite (bad inputs)', () => {
    it('happyPath_aSyntheticSiteBuilds', () => {
        const { files, options } = syntheticRoot();

        expect(buildSite(options, files).files).toBe(4 + 4 + ENGINE_FILES.length);
        expect(files.readText('dist/site/starter-kit/data/media/mihai-voda-1978/thumb.webp')).toBe('thumb mihai-voda-1978');
    });

    it.each(['.', 'dist', 'dist/', 'dist/.', 'dist/../outside', 'dist/a/../..', 'build/site', '/srv/site', 'dist/a b'])(
        'badPath_refusesTheOutputFolder %s',
        (outDir) => {
            const { files, options } = syntheticRoot();
            files.write('keep.txt', 'kept');

            expect(() => buildSite({ ...options, outDir }, files)).toThrow('the output folder must be below dist/');
            expect(files.readText('keep.txt')).toBe('kept');
        },
    );

    it('badPath_withoutTheEngineBuildThePreviousOutputStays', () => {
        const { files, options } = syntheticRoot();
        files.write('dist/site/starter-kit/previous.txt', 'previous');
        files.remove('packages/engine/dist');
        files.write('packages/engine/dist/engine.css', '');

        expect(() => buildSite(options, files)).toThrow('packages/engine/dist/engine.mjs is missing: build the engine first');
        expect(files.readText('dist/site/starter-kit/previous.txt')).toBe('previous');
    });

    it('badPath_aMissingPhotoFileIsNamed', () => {
        const { files, options } = syntheticRoot();
        files.remove('seed/bucharest/derived/realitatea-ilustrata-1934-6-1');

        expect(() => buildSite(options, files)).toThrow(
            'seed/bucharest/derived/realitatea-ilustrata-1934-6-1/web.webp is missing: a photo derivative of starter-kit/data/manifest.json',
        );
    });

    it('badPath_aConfigForAnotherCityIsRefused', () => {
        const { files, options } = syntheticRoot();
        files.write(
            'starter-kit/config.js',
            "globalThis.HistoricCityMapConfig = { cityId: 'bucuresti', manifestUrl: './data/manifest.json' };",
        );

        expect(() => buildSite(options, files)).toThrow(
            'starter-kit/config.js: cityId "bucuresti" does not match the manifest\'s city "exemplu"',
        );
    });

    it('badPath_anUnreadableManifestIsReported', () => {
        const { files, options } = syntheticRoot();
        files.write('starter-kit/data/manifest.json', '{ not json');

        expect(() => buildSite(options, files)).toThrow(/^starter-kit\/data\/manifest\.json: cannot read the manifest/);
    });

    it('badPath_aMissingStylesheetIsReported', () => {
        const { files, options } = syntheticRoot();
        files.remove('starter-kit');
        const repository = nodeFileSystem(ROOT);
        for (const name of ['site.json', 'config.js', 'data/manifest.json']) {
            files.write(`starter-kit/${name}`, repository.readText(`starter-kit/${name}`));
        }

        expect(() => buildSite(options, files)).toThrow('starter-kit/site.css is missing');
    });

    it('badPath_withoutMapboxGlThereIsNoIntegrity', () => {
        const { files, options } = syntheticRoot();

        expect(() => buildSite({ ...options, mapboxGlDir: 'vendor/none' }, files)).toThrow(
            'vendor/none/mapbox-gl.js is missing: install the dependencies',
        );
    });
});
