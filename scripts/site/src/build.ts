import { readConfigJs } from './config-js.js';
import { contentSecurityPolicy } from './csp.js';
import { SiteBuildError } from './errors.js';
import type { SiteFileSystem } from './files.js';
import { prepareManifest } from './manifest.js';
import { manifestOrigins } from './origins.js';
import { ENGINE_FOLDER, ENGINE_MODULE_FILE, ENGINE_STYLESHEET_FILE, renderSitePage } from './page.js';
import { parseSiteSpec } from './site-spec.js';
import { subresourceIntegrity } from './sri.js';

/**
 * Assembles one static city site (PLAN → M1: the Bucharest site on GitHub Pages, the starter kit):
 *
 * ```text
 * <outDir>/index.html          generated (page.ts), with the meta CSP of this site's manifest and configuration
 * <outDir>/config.js           the site's own, validated
 * <outDir>/site.css            the site's own
 * <outDir>/data/manifest.json  the source manifest, photos moved to data/media/, the build's Mapbox token, the city
 *                              renamed to config.js's when the source names the site's `legacyCityId`
 * <outDir>/data/media/<id>/…   the photo derivatives
 * <outDir>/engine/…            packages/engine/dist (engine.mjs, engine.iife.js, engine.css, source maps)
 * ```
 *
 * Every input is read and validated before `outDir` is replaced, so a failed build leaves the previous one alone.
 */

export interface SiteBuildOptions {
    /** The site's folder (`sites/bucharest`, `starter-kit`): `site.json`, `config.js`, `site.css`. */
    readonly siteDir: string;
    /** The output folder, below `dist/` (it is deleted and rewritten). */
    readonly outDir: string;
    /** The Mapbox public token (`pk.…`) written into the served manifest. */
    readonly token: string;
    /** The engine build; default `packages/engine/dist`. */
    readonly engineDir?: string;
    /** The pinned Mapbox GL JS release, for the Subresource Integrity digests; default `node_modules/mapbox-gl/dist`. */
    readonly mapboxGlDir?: string;
    /** A manifest object instead of the one `site.json` names (the e2e fixture manifest). */
    readonly manifest?: unknown;
}

export interface SiteBuildReport {
    readonly outDir: string;
    readonly cityId: string;
    readonly photos: number;
    readonly files: number;
}

const DEFAULT_ENGINE_DIR = 'packages/engine/dist';
const DEFAULT_MAPBOX_GL_DIR = 'node_modules/mapbox-gl/dist';

/** A folder name: letters, digits, `_`, `.`, `-`, but never `.` or `..` themselves. */
const SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;

/** Below `dist/` and nothing else: the folder is deleted before it is written. */
function isOutputDir(path: string): boolean {
    const [first, ...rest] = path.split('/');
    return first === 'dist' && rest.length > 0 && rest.every((segment) => SEGMENT.test(segment));
}

/** One output file, relative to `outDir`: generated text, or a copy of a repository file. */
type PlannedFile = { readonly to: string; readonly content: string } | { readonly to: string; readonly from: string };

function readJson(files: SiteFileSystem, path: string): unknown {
    try {
        return JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: cannot read the manifest: ${String(error)}`);
    }
}

function requireFile(files: SiteFileSystem, path: string, hint: string): string {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`${path} is missing: ${hint}`);
    }
    return path;
}

function engineFiles(files: SiteFileSystem, engineDir: string): PlannedFile[] {
    const hint = 'build the engine first (npm run build --workspace @hcm/engine)';
    requireFile(files, `${engineDir}/${ENGINE_MODULE_FILE}`, hint);
    requireFile(files, `${engineDir}/${ENGINE_STYLESHEET_FILE}`, hint);
    return files.listFiles(engineDir).map((name) => ({ from: `${engineDir}/${name}`, to: `${ENGINE_FOLDER}/${name}` }));
}

function integrity(files: SiteFileSystem, mapboxGlDir: string): { script: string; stylesheet: string } {
    const hint = 'install the dependencies (mapbox-gl is a pinned devDependency of @hcm/e2e)';
    return {
        script: subresourceIntegrity(files.readBytes(requireFile(files, `${mapboxGlDir}/mapbox-gl.js`, hint))),
        stylesheet: subresourceIntegrity(files.readBytes(requireFile(files, `${mapboxGlDir}/mapbox-gl.css`, hint))),
    };
}

/** `value` as a plain object, or null. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

/** The ids of a site whose source manifest names a legacy city (site-spec.ts → `legacyCityId`), or null. */
function cityRename(legacyCityId: string | undefined, configCityId: string | undefined): { from: string; to: string } | null {
    return legacyCityId === undefined || configCityId === undefined ? null : { from: legacyCityId, to: configCityId };
}

/**
 * The source manifest with its city renamed to `config.js`'s when it names the site's `legacyCityId`; anything else is
 * returned as it is, and validated later.
 */
function withSiteCity(source: unknown, rename: { from: string; to: string } | null): unknown {
    const manifest = recordOf(source);
    const city = recordOf(manifest?.['city']);
    if (rename === null || city?.['id'] !== rename.from) {
        return source;
    }
    return { ...manifest, city: { ...city, id: rename.to } };
}

function checkCity(configCityId: string | undefined, manifestCityId: string, siteDir: string): void {
    if (configCityId !== undefined && configCityId !== manifestCityId) {
        throw new SiteBuildError(`${siteDir}/config.js: cityId "${configCityId}" does not match the manifest's city "${manifestCityId}"`);
    }
}

function plan(options: SiteBuildOptions, files: SiteFileSystem): { files: PlannedFile[]; cityId: string; photos: number } {
    const { siteDir, token } = options;
    const specFile = requireFile(files, `${siteDir}/site.json`, 'every site has one (scripts/site/src/site-spec.ts)');
    const spec = parseSiteSpec(files.readText(specFile), specFile);
    const configSource = files.readText(requireFile(files, `${siteDir}/config.js`, 'every site has one (docs/ENGINE_API.md → config.js)'));
    const config = readConfigJs(configSource, `${siteDir}/config.js`);
    const source = withSiteCity(options.manifest ?? readJson(files, spec.manifest), cityRename(spec.legacyCityId, config.cityId));
    const { manifest, media } = prepareManifest(source, token, spec.manifest);
    checkCity(config.cityId, manifest.city.id, siteDir);
    const csp = contentSecurityPolicy(manifestOrigins(manifest, config));
    const page = renderSitePage({ spec, csp, mapboxGlIntegrity: integrity(files, options.mapboxGlDir ?? DEFAULT_MAPBOX_GL_DIR) });
    const photoFiles = media.map((copy) => ({
        from: requireFile(files, `${spec.media}/${copy.from}`, `a photo derivative of ${spec.manifest}`),
        to: `data/${copy.to}`,
    }));
    const planned: PlannedFile[] = [
        { to: 'index.html', content: page },
        { to: 'config.js', content: configSource },
        { to: 'site.css', from: requireFile(files, `${siteDir}/site.css`, 'every site has its page styles') },
        { to: 'data/manifest.json', content: `${JSON.stringify(manifest)}\n` },
        ...photoFiles,
        ...engineFiles(files, options.engineDir ?? DEFAULT_ENGINE_DIR),
    ];
    return { files: planned, cityId: manifest.city.id, photos: manifest.photos.length };
}

function write(files: SiteFileSystem, outDir: string, file: PlannedFile): void {
    const target = `${outDir}/${file.to}`;
    if ('content' in file) {
        files.write(target, file.content);
    } else {
        files.copy(file.from, target);
    }
}

/** Builds the site into `options.outDir`; throws SiteBuildError (and writes nothing) when an input is missing or invalid. */
export function buildSite(options: SiteBuildOptions, files: SiteFileSystem): SiteBuildReport {
    if (!isOutputDir(options.outDir)) {
        throw new SiteBuildError(`the output folder must be below dist/, got "${options.outDir}"`);
    }
    const planned = plan(options, files);
    files.remove(options.outDir);
    for (const file of planned.files) {
        write(files, options.outDir, file);
    }
    return { outDir: options.outDir, cityId: planned.cityId, photos: planned.photos, files: planned.files.length };
}
