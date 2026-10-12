import { migrateLegacyPhotos, validateManifest, type City, type MigratedPhoto } from '@hcm/shared';

import { SiteBuildError, issuesText } from '../errors.js';
import type { SiteFileSystem } from '../files.js';

/**
 * The legacy Bucharest bundle the admin build ships for the Setup Assistant's import step (docs/research/M2b-interfaces.md
 * §3.3 h, `DECISIONS-for-review.md` §23d), below the admin's `dist/`:
 *
 * ```text
 * legacy/bucharest/city.json              the seed manifest's city, without its Mapbox token and analytics ids
 *                                         (the fields `setup.createCity` takes, CR-M2b-1)
 * legacy/bucharest/photos.json            migrateLegacyPhotos(photos.legacy.geojson): [{sourceFile, legacyId?, photo}]
 * legacy/bucharest/originals/<sourceFile> each original a record names, once (the import uploads them; photos.onUpload
 *                                         makes the public derivatives, so nothing is upscaled)
 * ```
 *
 * Hosting serves the files; the admin fetches them only during an import.
 */

/** Where the bundle lives below the admin's output folder. */
export const LEGACY_FOLDER = 'legacy/bucharest';

/** The seed it is made from. */
export const DEFAULT_SEED_DIR = 'seed/bucharest';

/** One output file, relative to the admin's output folder: generated text, or a copy of a repository file. */
export type AdminFile = { readonly to: string; readonly content: string } | { readonly to: string; readonly from: string };

export interface LegacyBundle {
    readonly files: readonly AdminFile[];
    readonly photos: number;
    readonly originals: number;
    /** What the migration could not map one to one (a cone without its photo point, say); informational. */
    readonly warnings: number;
}

/**
 * The manifest city as `setup.createCity` takes it (the fields a client may not create, CR-M2b-1): an allowlist, so the
 * viewer's public token and the analytics ids, which are not the seed's to give, never travel.
 */
type LegacyCity = Pick<
    City,
    'id' | 'name' | 'center' | 'zoom' | 'minZoom' | 'maxZoom' | 'bounds' | 'about' | 'credits' | 'privacy' | 'theme' | 'basemap'
>;

function cityFields(city: City): LegacyCity {
    const { id, name, center, zoom, minZoom, maxZoom, bounds, about, credits, privacy, theme, basemap } = city;
    return { id, name, center, zoom, minZoom, maxZoom, bounds, about, credits, privacy, theme, basemap };
}

function readJson(files: SiteFileSystem, path: string): unknown {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`${path} is missing: the legacy import bundles the committed Bucharest seed`);
    }
    try {
        return JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: not JSON: ${String(error)}`);
    }
}

function legacyCity(files: SiteFileSystem, seedDir: string): LegacyCity {
    const path = `${seedDir}/manifest.static.json`;
    const result = validateManifest(readJson(files, path));
    if (!result.ok) {
        throw new SiteBuildError(`${path}: invalid manifest\n${issuesText(result.issues)}`);
    }
    return cityFields(result.value.city);
}

function originals(files: SiteFileSystem, seedDir: string, photos: readonly MigratedPhoto[]): AdminFile[] {
    const names = [...new Set(photos.map((record) => record.sourceFile))];
    return names.map((name) => {
        const from = `${seedDir}/photos/${name}`;
        if (!files.isFile(from)) {
            throw new SiteBuildError(`${from} is missing: a legacy photo record names it`);
        }
        return { from, to: `${LEGACY_FOLDER}/originals/${name}` };
    });
}

/** The bundle's files, read and validated from `seedDir`; throws SiteBuildError when an input is missing or invalid. */
export function planLegacyBundle(files: SiteFileSystem, seedDir = DEFAULT_SEED_DIR): LegacyBundle {
    const city = legacyCity(files, seedDir);
    const migration = migrateLegacyPhotos(readJson(files, `${seedDir}/photos.legacy.geojson`));
    if (migration.photos.length === 0) {
        throw new SiteBuildError(`${seedDir}/photos.legacy.geojson holds no photo`);
    }
    const copies = originals(files, seedDir, migration.photos);
    return {
        files: [
            { to: `${LEGACY_FOLDER}/city.json`, content: `${JSON.stringify(city)}\n` },
            { to: `${LEGACY_FOLDER}/photos.json`, content: `${JSON.stringify(migration.photos)}\n` },
            ...copies,
        ],
        photos: migration.photos.length,
        originals: copies.length,
        warnings: migration.warnings.length,
    };
}
