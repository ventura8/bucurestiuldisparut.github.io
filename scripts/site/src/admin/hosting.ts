import { z } from 'zod';

import { validate } from '@hcm/shared';

import { SiteBuildError, issuesText } from '../errors.js';
import { e2eContentSecurityPolicy } from './csp.js';

/**
 * What Firebase Hosting does with a request for the admin (`firebase.json` → `hosting`), read from the file itself so
 * the e2e admin server (`e2e/mock-apis/admin-server.ts`) behaves like Hosting without the Hosting emulator, which would
 * apply `upgrade-insecure-requests` to the http emulators (docs/research/M2b-interfaces.md §6.2):
 *
 * - `headers`: every rule whose `source` glob matches the request path adds its headers, in file order;
 * - `ignore`: files never deployed (a request for one is answered like a missing file);
 * - `rewrites`: a path with no file is served the first matching rule's destination (`**` → `/index.html`);
 * - `cleanUrls`: `/page` serves `page.html`.
 *
 * Globs follow Hosting's syntax as far as `firebase.json` uses it: `**` (any path), `*` (one segment), `?` and
 * `@(a|b)` (one of the alternatives).
 */

const headerSchema = z.object({ key: z.string().min(1), value: z.string() });

const hostingSchema = z.object({
    public: z.string().min(1),
    cleanUrls: z.boolean().default(false),
    ignore: z.array(z.string()).default([]),
    rewrites: z.array(z.object({ source: z.string().min(1), destination: z.string().startsWith('/') })).default([]),
    headers: z.array(z.object({ source: z.string().min(1), headers: z.array(headerSchema) })).default([]),
});

const firebaseJsonSchema = z.object({ hosting: hostingSchema });

export type HostingConfig = z.infer<typeof hostingSchema>;

/** The header that `e2eHostingHeaders` rewrites. */
export const CSP_HEADER = 'Content-Security-Policy';

/** The `hosting` block of a `firebase.json` text; throws SiteBuildError when it is not JSON or has no valid block. */
export function parseHostingConfig(firebaseJson: string, filename = 'firebase.json'): HostingConfig {
    let input: unknown;
    try {
        input = JSON.parse(firebaseJson);
    } catch (error: unknown) {
        throw new SiteBuildError(`${filename}: not JSON: ${String(error)}`);
    }
    const result = validate(firebaseJsonSchema, input);
    if (!result.ok) {
        throw new SiteBuildError(`${filename}: invalid hosting block\n${issuesText(result.issues)}`);
    }
    return result.value.hosting;
}

const GLOB_TOKENS: readonly (readonly [pattern: RegExp, source: string])[] = [
    [/^\*\*\//, '(?:.*/)?'],
    [/^\*\*/, '.*'],
    [/^\*/, '[^/]*'],
    [/^\?/, '[^/]'],
    [/^@\(([^)]*)\)/, ''],
];

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface GlobToken {
    readonly source: string;
    readonly length: number;
}

/** The regular expression of one glob token at the start of `rest`, and its length; null for a literal character. */
function globToken(rest: string): GlobToken | null {
    for (const [pattern, source] of GLOB_TOKENS) {
        const match = pattern.exec(rest);
        if (match !== null) {
            const alternatives = match[1]?.split('|').map(escapeRegExp).join('|');
            return { source: alternatives === undefined ? source : `(?:${alternatives})`, length: match[0].length };
        }
    }
    return null;
}

/** The token at the start of `rest`: a glob token, else its first character, escaped. */
function nextToken(rest: string): GlobToken {
    return globToken(rest) ?? { source: escapeRegExp(rest.charAt(0)), length: 1 };
}

/** A Hosting glob as an anchored expression over a path with its leading `/` removed. */
export function globToRegExp(glob: string): RegExp {
    let source = '';
    let rest = glob.replace(/^\//, '');
    while (rest !== '') {
        const token = nextToken(rest);
        source += token.source;
        rest = rest.slice(token.length);
    }
    return new RegExp(`^${source}$`);
}

function matches(glob: string, path: string): boolean {
    return globToRegExp(glob).test(path.replace(/^\//, ''));
}

/** The headers Hosting adds to a response for `path` (a later rule overrides an earlier one's header of the same name). */
export function hostingHeaders(config: HostingConfig, path: string): Record<string, string> {
    const applied = config.headers.filter((rule) => matches(rule.source, path)).flatMap((rule) => rule.headers);
    return Object.fromEntries(applied.map((header) => [header.key, header.value]));
}

/** True when `path` names a file Hosting never deploys (`ignore`). */
export function isIgnored(config: HostingConfig, path: string): boolean {
    return config.ignore.some((glob) => matches(glob, path));
}

/** The destination of the first rewrite whose source matches `path`, or undefined. */
export function rewriteOf(config: HostingConfig, path: string): string | undefined {
    return config.rewrites.find((rule) => matches(rule.source, path))?.destination;
}

/**
 * The headers of `path` as the e2e admin server sends them: Hosting's, with the CSP's `upgrade-insecure-requests`
 * dropped and `connect` added to its `connect-src`; nothing else differs (`scripts/site/test/admin-hosting.test.ts`).
 */
export function e2eHostingHeaders(config: HostingConfig, path: string, connect: readonly string[]): Record<string, string> {
    const headers = hostingHeaders(config, path);
    const policy = headers[CSP_HEADER];
    return policy === undefined ? headers : { ...headers, [CSP_HEADER]: e2eContentSecurityPolicy(policy, connect) };
}
