/**
 * Swipe compare (scenario V06): a second Mapbox map side by side with the viewer's, revealed by a slider. Every Map is
 * a billed map load, so the second map exists only while the visitor compares: `openCompare` creates it (loading
 * the mapbox-gl-compare 0.6.0 plugin from api.mapbox.com the first time, never bundled), and `close` removes the plugin,
 * the second map and its container (one map per view again).
 *
 * Subresource Integrity (`DECISIONS-for-review.md` §18b, §42f): the plugin's script and stylesheet load only with the
 * SHA-384 digests the caller names (`CompareDeps.integrity`, the page's build computes them from the pinned release, as
 * for mapbox-gl), with CORS, so a changed file on the CDN is refused; without valid digests the plugin is not loaded.
 */
import type { MapOptions, MapPort, Unsubscribe } from './map-port.js';
import { nativeMap } from './mapbox-adapter.js';
import type { MapboxCompare, MapboxCompareConstructor, MapboxGl } from './mapbox-types.js';

export const COMPARE_PLUGIN_VERSION = '0.6.0';

const PLUGIN_BASE = `https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-compare/v${COMPARE_PLUGIN_VERSION}`;

/** The plugin's script and stylesheet (the CSP already allows `https://api.mapbox.com/mapbox-gl-js/`). */
export const COMPARE_SCRIPT_URL = `${PLUGIN_BASE}/mapbox-gl-compare.js`;
export const COMPARE_STYLE_URL = `${PLUGIN_BASE}/mapbox-gl-compare.css`;

/** The SHA-384 Subresource Integrity digests of the plugin's two files (`sha384-` and 64 base64 characters each). */
export interface CompareIntegrity {
    readonly script: string;
    readonly style: string;
}

/** A SHA-384 Subresource Integrity digest, as the site build writes it (`scripts/site/src/sri.ts`). */
const INTEGRITY = /^sha384-[A-Za-z0-9+/]{64}$/;

export interface CompareDeps {
    readonly gl: MapboxGl;
    /** The digests the plugin's files must match; a load without them is refused. */
    readonly integrity: CompareIntegrity;
    /** Creates the second map's port (`createMapboxPort(gl)` in the viewer). */
    readonly createPort: () => MapPort;
    readonly document: Pick<Document, 'createElement' | 'head'>;
}

export interface CompareOptions {
    /** The element that holds the viewer's map container; the second map is added to it. */
    readonly container: HTMLElement;
    /** The second map's options (the viewer passes its own, with the current view). */
    readonly map: MapOptions;
    readonly orientation?: 'vertical' | 'horizontal';
}

export interface CompareSession {
    /** The second map: the viewer adds the compared layer to it like to its own map. */
    readonly map: MapPort;
    /** Moves the slider, in CSS pixels from the left (vertical) or the top (horizontal). */
    setSlider(position: number): void;
    /** Called with the slider position each time the visitor lets it go. */
    onSlideEnd(handler: (position: number) => void): Unsubscribe;
    /** Removes the plugin, the second map and its container; later calls do nothing. */
    close(): void;
}

const pluginLoads = new WeakMap<MapboxGl, Promise<MapboxCompareConstructor>>();

function appendOnce(deps: CompareDeps, element: HTMLLinkElement | HTMLScriptElement): Promise<void> {
    return new Promise((resolve, reject) => {
        element.addEventListener('load', () => {
            resolve();
        });
        element.addEventListener('error', () => {
            reject(new Error('compare plugin failed to load'));
        });
        deps.document.head.append(element);
    });
}

/** True when both digests are SHA-384 digests. */
function validCompareIntegrity(integrity: CompareIntegrity): boolean {
    return INTEGRITY.test(integrity.script) && INTEGRITY.test(integrity.style);
}

async function loadPlugin(deps: CompareDeps): Promise<MapboxCompareConstructor> {
    if (!validCompareIntegrity(deps.integrity)) {
        throw new Error('compare plugin needs its integrity digests');
    }
    const style = deps.document.createElement('link');
    style.rel = 'stylesheet';
    style.integrity = deps.integrity.style;
    style.crossOrigin = 'anonymous';
    style.href = COMPARE_STYLE_URL;
    const script = deps.document.createElement('script');
    script.integrity = deps.integrity.script;
    script.crossOrigin = 'anonymous';
    script.src = COMPARE_SCRIPT_URL;
    await Promise.all([appendOnce(deps, style), appendOnce(deps, script)]);
    const compare = deps.gl.Compare;
    if (compare === undefined) {
        throw new Error('compare plugin did not register mapboxgl.Compare');
    }
    return compare;
}

/** The plugin's constructor, loaded once per `mapboxgl` (a failed load is retried on the next call). */
export function comparePlugin(deps: CompareDeps): Promise<MapboxCompareConstructor> {
    const ready = deps.gl.Compare;
    if (ready !== undefined) {
        return Promise.resolve(ready);
    }
    let loading = pluginLoads.get(deps.gl);
    if (loading === undefined) {
        loading = loadPlugin(deps);
        pluginLoads.set(deps.gl, loading);
        loading.catch(() => pluginLoads.delete(deps.gl));
    }
    return loading;
}

function session(map: MapPort, compare: MapboxCompare, element: HTMLElement): CompareSession {
    let closed = false;
    const slideEnd = new Set<(position: number) => void>();
    compare.on('slideend', (event) => {
        for (const handler of slideEnd) {
            handler(event.currentPosition);
        }
    });
    return {
        map,
        setSlider: (position) => {
            if (!closed) {
                compare.setSlider(position);
            }
        },
        onSlideEnd: (handler) => {
            slideEnd.add(handler);
            return () => slideEnd.delete(handler);
        },
        close: () => {
            if (closed) {
                return;
            }
            closed = true;
            slideEnd.clear();
            compare.remove();
            map.destroy();
            element.remove();
        },
    };
}

/**
 * Opens the compare view over the viewer's mounted map `main`. Rejects (and leaves nothing behind) when the plugin
 * cannot load, `main` has no Mapbox map, or the second map fails to load.
 */
export async function openCompare(main: MapPort, options: CompareOptions, deps: CompareDeps): Promise<CompareSession> {
    const Compare = await comparePlugin(deps);
    const before = nativeMap(main);
    if (before === null) {
        throw new Error('compare needs a mounted map');
    }
    const element = deps.document.createElement('div');
    element.className = 'hcm-compare-map';
    options.container.append(element);
    const second = deps.createPort();
    try {
        await second.mount(element, { ...options.map, view: main.getView() });
        const after = nativeMap(second);
        if (after === null) {
            throw new Error('compare needs a Mapbox map');
        }
        const compare = new Compare(before, after, options.container, { orientation: options.orientation ?? 'vertical', mousemove: false });
        return session(second, compare, element);
    } catch (error) {
        second.destroy();
        element.remove();
        throw error;
    }
}
