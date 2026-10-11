/**
 * End-to-end tests of the migration CLI (`scripts/seed/migrate-legacy.mjs`), run as a child process with
 * the same Node the tests run on. They live in the shared package's node project because that is where the
 * migration rules are, and the Vitest projects are fixed by vitest.config.ts (ask-first).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { conePolygon } from '../../src/geo/cone.js';
import { parseManifestJson } from '../../src/schemas/validation.js';
import { validCity } from '../fixtures/manifest.js';
import { greyPng } from '../fixtures/png.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CLI = join(ROOT, 'scripts/seed/migrate-legacy.mjs');
const TIMEOUT = 60_000;

let cityDir = '';
let cityFile = '';

function feature(photo: string, geometry: Record<string, unknown>, properties: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'Feature',
        geometry,
        properties: { title: 'Titlu', photo: `https://legacy.example/photos/${photo}`, author: 'Autor', ...properties },
    };
}

function writeFixture(seedColor = '#8B5E3C'): void {
    mkdirSync(join(cityDir, 'photos'), { recursive: true });
    writeFileSync(join(cityDir, 'photos', 'Wide 1930.png'), greyPng(3000, 10));
    writeFileSync(join(cityDir, 'photos', 'small.png'), greyPng(1, 1));
    writeFileSync(join(cityDir, 'photos', 'unused.png'), greyPng(1, 1));
    const features = [
        feature('Wide 1930.png', { type: 'Point', coordinates: [26.1, 44.43] }),
        feature('Wide 1930.png', {
            type: 'Polygon',
            coordinates: [conePolygon([26.1, 44.43], { bearing: 90, fov: 50, distanceM: 40 }, 1)],
        }),
        feature('small.png', { type: 'Point', coordinates: [26.11, 44.44] }, { source: '<a href="https://www.flickr.com/x/">Flickr</a>' }),
        feature('missing.png', { type: 'Point', coordinates: [26.12, 44.44] }),
    ];
    writeFileSync(join(cityDir, 'photos.legacy.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
    const city = validCity();
    writeFileSync(cityFile, JSON.stringify({ ...city, theme: { seedColor } }));
}

function run(...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [CLI, '--city-dir', cityDir, '--city', cityFile, ...args], { cwd: ROOT, encoding: 'utf8' });
}

beforeEach(() => {
    cityDir = mkdtempSync(join(tmpdir(), 'hcm-migrate-'));
    cityFile = join(cityDir, 'city.json');
});

afterEach(() => {
    rmSync(cityDir, { recursive: true, force: true });
});

describe('scripts/seed/migrate-legacy.mjs', () => {
    it(
        'happyPath_writesAValidManifestAndDerivedImages',
        () => {
            writeFixture();

            const result = run();

            expect(result.status).toBe(0);
            const manifest = parseManifestJson(readFileSync(join(cityDir, 'manifest.static.json'), 'utf8'));
            expect(manifest.ok).toBe(true);
            expect(manifest.ok && manifest.value.photos.map((photo) => [photo.id, photo.image.w, photo.image.h, photo.bearing])).toEqual([
                ['wide-1930', 2048, 7, 90],
                ['small', 1, 1, undefined],
            ]);
            expect(manifest.ok && manifest.value.city.credits[0]?.label.ro).toBe('Fotografii: Autor');
            expect(manifest.ok && manifest.value.city.theme.tokens.light['--md-sys-color-primary']).toMatch(/^#[0-9a-f]{6}$/);
            expect(existsSync(join(cityDir, 'derived/wide-1930/thumb.webp'))).toBe(true);
            expect(result.stderr + result.stdout).toContain('original missing: photo left out');
            expect(result.stdout).toContain('unused.png');
        },
        TIMEOUT,
    );

    it(
        'happyPath_rerunReplacesTheDerivedFolder',
        () => {
            writeFixture();
            mkdirSync(join(cityDir, 'derived/stale'), { recursive: true });

            expect(run().status).toBe(0);
            expect(existsSync(join(cityDir, 'derived/stale'))).toBe(false);
        },
        TIMEOUT,
    );

    it(
        'badPath_overTheBudgetWritesNoManifest',
        () => {
            writeFixture();

            const result = run('--budget-mb', '0.0001');

            expect(result.status).toBe(1);
            expect(result.stderr).toContain('derived images exceed the budget');
            expect(existsSync(join(cityDir, 'manifest.static.json'))).toBe(false);
        },
        TIMEOUT,
    );

    it(
        'badPath_anInvalidThemeSeedFailsValidation',
        () => {
            writeFixture('sepia');

            const result = run();

            expect(result.status).toBe(1);
            expect(result.stderr).toContain('validation.format');
            expect(existsSync(join(cityDir, 'manifest.static.json'))).toBe(false);
        },
        TIMEOUT,
    );

    it.each([[['--budget-mb', 'lots']], [['--budget-mb', '-1']], [['--unknown']]])(
        'badPath_usage_%j',
        (args) => {
            const result = run(...args);

            expect(result.status).toBe(2);
            expect(result.stderr).toContain('usage: migrate-legacy.mjs');
        },
        TIMEOUT,
    );
});
