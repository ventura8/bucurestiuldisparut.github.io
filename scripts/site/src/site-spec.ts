import { z } from 'zod';

import { validate } from '@hcm/shared';

import { SiteBuildError, issuesText } from './errors.js';

/**
 * `site.json`: what one static site needs besides its `config.js` and `site.css`. The page itself is generated
 * (`page.ts`); nothing in this file is HTML.
 *
 * ```json
 * { "lang": "ro", "title": "București dispărut", "description": "…", "themeColor": "#8B5E3C",
 *   "noscript": { "ro": "…", "en": "…" },
 *   "manifest": "seed/bucharest/manifest.static.json", "media": "seed/bucharest/derived" }
 * ```
 */

/** A path inside the repository: relative, no `..` segment, no backslash. */
const REPOSITORY_PATH = /^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$))[\w.\-/]+$/;

const text = (max: number) => z.string().trim().min(1).max(max);
const repositoryPath = z.string().max(300).regex(REPOSITORY_PATH);

export const siteSpecSchema = z.strictObject({
    /** The page's `<html lang>` until the engine resolves the visitor's language (docs/ENGINE_API.md → Language). */
    lang: z.enum(['ro', 'en']),
    title: text(100),
    description: text(300),
    /** The browser UI colour (`<meta name="theme-color">`), usually the city's seed colour. */
    themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    /** Shown when JavaScript is off: one paragraph per language. */
    noscript: z.strictObject({ ro: text(300), en: text(300) }),
    /** The source manifest (City Manifest v1); written to `data/manifest.json` with its photos rewritten. */
    manifest: repositoryPath,
    /** Where the photo derivatives live, as `<photo id>/<file>` (the migration's `derived/` folder). */
    media: repositoryPath,
});

export type SiteSpec = z.infer<typeof siteSpecSchema>;

/** The validated `site.json` text; throws SiteBuildError on bad JSON or an invalid field. */
export function parseSiteSpec(json: string, filename = 'site.json'): SiteSpec {
    let input: unknown;
    try {
        input = JSON.parse(json);
    } catch (error: unknown) {
        throw new SiteBuildError(`${filename}: not JSON: ${String(error)}`);
    }
    const result = validate(siteSpecSchema, input);
    if (!result.ok) {
        throw new SiteBuildError(`${filename}: invalid\n${issuesText(result.issues)}`);
    }
    return result.value;
}
