// Legacy migration of a city (PLAN → M1): the 2015–2022 photo data of seed/<city>/ to a static City
// Manifest v1 plus web-ready images. The rules live in packages/shared/src/migration/ (pure, unit-tested);
// this file reads and writes files and runs sharp. It never changes the legacy originals: it reads
// photos.legacy.geojson and photos/, and (re)writes only derived/ and manifest.static.json.
//
//     node scripts/seed/migrate-legacy.mjs [--city-dir seed/bucharest] [--city scripts/seed/bucharest.city.json] [--budget-mb 15]
//
// Run it with Node 24 in the quality image (docs/research/M1-interfaces.md → Legacy migration).
// derived/<id>/web.webp has at most 2048 px on its long edge, thumb.webp 400 px, both without metadata
// (sharp strips EXIF, XMP and ICC by default and converts to sRGB). Exit status: 0 written, 1 the
// manifest is invalid or the images exceed the budget, 2 usage.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import sharp from 'sharp';

// Run the TypeScript sources directly (Node strips the types): their relative imports say `.js`
// (bundler style) and the colour library's ESM files omit extensions, so a failed relative resolve is
// retried with `.ts`, then with `.js` appended.
registerHooks({
    resolve(specifier, context, nextResolve) {
        try {
            return nextResolve(specifier, context);
        } catch (error) {
            if (!specifier.startsWith('.')) {
                throw error;
            }
            return nextResolve(specifier.endsWith('.js') ? `${specifier.slice(0, -3)}.ts` : `${specifier}.js`, context);
        }
    },
});

const shared = await import('../../packages/shared/src/index.ts');
const { themeFromSeed } = await import('../../packages/ui/src/theme/dynamic-color.ts');

const log = shared.createLogger('migrate-legacy');

const WEB_EDGE = 2048;
const THUMB_EDGE = 400;
const DERIVED = 'derived';

function usage(reason) {
    log.error('usage: migrate-legacy.mjs [--city-dir <dir>] [--city <city.json>] [--budget-mb <n>]', { reason });
    process.exitCode = 2;
    return null;
}

function readOptions(argv) {
    try {
        const { values } = parseArgs({
            args: argv,
            options: {
                'city-dir': { type: 'string', default: 'seed/bucharest' },
                city: { type: 'string', default: 'scripts/seed/bucharest.city.json' },
                'budget-mb': { type: 'string', default: '15' },
            },
            strict: true,
        });
        const budget = Number(values['budget-mb']);
        return Number.isFinite(budget) && budget > 0
            ? { cityDir: values['city-dir'], cityFile: values.city, budgetBytes: budget * 1_000_000 }
            : usage(`--budget-mb must be a positive number, got ${values['budget-mb']}`);
    } catch (error) {
        return usage(String(error));
    }
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function isFile(path) {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

/** web.webp and thumb.webp of one original; returns the manifest image and the bytes written. */
async function derive(source, cityDir, id) {
    const directory = join(cityDir, DERIVED, id);
    await mkdir(directory, { recursive: true });
    const original = sharp(source, { failOn: 'error' }).autoOrient();
    const fit = (edge) => ({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
    const web = await original.clone().resize(fit(WEB_EDGE)).webp({ quality: 80, effort: 6 }).toFile(join(directory, 'web.webp'));
    const thumb = await original.clone().resize(fit(THUMB_EDGE)).webp({ quality: 72, effort: 6 }).toFile(join(directory, 'thumb.webp'));
    const image = { web: `${DERIVED}/${id}/web.webp`, thumb: `${DERIVED}/${id}/thumb.webp`, w: web.width, h: web.height };
    return { image, bytes: web.size + thumb.size };
}

/** Derives every photo whose original exists; returns the images by photo id and the total size. */
async function deriveAll(photos, cityDir) {
    await rm(join(cityDir, DERIVED), { recursive: true, force: true });
    const images = new Map();
    let bytes = 0;
    for (const { photo, sourceFile } of photos) {
        const source = join(cityDir, 'photos', sourceFile);
        if (isFile(source)) {
            const derived = await derive(source, cityDir, photo.id);
            images.set(photo.id, derived.image);
            bytes += derived.bytes;
        } else {
            log.warn('original missing: photo left out', { id: photo.id, sourceFile });
        }
    }
    return { images, bytes };
}

function reportUnused(cityDir, photos) {
    const used = new Set(photos.map((migrated) => migrated.sourceFile));
    const unused = readdirSync(join(cityDir, 'photos')).filter((name) => !used.has(name));
    if (unused.length > 0) {
        log.info('originals no legacy feature refers to (not migrated)', { files: unused.toSorted() });
    }
}

function reportIssues(issues) {
    for (const issue of issues) {
        log.error('manifest invalid', { path: issue.path, code: issue.code, message: shared.translate('en', issue.code) });
    }
}

async function main(options) {
    const migration = shared.migrateLegacyPhotos(readJson(join(options.cityDir, 'photos.legacy.geojson')));
    for (const warning of migration.warnings) {
        log.warn(warning.message, { feature: warning.feature });
    }
    reportUnused(options.cityDir, migration.photos);
    const { images, bytes } = await deriveAll(migration.photos, options.cityDir);
    const city = readJson(options.cityFile);
    const seedColor = String(city.theme?.seedColor);
    const rest = Object.fromEntries(Object.entries(city).filter(([key]) => key !== 'theme'));
    const result = shared.buildStaticManifest({ city: rest, theme: { seedColor, tokens: themeFromSeed(seedColor) }, photos: migration.photos, images });
    if (!result.ok) {
        reportIssues(result.issues);
        return 1;
    }
    if (bytes > options.budgetBytes) {
        log.error('derived images exceed the budget', { bytes, budgetBytes: options.budgetBytes });
        return 1;
    }
    writeFileSync(join(options.cityDir, 'manifest.static.json'), `${JSON.stringify(result.value, null, 4)}\n`, 'utf8');
    log.info('manifest written', { photos: result.value.photos.length, cones: migration.cones, derivedMb: Number((bytes / 1_000_000).toFixed(2)) });
    return 0;
}

const options = readOptions(process.argv.slice(2));
if (options !== null) {
    process.exitCode = await main(options);
}
