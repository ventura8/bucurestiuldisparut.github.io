/**
 * Engine releases on jsDelivr (M5; `docs/research/M5-interfaces.md` §2): a tag `vX.Y.Z` of this repository carries the
 * built engine in `cdn/engine/` (the files of `packages/engine/dist` without source maps), which jsDelivr serves at
 * `https://cdn.jsdelivr.net/gh/<owner>/<repo>@vX.Y.Z/cdn/engine/<file>`. The same folder holds `release.json`: the
 * version, the base address and the Subresource Integrity (`sha384-…`) of every file, which the GitHub Release
 * attaches and the starter kit's page pins. A page that pins the engine with integrity names an exact version: a
 * range such as `@1` can change under it, so it is offered only without integrity.
 */
import { z } from 'zod';

import { parseVersion } from './compat.js';
import { coded, httpsUrlSchema, versionSchema } from './primitives.js';

/** The repository whose tags jsDelivr serves the engine from. */
export const ENGINE_REPOSITORY = 'ventura8/bucurestiuldisparut.github.io';

/** The folder of a tag that holds the released engine (committed by the release, rebuilt identically by CI). */
export const ENGINE_CDN_FOLDER = 'cdn/engine';

/** jsDelivr's GitHub route. */
export const JSDELIVR_GH = 'https://cdn.jsdelivr.net/gh/';

/** The release file inside `ENGINE_CDN_FOLDER`. */
export const ENGINE_RELEASE_FILE = 'release.json';

/** The two files a page loads with integrity: the IIFE build (it carries the lazy chunks inline) and the stylesheet. */
export const ENGINE_PAGE_FILES = { script: 'engine.iife.js', stylesheet: 'engine.css' } as const;

/** `vMAJOR.MINOR.PATCH`, no pre-release or build suffix (`docs/releases/README.md`). */
export const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** A SHA-384 Subresource Integrity value: `sha384-` and 64 base64 characters. */
export const SRI_PATTERN = /^sha384-[A-Za-z0-9+/]{64}$/;

const REPOSITORY_PATTERN = /^[A-Za-z0-9-]{1,39}\/[\w.-]{1,100}$/;
const RELEASE_PATH_PATTERN = /^[A-Za-z0-9_-][\w.-]*(?:\/[A-Za-z0-9_-][\w.-]*)*$/;

function releaseParts(version: string): readonly [number, number, number] {
    const parts = parseVersion(version);
    if (parts === null) {
        throw new RangeError(`not a release version: ${JSON.stringify(version)}`);
    }
    return parts;
}

/** `1.0.0` → `v1.0.0` (throws a `RangeError` for anything but `major.minor.patch`). */
export function releaseTag(version: string): string {
    return `v${releaseParts(version).join('.')}`;
}

/** `v1.0.0` → `1.0.0`, or null for anything that is not a release tag. */
export function versionOfTag(tag: string): string | null {
    return RELEASE_TAG_PATTERN.test(tag) ? tag.slice(1) : null;
}

/** The pinned folder of a release: `https://cdn.jsdelivr.net/gh/<repo>@v<version>/cdn/engine/`. */
export function engineCdnBase(version: string, repository: string = ENGINE_REPOSITORY): string {
    return `${JSDELIVR_GH}${repository}@${releaseTag(version)}/${ENGINE_CDN_FOLDER}/`;
}

/** The pinned address of one released file (`fonts/roboto-flex-latin-wght.woff2`); never `..`, never absolute. */
export function engineCdnUrl(version: string, file: string, repository: string = ENGINE_REPOSITORY): string {
    if (!RELEASE_PATH_PATTERN.test(file)) {
        throw new RangeError(`not a release file: ${JSON.stringify(file)}`);
    }
    return `${engineCdnBase(version, repository)}${file}`;
}

/** The floating folder of a major line (`@1`): follows every 1.x release, so it is offered only without integrity. */
export function engineMajorBase(version: string, repository: string = ENGINE_REPOSITORY): string {
    return `${JSDELIVR_GH}${repository}@${String(releaseParts(version)[0])}/${ENGINE_CDN_FOLDER}/`;
}

const subresourceSchema = z.strictObject({ url: httpsUrlSchema, integrity: z.string().regex(SRI_PATTERN) });

const releaseFileSchema = z.strictObject({
    path: z.string().max(200).regex(RELEASE_PATH_PATTERN),
    bytes: z.number().int().min(1),
    integrity: z.string().regex(SRI_PATTERN),
});

/**
 * `cdn/engine/release.json`, written by the release step from the built files and checked by the gates: `base` is the
 * pinned folder of `version`, every path is listed once (`release.json` itself never), and the page files are there.
 * `mapboxGl` names the Mapbox GL JS release the engine is written against and the integrity of its script and
 * stylesheet on api.mapbox.com, so a page can pin both from this one file.
 */
export const engineReleaseSchema = z
    .strictObject({
        version: versionSchema,
        repository: z.string().regex(REPOSITORY_PATTERN),
        base: httpsUrlSchema,
        mapboxGl: z.strictObject({ version: versionSchema, script: subresourceSchema, stylesheet: subresourceSchema }),
        files: z.array(releaseFileSchema).min(2).max(100),
    })
    .refine(
        (release) => parseVersion(release.version) !== null && release.base === engineCdnBase(release.version, release.repository),
        coded('validation.value', ['base']),
    )
    .refine(
        (release) => new Set(release.files.map((file) => file.path)).size === release.files.length,
        coded('validation.duplicateId', ['files']),
    )
    .refine(
        (release) => Object.values(ENGINE_PAGE_FILES).every((path) => release.files.some((file) => file.path === path)),
        coded('validation.required', ['files']),
    )
    .refine((release) => release.files.every((file) => file.path !== ENGINE_RELEASE_FILE), coded('validation.value', ['files']));

export type EngineRelease = z.infer<typeof engineReleaseSchema>;

/** The integrity `release` publishes for `path`, or undefined when it does not list the file. */
export function releaseIntegrity(release: Pick<EngineRelease, 'files'>, path: string): string | undefined {
    return release.files.find((file) => file.path === path)?.integrity;
}
