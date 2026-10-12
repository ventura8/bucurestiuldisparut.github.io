/**
 * The meta Content Security Policy of a static city site (GitHub Pages cannot send headers):
 * docs/research/design-review-security-cost.md §1.8, plus the consent-gated analytics hosts of PLAN Addendum 2.
 *
 * Fixed sources: the page's own origin (engine, config.js, the manifest and photos when they are served next to
 * the page), Mapbox GL JS from api.mapbox.com and the Mapbox APIs, and the Google Analytics / Firebase hosts the
 * telemetry may load after the visitor consents. The origins a manifest names (an https manifest, photo or tile
 * host, the crash-report endpoint) are added per site by `manifestOrigins`.
 */

/** Mapbox GL JS (script, stylesheet and its WebAssembly helpers) is loaded from this folder, never bundled. */
export const MAPBOX_GL_CDN = 'https://api.mapbox.com/mapbox-gl-js/';

/** Styles, tiles, fonts, sprites, map sessions (api.mapbox.com) and the map-load event (events.mapbox.com). */
export const MAPBOX_CONNECT_SOURCES: readonly string[] = [
    'https://api.mapbox.com',
    'https://events.mapbox.com',
    'https://*.tiles.mapbox.com',
];

/**
 * GA4 and Firebase Performance Monitoring, loaded only after consent and only when the manifest has a measurementId
 * (`firebase/analytics_and_crash_skill.md`). Listed in every build because the manifest can gain a measurementId
 * later without a rebuild of the page.
 */
export const ANALYTICS_SCRIPT_SOURCES: readonly string[] = ['https://www.googletagmanager.com'];

export const ANALYTICS_CONNECT_SOURCES: readonly string[] = [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
    'https://firebase.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
    'https://firebaselogging.googleapis.com',
    'https://firebaselogging-pa.googleapis.com',
    'https://firebaseremoteconfig.googleapis.com',
];

export const ANALYTICS_IMAGE_SOURCES: readonly string[] = ['https://*.google-analytics.com', 'https://*.googletagmanager.com'];

/** Origins a site adds to the fixed policy (`manifestOrigins`). */
export interface ExtraSources {
    /** fetch / XHR targets: the manifest, tiles, the crash-report endpoint. */
    readonly connect: readonly string[];
    /** `<img>` and image-decoding targets: photos, tiles. */
    readonly images: readonly string[];
}

type Directive = readonly [name: string, sources: readonly string[]];

function directives(extra: ExtraSources): readonly Directive[] {
    return [
        ['default-src', ["'none'"]],
        // 'wasm-unsafe-eval': Mapbox GL compiles WebAssembly for the Standard style (security review §1.8).
        ['script-src', ["'self'", MAPBOX_GL_CDN, "'wasm-unsafe-eval'", ...ANALYTICS_SCRIPT_SOURCES]],
        ['style-src', ["'self'", MAPBOX_GL_CDN]],
        ['img-src', ["'self'", 'data:', 'blob:', 'https://api.mapbox.com', ...ANALYTICS_IMAGE_SOURCES, ...extra.images]],
        ['connect-src', ["'self'", ...MAPBOX_CONNECT_SOURCES, ...ANALYTICS_CONNECT_SOURCES, ...extra.connect]],
        ['font-src', ["'self'"]],
        // Mapbox GL runs its workers from blob: URLs; child-src covers browsers without worker-src (Safari < 15.5).
        ['worker-src', ['blob:']],
        ['child-src', ['blob:']],
        ['manifest-src', ["'self'"]],
        ['base-uri', ["'none'"]],
        ['form-action', ["'none'"]],
        ['object-src', ["'none'"]],
    ];
}

/** The policy as one `content` attribute value: directives in a fixed order, each source once. */
export function contentSecurityPolicy(extra: ExtraSources): string {
    return directives(extra)
        .map(([name, sources]) => [name, ...new Set(sources)].join(' '))
        .join('; ');
}
