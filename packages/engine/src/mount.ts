/**
 * The engine's public JavaScript API and its auto-boot (docs/ENGINE_API.md → JavaScript API, config.js): `mount`
 * renders a `<hcm-map-viewer>` into an element and returns its controller; `bootViewer` boots an element the page
 * declared itself; `autoBoot` reads `window.HistoricCityMapConfig`.
 *
 * DOM-free logic: the document, the factories of the map, telemetry and store, the network, storage and the location
 * are injected (`MountEnvironment`; `index.ts` wires the browser's), so the node tests drive every path with fakes.
 */
import { DEFAULT_CONTAINER_SELECTOR, resolveLocale, translate, type EngineConfig, type Locale, type Logger } from '@hcm/shared';
import {
    installFonts,
    type HcmMapViewer,
    type ViewerBootstrap,
    type ViewerController,
    type ViewerError,
    type ViewerReady,
    type ViewerStorePort,
} from '@hcm/ui';
import { createMapboxPort, type MapboxGl, type MapPort, type Unsubscribe } from '@hcm/ui/map';

import { configFromAttributes, readConfig, type Result } from './config/load.js';
import { urlLocaleOf } from './core/boot.js';
import type { CompareModule } from './core/compare-port.js';
import type { ViewerDeps, ViewerLocation } from './core/deps.js';
import type { PreferenceStorage } from './core/preferences.js';
import { createViewerStore, type ViewerState, type ViewerStore } from './core/store.js';
import { createTelemetry } from './telemetry/telemetry.js';
import type { TelemetryPort } from './telemetry/telemetry-port.js';

/** The tag `mount` renders (registered by `defineElements`). */
export const VIEWER_TAG = 'hcm-map-viewer';

/** The controller of one mounted viewer (docs/ENGINE_API.md → JavaScript API). */
export type HistoricCityMapController = ViewerController;

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

/** How `ready` settles for a state: ok once the map is ready, not ok once boot failed, else still pending (null). */
export function readyOutcome(state: Pick<ViewerState, 'status' | 'manifest' | 'error'>): ViewerReady | null {
    if (state.status === 'ready' && state.manifest !== null) {
        return { ok: true, cityId: state.manifest.city.id };
    }
    return state.status === 'error' && state.error !== null ? { ok: false, code: state.error.code } : null;
}

/**
 * The controller of a booted viewer: calls made before `ready` settles wait and run once the map is ready (they are
 * dropped when boot fails); after `destroy` every call does nothing.
 */
class Controller implements HistoricCityMapController {
    readonly ready: Promise<ViewerReady>;
    readonly #store: ViewerStore;
    readonly #teardown: () => void;
    readonly #resolve: (ready: ViewerReady) => void;
    readonly #queue: (() => void)[] = [];
    readonly #unsubscribe: Unsubscribe;
    #outcome: ViewerReady | null = null;
    #destroyed = false;

    constructor(store: ViewerStore, teardown: () => void) {
        const { promise, resolve } = deferred<ViewerReady>();
        this.ready = promise;
        this.#resolve = resolve;
        this.#store = store;
        this.#teardown = teardown;
        this.#unsubscribe = store.subscribe((state) => {
            this.#settle(readyOutcome(state));
        });
        this.#settle(readyOutcome(store.getState()));
    }

    setYear(year: number | null): void {
        this.#run(() => {
            this.#store.setYear(year);
        });
    }

    toggleLayer(layerId: string, visible?: boolean): void {
        this.#run(() => {
            this.#store.toggleOverlay(layerId, visible);
        });
    }

    setOverlayOpacity(overlayId: string, opacity: number): void {
        this.#run(() => {
            this.#store.setOverlayOpacity(overlayId, opacity, true);
        });
    }

    openPhoto(photoId: string | null): void {
        this.#run(() => {
            this.#store.openPhoto(photoId);
        });
    }

    openPoi(poiId: string | null): void {
        this.#run(() => {
            this.#store.openPoi(poiId);
        });
    }

    setLang(lang: Locale): void {
        this.#run(() => {
            this.#store.setLocale(resolveLocale(lang));
        });
    }

    openCompare(layerId: string | null, options?: { readonly position?: number }): void {
        this.#run(() => {
            this.#store.openCompare(layerId, options?.position);
        });
    }

    setComparePosition(position: number): void {
        this.#run(() => {
            this.#store.setComparePosition(position);
        });
    }

    closeCompare(): void {
        this.#run(() => {
            this.#store.closeCompare();
        });
    }

    destroy(): void {
        if (this.#destroyed) {
            return;
        }
        this.#settle({ ok: false, code: 'error.generic' });
        this.#destroyed = true;
        this.#unsubscribe();
        this.#store.destroy();
        this.#teardown();
    }

    #settle(outcome: ViewerReady | null): void {
        if (this.#outcome !== null || outcome === null) {
            return;
        }
        this.#outcome = outcome;
        this.#resolve(outcome);
        const queued = this.#queue.splice(0);
        if (outcome.ok) {
            queued.forEach((action) => {
                action();
            });
        }
    }

    #run(action: () => void): void {
        if (this.#destroyed) {
            return;
        }
        if (this.#outcome === null) {
            this.#queue.push(action);
            return;
        }
        action();
    }
}

/** A viewer that could not boot: `ready` says why at once, every call does nothing, `destroy` removes the card. */
function failedController(code: ViewerError['code'], teardown: () => void): HistoricCityMapController {
    let removed = false;
    const ignore = (): void => undefined;
    return {
        ready: Promise.resolve({ ok: false, code }),
        setYear: ignore,
        toggleLayer: ignore,
        setOverlayOpacity: ignore,
        openPhoto: ignore,
        openPoi: ignore,
        setLang: ignore,
        openCompare: ignore,
        setComparePosition: ignore,
        closeCompare: ignore,
        destroy: () => {
            if (!removed) {
                removed = true;
                teardown();
            }
        },
    };
}

/** Everything `mount` needs from the page; `index.ts` builds it from `window`. */
export interface MountEnvironment {
    readonly document: Pick<Document, 'createElement' | 'querySelector'>;
    /** The Mapbox MapPort (throws when Mapbox GL JS is missing from the page). */
    readonly createMap: () => MapPort;
    readonly createTelemetry: (cityId: string | undefined) => TelemetryPort;
    readonly createStore: (deps: ViewerDeps) => ViewerStore;
    readonly fetch: ViewerDeps['fetch'];
    readonly storage: PreferenceStorage;
    readonly location: ViewerLocation;
    readonly log: Logger;
    readonly engineVersion: string;
    /** mapbox-gl.css of the pinned Mapbox GL JS version, linked inside the viewer's shadow root. */
    readonly mapboxCssUrl: string;
    readonly reducedMotion: () => boolean;
    /** Registers the kit's fonts, loaded from `<engineBase>fonts/` (`config.engineBase`, else next to the engine). */
    readonly installFonts: (engineBase: string | undefined) => void;
    /** M4: swipe compare's lazy chunk (`compare-<hash>.js` of the ES module build, inlined in the IIFE). */
    readonly loadCompare: () => Promise<CompareModule>;
}

/** What `window.HistoricCityMapConfig` may name before it is validated: only its container is read early. */
function containerOf(raw: unknown): string {
    const container = typeof raw === 'object' && raw !== null ? (raw as { readonly container?: unknown }).container : undefined;
    return typeof container === 'string' && container.trim() !== '' ? container : DEFAULT_CONTAINER_SELECTOR;
}

/** The language of a configuration before validation (for its own error message). */
function languageOf(raw: unknown): Locale {
    const lang = typeof raw === 'object' && raw !== null ? (raw as { readonly lang?: unknown }).lang : undefined;
    return resolveLocale(typeof lang === 'string' ? lang : undefined);
}

/**
 * The language of a boot error card (docs/ENGINE_API.md → Language): the page address first, then the configuration's
 * own `lang`, so a city owner who opened `?lang=en` reads the whole card in English.
 */
function bootLocale(configLocale: Locale, env: Pick<MountEnvironment, 'location'>): Locale {
    return urlLocaleOf(env.location) ?? configLocale;
}

/** The viewer elements drive the store through `ViewerStorePort`; this checks at compile time that it satisfies it. */
function storePort(store: ViewerStore): ViewerStorePort {
    return store;
}

/** Shows `error` in `viewer`'s card, in `locale` (the card follows the element's `lang`). */
function fail(viewer: HcmMapViewer, error: ViewerError, locale: Locale): HistoricCityMapController {
    viewer.setAttribute('lang', locale);
    viewer.bootError = error;
    return failedController(error.code, () => {
        viewer.remove();
    });
}

function createMap(env: MountEnvironment): MapPort | null {
    try {
        return env.createMap();
    } catch (error: unknown) {
        env.log.error('Mapbox GL JS is not available', { message: error instanceof Error ? error.message : String(error) });
        return null;
    }
}

/** Boots `viewer` with a validated configuration: the store, the map, telemetry, then the load after the first render. */
function start(viewer: HcmMapViewer, config: EngineConfig, env: MountEnvironment): HistoricCityMapController {
    const map = createMap(env);
    if (map === null) {
        return fail(viewer, { code: 'error.mapLoad', retryable: false }, bootLocale(resolveLocale(config.lang), env));
    }
    viewer.manifestUrl = config.manifestUrl ?? '';
    viewer.engineVersion = env.engineVersion;
    viewer.mapboxCssUrl = env.mapboxCssUrl;
    env.installFonts(config.engineBase);
    const store = env.createStore({
        config,
        fetch: env.fetch,
        map,
        telemetry: env.createTelemetry(config.cityId),
        storage: env.storage,
        location: env.location,
        log: env.log,
        engineVersion: env.engineVersion,
        mapContainer: () => viewer.mapContainer,
        reducedMotion: env.reducedMotion,
        compare: { load: env.loadCompare, createMap: env.createMap, mapboxCssUrl: env.mapboxCssUrl },
    });
    const controller = new Controller(store, () => {
        viewer.detach();
        viewer.remove();
    });
    viewer.attach(storePort(store), controller);
    void viewer.updateComplete.then(() => store.load());
    return controller;
}

/** Boots `viewer` from a configuration result: an invalid one shows its error card (in `locale`), for the city owner to fix. */
function bootViewer(viewer: HcmMapViewer, config: Result<EngineConfig>, env: MountEnvironment, locale: Locale): HistoricCityMapController {
    return config.ok ? start(viewer, config.value, env) : fail(viewer, config.error, locale);
}

/** `HistoricCityMap.mount(element, config)`: renders a viewer into `element` and returns its controller. */
export function mount(element: Element, config: unknown, env: MountEnvironment): HistoricCityMapController {
    const viewer = env.document.createElement(VIEWER_TAG);
    const locale = bootLocale(languageOf(config), env);
    const controller = bootViewer(viewer, readConfig(config, locale), env, locale);
    element.append(viewer);
    return controller;
}

/**
 * Boots a `<hcm-map-viewer>` the page wrote itself: its `manifest-url`, `city-id`, `engine-base` attributes (or the
 * same properties set from script, which Lit keeps in step), its `lang` attribute and its `manifest` property.
 */
export function bootDeclared(viewer: HcmMapViewer, env: MountEnvironment): HistoricCityMapController {
    const attributes = {
        manifestUrl: viewer.manifestUrl,
        cityId: viewer.cityId,
        lang: viewer.getAttribute('lang'),
        engineBase: viewer.engineBase,
    };
    const locale = bootLocale(resolveLocale(attributes.lang), env);
    return bootViewer(viewer, configFromAttributes(attributes, viewer.manifest, locale), env, locale);
}

/**
 * The auto-boot of `config.js` (docs/ENGINE_API.md → Auto-boot): a configuration mounts into its container (a missing
 * container is logged, there is nowhere to draw); without one, a page that has the default container shows the
 * instructive "config.js is missing" card; otherwise nothing happens. Returns the controller, if a viewer was mounted.
 */
export function autoBoot(rawConfig: unknown, env: MountEnvironment): HistoricCityMapController | null {
    const selector = containerOf(rawConfig);
    const container = querySelector(env, selector);
    if (container === null) {
        if (rawConfig !== undefined) {
            env.log.error(translate(bootLocale(languageOf(rawConfig), env), 'error.config.container', { selector }), { selector });
        }
        return null;
    }
    return mount(container, rawConfig, env);
}

/** A selector the page wrote may be invalid: that is "no such element", not a crash. */
function querySelector(env: MountEnvironment, selector: string): Element | null {
    try {
        return env.document.querySelector(selector);
    } catch {
        return null;
    }
}

/** Boots every declared `<hcm-map-viewer>` with the page's environment (the viewer's bootstrap). */
export function bootDeclaredIn(environment: () => MountEnvironment): ViewerBootstrap {
    return (element) => {
        bootDeclared(element, environment());
    };
}

/** The globals the engine reads from the page (`window` in a browser). */
export interface EngineScope {
    readonly document?: Pick<Document, 'readyState' | 'addEventListener'>;
    readonly customElements?: CustomElementRegistry;
    readonly HistoricCityMapConfig?: unknown;
}

/** Runs once the document is parsed (at once when it already is: a deferred or module script). */
function whenParsed(doc: Pick<Document, 'readyState' | 'addEventListener'>, run: () => void): void {
    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', run, { once: true });
        return;
    }
    run();
}

/**
 * What importing the engine does in a page: register the elements, then auto-boot from `config.js`. Nothing happens
 * without a document (a worker, the node tests).
 */
export function startEngine(
    scope: EngineScope,
    define: (registry: CustomElementRegistry) => void,
    environment: () => MountEnvironment,
): void {
    const { document: doc, customElements: registry } = scope;
    if (doc === undefined || registry === undefined) {
        return;
    }
    define(registry);
    whenParsed(doc, () => {
        autoBoot(scope.HistoricCityMapConfig, environment());
    });
}

/** Where the engine script was loaded from: the page parts `engineBaseOf` reads. */
export interface ScriptScope {
    readonly document?: Pick<Document, 'currentScript' | 'baseURI'>;
}

function scriptSource(scope: ScriptScope): string | undefined {
    const src = (scope.document?.currentScript as { readonly src?: unknown } | null | undefined)?.src;
    return typeof src === 'string' && src !== '' ? src : undefined;
}

/**
 * The folder of the engine script, where its own files (fonts) are: `import.meta.url` in the ES module build; in the
 * IIFE build (where `import.meta` is empty) the script that is running while the engine loads; else the page.
 * Read once, while the engine script runs (`currentScript` is null afterwards).
 */
export function engineBaseOf(moduleUrl: string | undefined, scope: ScriptScope): string {
    const source = moduleUrl ?? scriptSource(scope) ?? scope.document?.baseURI;
    return source === undefined ? '' : new URL('./', source).href;
}

/** The release facts `browserEnvironment` needs from `index.ts` (which keeps them, for the release checks). */
export interface EngineRelease {
    readonly engineVersion: string;
    readonly mapboxGlVersion: string;
    /** Where the engine's files (fonts) are when `config.engineBase` does not say: next to the engine script. */
    readonly engineBase: string;
}

/** The page's `mapboxgl`, which `mapbox-gl.js` from api.mapbox.com defines before the engine runs. */
function mapboxOf(win: Window, version: string): MapboxGl {
    const gl = (win as Window & { readonly mapboxgl?: MapboxGl }).mapboxgl;
    if (gl === undefined) {
        throw new Error(`mapboxgl is not defined: load https://api.mapbox.com/mapbox-gl-js/v${version}/mapbox-gl.js first`);
    }
    return gl;
}

const NO_STORAGE: PreferenceStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

/** `localStorage`, or nothing when the browser refuses it (sandboxed frames, blocked site data). */
function storageOf(win: Window): PreferenceStorage {
    try {
        return win.localStorage;
    } catch {
        return NO_STORAGE;
    }
}

/** The page address as the store sees it; the hash is written with `history.replaceState` (no history entries). */
function locationOf(win: Window): ViewerLocation {
    return {
        get hash() {
            return win.location.hash;
        },
        get href() {
            return win.location.href;
        },
        get search() {
            return win.location.search;
        },
        replaceHash(hash: string): void {
            const url = hash === '' ? `${win.location.pathname}${win.location.search}` : hash;
            win.history.replaceState(win.history.state, '', url);
        },
        subscribe(listener: () => void) {
            win.addEventListener('hashchange', listener);
            return () => {
                win.removeEventListener('hashchange', listener);
            };
        },
    };
}

function telemetryFactory(win: Window, log: Logger, release: string): MountEnvironment['createTelemetry'] {
    return (cityId) =>
        createTelemetry({
            window: win,
            storage: storageOf(win),
            fetch: (url, init) => win.fetch(url, init),
            log: log.child('telemetry'),
            release,
            ...(cityId === undefined ? {} : { cityId }),
        });
}

/** The real browser behind `mount`: Mapbox from the page's global, `fetch`, `localStorage`, the location, the fonts. */
export function browserEnvironment(
    win: Window & Pick<typeof globalThis, 'FontFace'>,
    release: EngineRelease,
    log: Logger,
): MountEnvironment {
    return {
        document: win.document,
        createMap: () => createMapboxPort(mapboxOf(win, release.mapboxGlVersion)),
        createTelemetry: telemetryFactory(win, log, release.engineVersion),
        createStore: createViewerStore,
        fetch: (url, init) => win.fetch(url, init),
        storage: storageOf(win),
        location: locationOf(win),
        log,
        engineVersion: release.engineVersion,
        mapboxCssUrl: `https://api.mapbox.com/mapbox-gl-js/v${release.mapboxGlVersion}/mapbox-gl.css`,
        reducedMotion: () => win.matchMedia('(prefers-reduced-motion: reduce)').matches,
        installFonts: (engineBase) => {
            installFonts(win.document, `${engineBase ?? release.engineBase}fonts/`, win.FontFace);
        },
        loadCompare: () => import('./compare/compare.js').then((chunk) => chunk.compareModule),
    };
}
