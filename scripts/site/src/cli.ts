import { parseArgs } from 'node:util';

import type { Logger } from '@hcm/shared';

import { buildSite } from './build.js';
import { SiteBuildError } from './errors.js';
import type { SiteFileSystem } from './files.js';

/**
 * `node --import ./scripts/site/register-ts.mjs scripts/site/build-site.ts [--out dist/site] [--site <dir> ...]`
 * (`npm run build:site`): builds every site into `<out>/<site folder name>` (`dist/site/bucharest`,
 * `dist/site/starter-kit`). The Mapbox public token comes from the environment variable `MAPBOX_PUBLIC_TOKEN`, never
 * from argv; without it the sites get the e2e placeholder token, which Mapbox refuses (a warning says so).
 *
 * Exit status: 0 built, 1 an input is missing or invalid, 2 usage.
 */

/** The committed sites, in build order. */
export const DEFAULT_SITES: readonly string[] = ['sites/bucharest', 'starter-kit'];
const DEFAULT_OUT = 'dist/site';
/** A generated test value that encodes the scenario (`quality/testing_strategy_skill.md`), never a real token. */
export const PLACEHOLDER_TOKEN = 'pk.e2e-fake-token';

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

export interface CliContext {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly files: SiteFileSystem;
    readonly log: Logger;
}

interface CliOptions {
    readonly out: string;
    readonly sites: readonly string[];
}

function readOptions(argv: readonly string[]): CliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: { out: { type: 'string', default: DEFAULT_OUT }, site: { type: 'string', multiple: true } },
        strict: true,
        allowPositionals: false,
    });
    return { out: values.out, sites: values.site ?? DEFAULT_SITES };
}

function siteName(siteDir: string): string {
    return siteDir.slice(siteDir.lastIndexOf('/') + 1);
}

function tokenFrom(context: CliContext): string {
    const token = context.env['MAPBOX_PUBLIC_TOKEN'] ?? '';
    if (token !== '') {
        return token;
    }
    context.log.warn('MAPBOX_PUBLIC_TOKEN is not set: the sites use the e2e placeholder token, which only the mock APIs accept');
    return PLACEHOLDER_TOKEN;
}

function build(options: CliOptions, context: CliContext): number {
    const token = tokenFrom(context);
    for (const siteDir of options.sites) {
        const report = buildSite({ siteDir, outDir: `${options.out}/${siteName(siteDir)}`, token }, context.files);
        context.log.info('site built', { ...report });
    }
    return EXIT_OK;
}

/** Runs the CLI: an input problem is logged with exit status 1; anything else is a bug and propagates with its stack. */
export function runCli(argv: readonly string[], context: CliContext): number {
    let options: CliOptions;
    try {
        options = readOptions(argv);
    } catch (error: unknown) {
        context.log.error('usage: build-site.ts [--out dist/site] [--site <dir> ...]', { reason: String(error) });
        return EXIT_USAGE;
    }
    try {
        return build(options, context);
    } catch (error: unknown) {
        if (error instanceof SiteBuildError) {
            context.log.error(error.message);
            return EXIT_INVALID;
        }
        throw error;
    }
}
