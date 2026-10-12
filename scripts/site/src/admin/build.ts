import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { DEFAULT_SEED_DIR, LEGACY_FOLDER, planLegacyBundle, type AdminFile } from './legacy.js';
import { ADMIN_SCRIPT_FILE, ADMIN_STYLESHEET_FILE, renderAdminPage } from './page.js';
import { DEFAULT_PROJECT_FILE, planProjectFile } from './project.js';

/**
 * Completes the admin's Hosting folder after its Vite build (docs/research/M2b-interfaces.md §4, admin-e2e):
 *
 * ```text
 * <outDir>/admin.iife.js, admin.css, …   the Vite build (production, or the `e2e` mode for the admin tier), required
 * <outDir>/index.html                    generated (page.ts)
 * <outDir>/project.json                  the committed infra/project.json, checked (project.ts, CR-M2b-26)
 * <outDir>/fonts/…                       the kit's self-hosted fonts and their licences (packages/ui/fonts), which the
 *                                        admin loads from `fonts/` next to the page, as the engine's site pages do
 * <outDir>/legacy/bucharest/…            the legacy import bundle (legacy.ts)
 * ```
 *
 * Every input is read and validated before anything is written, and only `index.html`, `project.json`, `fonts/` and
 * `legacy/` are replaced: the Vite output stays. The production folder is `packages/admin/dist` (`firebase.json` → `hosting.public`); a test
 * writes below `dist/`.
 */

export const DEFAULT_ADMIN_DIR = 'packages/admin/dist';

/** The kit's self-hosted fonts (`packages/ui/fonts`, built by its `fonts:build`). */
export const DEFAULT_FONTS_DIR = 'packages/ui/fonts';

/** Where the page finds them. */
export const FONTS_FOLDER = 'fonts';

export interface AdminBuildOptions {
    /** The admin's Hosting folder: `packages/admin/dist`, or a folder below `dist/`. */
    readonly outDir: string;
    /** The Bucharest seed of the legacy import; default `seed/bucharest`. */
    readonly seedDir?: string;
    /** The kit's fonts; default `packages/ui/fonts`. */
    readonly fontsDir?: string;
    /** The project the admin provisions; default `infra/project.json`. */
    readonly projectFile?: string;
}

export interface AdminBuildReport {
    readonly outDir: string;
    readonly projectId: string;
    readonly photos: number;
    readonly originals: number;
    readonly warnings: number;
    readonly fonts: number;
    readonly files: number;
}

/** A folder name: letters, digits, `_`, `.`, `-`, but never `.` or `..` themselves. */
const SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;

function isAdminOutputDir(path: string): boolean {
    const [first, ...rest] = path.split('/');
    return path === DEFAULT_ADMIN_DIR || (first === 'dist' && rest.length > 0 && rest.every((segment) => SEGMENT.test(segment)));
}

function requireBundle(files: SiteFileSystem, outDir: string): void {
    for (const name of [ADMIN_SCRIPT_FILE, ADMIN_STYLESHEET_FILE]) {
        if (!files.isFile(`${outDir}/${name}`)) {
            throw new SiteBuildError(`${outDir}/${name} is missing: build the admin first (npm run build --workspace @hcm/admin)`);
        }
    }
}

/** The fonts and their licences, every `.woff2` and `LICENSES.md` of `fontsDir`. */
function fontFiles(files: SiteFileSystem, fontsDir: string): AdminFile[] {
    const names = files.isFile(`${fontsDir}/LICENSES.md`) ? files.listFiles(fontsDir) : [];
    const fonts = names.filter((name) => name.endsWith('.woff2'));
    if (fonts.length === 0) {
        throw new SiteBuildError(
            `${fontsDir} holds no font and licence: the admin loads the kit's fonts (npm run fonts:build --workspace @hcm/ui)`,
        );
    }
    return [...fonts, 'LICENSES.md'].map((name) => ({ from: `${fontsDir}/${name}`, to: `${FONTS_FOLDER}/${name}` }));
}

function write(files: SiteFileSystem, outDir: string, file: AdminFile): void {
    const target = `${outDir}/${file.to}`;
    if ('content' in file) {
        files.write(target, file.content);
    } else {
        files.copy(file.from, target);
    }
}

/** Writes the page and the legacy bundle into `options.outDir`; throws SiteBuildError (writing nothing) on a bad input. */
export function buildAdminSite(options: AdminBuildOptions, files: SiteFileSystem): AdminBuildReport {
    const { outDir } = options;
    if (!isAdminOutputDir(outDir)) {
        throw new SiteBuildError(`the admin's output folder is ${DEFAULT_ADMIN_DIR} or a folder below dist/, got "${outDir}"`);
    }
    requireBundle(files, outDir);
    const fonts = fontFiles(files, options.fontsDir ?? DEFAULT_FONTS_DIR);
    const legacy = planLegacyBundle(files, options.seedDir ?? DEFAULT_SEED_DIR);
    const project = planProjectFile(files, options.projectFile ?? DEFAULT_PROJECT_FILE);
    const planned: AdminFile[] = [{ to: 'index.html', content: renderAdminPage() }, project.file, ...fonts, ...legacy.files];
    files.remove(`${outDir}/${FONTS_FOLDER}`);
    files.remove(`${outDir}/${LEGACY_FOLDER}`);
    for (const file of planned) {
        write(files, outDir, file);
    }
    const counts = { photos: legacy.photos, originals: legacy.originals, warnings: legacy.warnings, fonts: fonts.length - 1 };
    return { outDir, projectId: project.projectId, ...counts, files: planned.length };
}
