/**
 * The store's boot sequence and its links to the outside (docs/ENGINE_API.md → Errors and validation, URL hash):
 * the first language (URL, stored choice, `config.lang`, Romanian), the manifest (`config/load.ts`), the URL hash and
 * the stored preferences of the city, telemetry's context, then the map (unless WebGL is missing: the photo list
 * still works, scenario V02) and its events. A newer `load` (Retry) supersedes an older one still in flight.
 */
import { decodeHash, resolveLocale, type DecodedHash, type Locale, type Manifest, type MapView, type MessageKey } from '@hcm/shared';

import { loadManifest } from '../config/load.js';
import type { MapEventMap, Unsubscribe } from '../map/map-port.js';
import type { TelemetryContext } from '../telemetry/telemetry-port.js';
import { mapOptions } from './map-specs.js';
import { MapSync } from './map-sync.js';
import type { ViewerDeps } from './deps.js';
import type { Preferences } from './preferences.js';
import { initialState, overlayName, THEME_MODES, withManifest, type ThemeMode, type ViewerError, type ViewerState } from './state.js';
import { applyDecodedHash, hashLimits, type HashWriter } from './url-sync.js';

/** What the boot sequence needs from the store. */
export interface BootHost {
    readonly deps: ViewerDeps;
    readonly preferences: Preferences;
    readonly hash: HashWriter;
    readonly destroyed: boolean;
    getState(): ViewerState;
    set(next: ViewerState): void;
    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void;
    openPhoto(photoId: string | null): void;
    openPoi(poiId: string | null): void;
    setView(view: MapView): void;
}

function exactLocale(value: string | null | undefined): Locale | null {
    return value === 'ro' || value === 'en' ? value : null;
}

/** The language the page address asks for (`#…&lang=`, else `?lang=`), or null: it wins over every other choice. */
export function urlLocaleOf(location: { readonly hash: string; readonly search?: string | undefined }): Locale | null {
    return decodeHash(location.hash).lang ?? exactLocale(new URLSearchParams(location.search ?? '').get('lang'));
}

function themeOf(value: string | null): ThemeMode {
    return THEME_MODES.find((mode) => mode === value) ?? 'system';
}

/** The manifest's absolute address (relative asset URLs resolve against it), or the page's for an inline manifest. */
function assetBase(manifestUrl: string | undefined, href: string | undefined): string | undefined {
    if (href === undefined) {
        return manifestUrl;
    }
    return manifestUrl === undefined || !URL.canParse(manifestUrl, href) ? href : new URL(manifestUrl, href).href;
}

/** The manifest's analytics ids (the Firebase web app ids too, CR-9), each present only when the manifest has it. */
function analyticsIds(analytics: Manifest['city']['analytics']): Pick<TelemetryContext, 'measurementId' | 'errorEndpoint' | 'firebase'> {
    const { measurementId, errorEndpoint, firebase } = analytics;
    return {
        ...(measurementId === undefined ? {} : { measurementId }),
        ...(errorEndpoint === undefined ? {} : { errorEndpoint }),
        ...(firebase === undefined ? {} : { firebase }),
    };
}

export class Boot {
    readonly #host: BootHost;
    /** The page's language (`config.lang`): the hash names the language only when it differs. */
    readonly defaultLocale: Locale;
    /** The language the URL asked for, which wins over the stored choice. */
    readonly #urlLocale: Locale | null;
    #loadId = 0;
    #sync: MapSync | null = null;
    #mapEvents: Unsubscribe[] = [];

    constructor(host: BootHost) {
        this.#host = host;
        const { config, location } = host.deps;
        this.defaultLocale = resolveLocale(config.lang);
        this.#urlLocale = urlLocaleOf(location);
    }

    initialState(): ViewerState {
        const { config, telemetry } = this.#host.deps;
        const stored = exactLocale(this.#host.preferences.get(config.cityId, 'lang'));
        const theme = themeOf(this.#host.preferences.get(config.cityId, 'theme'));
        return initialState(this.#urlLocale ?? stored ?? this.defaultLocale, theme, telemetry.consent);
    }

    async load(): Promise<void> {
        const host = this.#host;
        if (host.destroyed) {
            return;
        }
        this.#loadId += 1;
        const id = this.#loadId;
        this.#closeMap();
        host.set({ ...host.getState(), status: 'loading', error: null });
        const result = await loadManifest(host.deps.config, { fetch: host.deps.fetch, engineVersion: host.deps.engineVersion });
        if (!this.#current(id)) {
            return;
        }
        if (!result.ok) {
            this.#fail(result.error);
            return;
        }
        this.#enter(result.value);
        await this.#mount(id, result.value);
    }

    #current(id: number): boolean {
        return id === this.#loadId && !this.#host.destroyed;
    }

    #fail(error: ViewerError): void {
        this.#host.deps.log.warn('viewer failed', { code: error.code });
        this.#host.set({ ...this.#host.getState(), status: 'error', error });
    }

    /** The manifest in the state, then the URL hash and the city's stored preferences on top of it. */
    #enter(manifest: Manifest): void {
        const host = this.#host;
        const hash = decodeHash(host.deps.location.hash, hashLimits(manifest));
        const applied = applyDecodedHash(withManifest(host.getState(), manifest), hash);
        host.set(this.#withCityPreferences(applied.state, manifest.city.id));
        this.#telemetryContext(host.getState());
        if (applied.unknownPhoto !== null) {
            host.showToast('error.unknownPhoto');
        }
        if (hash.legacy) {
            host.hash.flush();
        }
    }

    /** The city's stored language (unless the URL named one) and theme. */
    #withCityPreferences(state: ViewerState, cityId: string): ViewerState {
        const stored = exactLocale(this.#host.preferences.get(cityId, 'lang'));
        const theme = this.#host.preferences.get(cityId, 'theme');
        const locale = this.#urlLocale ?? stored ?? state.locale;
        return { ...state, locale, theme: theme === null ? state.theme : themeOf(theme) };
    }

    async #mount(id: number, manifest: Manifest): Promise<void> {
        const { deps } = this.#host;
        if (!deps.map.isWebGLSupported()) {
            this.#ready(false);
            return;
        }
        const container = deps.mapContainer();
        if (container === null) {
            this.#ready(null);
            return;
        }
        const state = this.#host.getState();
        const reducedMotion = deps.reducedMotion?.() === true;
        try {
            await deps.map.mount(container, mapOptions(manifest, state.view, state.locale, reducedMotion));
        } catch (error) {
            this.#mountFailed(id, error);
            return;
        }
        this.#mounted(id);
    }

    #mounted(id: number): void {
        const { deps } = this.#host;
        if (this.#current(id)) {
            this.#sync = new MapSync(deps.map, assetBase(deps.config.manifestUrl, deps.location.href));
            this.#listenToMap();
            this.#sync.render(this.#host.getState());
            this.#ready(true);
        }
    }

    #mountFailed(id: number, error: unknown): void {
        if (!this.#current(id)) {
            return;
        }
        const webgl = error instanceof Error && error.message === 'webgl';
        this.#host.deps.log.warn('map failed to load', { error: String(error) });
        // A map whose style failed still holds a WebGL context and a canvas: it goes now, Retry makes a new one.
        this.#host.deps.map.destroy();
        this.#ready(webgl ? false : null);
    }

    /** `webgl` false: no map, the photo list (V02); null: the map container or the basemap failed (Retry). */
    #ready(webgl: boolean | null): void {
        const host = this.#host;
        if (webgl === null) {
            this.#fail({ code: 'error.mapLoad', retryable: true });
            return;
        }
        host.set({ ...host.getState(), status: 'ready', webgl });
        host.deps.telemetry.logEvent({ name: 'page_view' });
        host.hash.schedule();
    }

    #listenToMap(): void {
        const host = this.#host;
        const { map } = host.deps;
        this.#mapEvents = [
            map.onPhotoClick((photoId) => {
                host.openPhoto(photoId);
            }),
            map.onPoiClick((poiId) => {
                host.openPoi(poiId);
            }),
            map.on('moveend', (view) => {
                host.setView(view);
            }),
            map.on('error', (event) => {
                this.#mapError(event);
            }),
            map.on('webglcontextlost', () => {
                host.set({ ...host.getState(), webgl: false });
            }),
            map.on('webglcontextrestored', () => {
                host.set({ ...host.getState(), webgl: true });
            }),
        ];
    }

    /** A layer that fails names itself in a toast; other tile failures get the generic one; the map survives (V03, V16). */
    #mapError(event: MapEventMap['error']): void {
        const host = this.#host;
        host.deps.log.warn('map error', { kind: event.kind, layerId: event.layerId, message: event.message });
        const toast = host.getState().toast;
        if (event.layerId !== undefined && toast === null) {
            host.showToast('error.layer', { name: overlayName(host.getState(), event.layerId) });
        } else if (event.kind === 'tile' && toast === null) {
            host.showToast('error.tiles');
        }
    }

    /** After every state change: the map follows; telemetry learns a new language or window class. */
    followState(previous: ViewerState, next: ViewerState): void {
        this.#sync?.update(previous, next);
        if (next.locale !== previous.locale || next.windowClass !== previous.windowClass) {
            this.#telemetryContext(next);
        }
    }

    #telemetryContext(state: ViewerState): void {
        const city = state.manifest?.city;
        if (city !== undefined) {
            this.#host.deps.telemetry.setContext?.({
                cityId: city.id,
                locale: state.locale,
                windowClass: state.windowClass,
                ...analyticsIds(city.analytics),
            });
        }
    }

    /** A hash the visitor typed or navigated to (`hashchange`). */
    applyLocationHash(): void {
        this.#host.hash.sync();
        const manifest = this.#host.getState().manifest;
        if (manifest !== null) {
            this.applyHash(decodeHash(this.#host.deps.location.hash, hashLimits(manifest)));
        }
    }

    /** `ViewerActions.applyHash`: the state, then the map's view, then the toast of an unknown photo. */
    applyHash(hash: DecodedHash): void {
        const host = this.#host;
        const applied = applyDecodedHash(host.getState(), hash);
        host.set(applied.state);
        this.moveMap(hash.view);
        if (applied.unknownPhoto !== null) {
            host.showToast('error.unknownPhoto');
        }
    }

    /** Moves a mounted map to a view from the hash, without animation. */
    moveMap(view: MapView | undefined): void {
        if (this.#sync !== null && view !== undefined) {
            this.#host.deps.map.flyTo(view, { animate: false });
        }
    }

    /** Flies a mounted map to `view` (the port jumps instead under reduced motion); before the map, nothing moves. */
    flyMap(view: MapView): void {
        if (this.#sync !== null) {
            this.#host.deps.map.flyTo(view);
        }
    }

    #closeMap(): void {
        for (const unsubscribe of this.#mapEvents) {
            unsubscribe();
        }
        this.#mapEvents = [];
        if (this.#sync !== null) {
            this.#sync = null;
            this.#host.deps.map.destroy();
        }
    }

    /** Destroys the map exactly once: `#closeMap` destroys a mounted one, a map still mounting is destroyed here. */
    destroy(): void {
        this.#loadId += 1;
        const mounted = this.#sync !== null;
        this.#closeMap();
        if (!mounted) {
            this.#host.deps.map.destroy();
        }
    }
}
