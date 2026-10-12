import type { PlaywrightTestOptions, PlaywrightWorkerOptions, Project } from '@playwright/test';

import { ADMIN_ORIGIN } from './admin/world.js';
import type { WorkerOptions } from './support/test.js';

/**
 * The Playwright projects of the e2e tiers (docs/research/design-review-testability.md §4.3), chosen per run with
 * `E2E_TIER` (comma-separated; unset or `all` runs every tier). Every project runs Chromium under SwiftShader
 * behind the host-resolver rules and depends on `setup`, which validates the fixture manifest and the servers once.
 *
 * | Tier | Projects | Specs |
 * | --- | --- | --- |
 * | `smoke` | `harness`, `smoke-c360`, `smoke-l1440` | `specs/harness/` (the e2e preconditions), `specs/smoke/` (the viewer boots) |
 * | `fn` | `fn-c360-ro`, `fn-m768-ro`, `fn-l1440-ro`, `fn-l1440-en`, `fn-c360-dark` | `specs/viewer/`, `specs/starter-kit/` |
 * | `tour` | `tour-<viewport>-<light|dark>-<ro|en>`, 11 viewports | `tour/*.tour.ts` (layout, axe, ARIA snapshots) |
 * | `a11y` | `a11y-reduced-motion`, `a11y-forced-colors` | `a11y/reduced-motion.spec.ts`, `a11y/forced-colors.spec.ts` |
 * | `nogl` | `nogl` (`--disable-3d-apis`) | `specs/viewer/no-webgl.spec.ts` |
 * | `admin` | `admin-setup`, `admin-harness`, `admin-{c360,m768,l1440}-ro`, `admin-l1440-en` | `admin/{setup,harness,specs}/` |
 *
 * The admin projects (docs/research/M2b-interfaces.md §6.2) open the admin server's origin, forward the fake
 * upstreams' hosts (`forwardUpstreams`), depend on `admin-setup` (the admin build and the emulators answer) instead of
 * `setup`, and run one test at a time (`workers: 1`, plus the lease of `e2e/admin/support/test.ts` across projects):
 * the emulators' owner, admins and setup records are per project.
 */

const TIERS = ['smoke', 'fn', 'tour', 'a11y', 'nogl', 'admin'] as const;
export type Tier = (typeof TIERS)[number];

/** Only loopback resolves in Chromium: defence in depth behind the firewall fixture (support/network.ts). */
const HOST_RULES = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost';
/** WebGL without a GPU: ANGLE on SwiftShader, which the containers and CI runners always have. */
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', HOST_RULES];
/** No WebGL at all (scenario V02's bad path): the viewer must fall back to the photo list. */
const NO_GL_ARGS = ['--disable-3d-apis', HOST_RULES];

interface Viewport {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly isMobile?: boolean;
    readonly hasTouch?: boolean;
    readonly deviceScaleFactor?: number;
}

const phone = (width: number, height: number): Viewport => ({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
});

/** M3 window classes: compact < 600 ≤ medium < 840 ≤ expanded < 1200 ≤ large < 1600 ≤ extra-large; c915l is compact height. */
const VIEWPORTS = {
    c320: phone(320, 568),
    c360: phone(360, 800),
    c412: phone(412, 915),
    c915l: phone(915, 412),
    m768: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    e1024: { viewport: { width: 1024, height: 768 }, hasTouch: true },
    l1280: { viewport: { width: 1280, height: 800 } },
    l1440: { viewport: { width: 1440, height: 900 } },
    x1920: { viewport: { width: 1920, height: 1080 } },
    x2560: { viewport: { width: 2560, height: 1440 } },
    x3840: { viewport: { width: 3840, height: 2160 } },
} as const satisfies Record<string, Viewport>;

type ViewportName = keyof typeof VIEWPORTS;
type E2eProject = Project<PlaywrightTestOptions, PlaywrightWorkerOptions & WorkerOptions>;
type Use = NonNullable<E2eProject['use']>;

const LOCALES = { ro: 'ro-RO', en: 'en-US' } as const;

function chromium(viewport: ViewportName, lang: 'ro' | 'en' = 'ro', args: readonly string[] = GL_ARGS): Use {
    return { browserName: 'chromium', ...VIEWPORTS[viewport], launchOptions: { args: [...args] }, locale: LOCALES[lang], lang };
}

function project(tier: Tier, name: string, testMatch: string | string[], use: Use, extra: Partial<E2eProject> = {}): E2eProject {
    return { name, testMatch, use, dependencies: ['setup'], metadata: { tier }, ...extra };
}

/** Globs relative to the project's test folder (`specs` unless the project says otherwise). */
const SPECS = ['viewer/**/*.spec.ts', 'starter-kit/**/*.spec.ts'];
const NO_WEBGL_SPEC = 'viewer/no-webgl.spec.ts';

function smokeProjects(): E2eProject[] {
    return [
        project('smoke', 'harness', 'harness/**/*.spec.ts', chromium('l1440')),
        project('smoke', 'smoke-c360', 'smoke/**/*.spec.ts', chromium('c360')),
        project('smoke', 'smoke-l1440', 'smoke/**/*.spec.ts', chromium('l1440')),
    ];
}

/**
 * A functional or a11y scenario walks several states of a SwiftShader map (open a panel, move a slider, probe, close):
 * 60 s each, as eight such pages in parallel take more than Playwright's default 30 s on a loaded machine.
 */
const SCENARIO_TIMEOUT_MS = 60_000;

function functionalProjects(): E2eProject[] {
    const fn = (name: string, use: Use): E2eProject =>
        project('fn', name, SPECS, use, { testIgnore: NO_WEBGL_SPEC, timeout: SCENARIO_TIMEOUT_MS });
    return [
        fn('fn-c360-ro', chromium('c360')),
        fn('fn-m768-ro', chromium('m768')),
        fn('fn-l1440-ro', chromium('l1440')),
        fn('fn-l1440-en', chromium('l1440', 'en')),
        fn('fn-c360-dark', { ...chromium('c360'), colorScheme: 'dark' }),
    ];
}

function tourProjects(): E2eProject[] {
    return (Object.keys(VIEWPORTS) as ViewportName[]).flatMap((viewport) =>
        (['light', 'dark'] as const).flatMap((scheme) =>
            (['ro', 'en'] as const).map((lang) =>
                project(
                    'tour',
                    `tour-${viewport}-${scheme}-${lang}`,
                    '**/*.tour.ts',
                    { ...chromium(viewport, lang), colorScheme: scheme },
                    // Several states per test, axe on each: a 3840 px frame under SwiftShader needs more than 30 s.
                    { testDir: 'tour', timeout: 120_000 },
                ),
            ),
        ),
    );
}

/** Each special runs only its own spec (selected by file, never by skip): the emulation is what the spec checks. */
function a11yProjects(): E2eProject[] {
    return [
        project(
            'a11y',
            'a11y-reduced-motion',
            'reduced-motion.spec.ts',
            { ...chromium('l1440'), reducedMotion: 'reduce' },
            { testDir: 'a11y', timeout: SCENARIO_TIMEOUT_MS },
        ),
        project(
            'a11y',
            'a11y-forced-colors',
            'forced-colors.spec.ts',
            { ...chromium('l1440'), forcedColors: 'active' },
            { testDir: 'a11y', timeout: SCENARIO_TIMEOUT_MS },
        ),
    ];
}

function noWebGlProjects(): E2eProject[] {
    return [project('nogl', 'nogl', NO_WEBGL_SPEC, chromium('l1440', 'ro', NO_GL_ARGS))];
}

/** An admin flow waits for the emulators (callables, the Auth and Firestore emulators) besides the page. */
const ADMIN_TIMEOUT_MS = 90_000;

function adminProject(name: string, testMatch: string, use: Use): E2eProject {
    return {
        name,
        testDir: 'admin',
        testMatch,
        use: { ...use, baseURL: ADMIN_ORIGIN, forwardUpstreams: true },
        dependencies: ['admin-setup'],
        workers: 1,
        timeout: ADMIN_TIMEOUT_MS,
        metadata: { tier: 'admin' },
    };
}

/** The admin tier: its setup, the harness of its e2e world, and the functional specs at three window classes and in English. */
function adminProjects(): E2eProject[] {
    const setup: E2eProject = {
        name: 'admin-setup',
        testDir: 'admin/setup',
        testMatch: '**/*.setup.ts',
        use: chromium('l1440'),
        metadata: { tier: 'admin' },
    };
    const SPECS_GLOB = 'specs/**/*.spec.ts';
    return [
        setup,
        adminProject('admin-harness', 'harness/**/*.spec.ts', chromium('l1440')),
        adminProject('admin-c360-ro', SPECS_GLOB, chromium('c360')),
        adminProject('admin-m768-ro', SPECS_GLOB, chromium('m768')),
        adminProject('admin-l1440-ro', SPECS_GLOB, chromium('l1440')),
        adminProject('admin-l1440-en', SPECS_GLOB, chromium('l1440', 'en')),
    ];
}

const BY_TIER: Readonly<Record<Tier, () => E2eProject[]>> = {
    smoke: smokeProjects,
    fn: functionalProjects,
    tour: tourProjects,
    a11y: a11yProjects,
    nogl: noWebGlProjects,
    admin: adminProjects,
};

function isTier(value: string): value is Tier {
    return (TIERS as readonly string[]).includes(value);
}

/** `E2E_TIER` as tiers: unset, empty or `all` is every tier; anything unknown throws, naming the valid ones. */
export function tiersFrom(value: string | undefined): readonly Tier[] {
    const names = (value ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '' && name !== 'all');
    const unknown = names.filter((name) => !isTier(name));
    if (unknown.length > 0) {
        throw new Error(`E2E_TIER must be "all" or a comma-separated list of ${TIERS.join(', ')}; unknown: ${unknown.join(', ')}`);
    }
    return names.length === 0 ? TIERS : TIERS.filter((tier) => names.includes(tier));
}

/** `setup`, then the projects of `tiers`. */
export function e2eProjects(tiers: readonly Tier[]): E2eProject[] {
    const setup: E2eProject = {
        name: 'setup',
        testDir: 'setup',
        testMatch: '**/*.setup.ts',
        use: chromium('l1440'),
        metadata: { tier: 'setup' },
    };
    return [setup, ...tiers.flatMap((tier) => BY_TIER[tier]())];
}
