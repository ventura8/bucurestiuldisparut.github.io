/**
 * The admin's map (docs/research/M2c-interfaces.md §3): the viewer's `MapPort` and Mapbox adapter (`@hcm/ui/map`), one
 * map per page visit, always the Standard style without 3D objects: **Mapbox Satellite is never loaded in the admin**,
 * whatever the city's basemap, so it can never become an alignment reference. The token is the admin's own
 * URL-restricted public token (`setup/status.mapbox.adminToken`); without it the page shows the unavailable map and
 * every field still works. Mapbox GL JS is loaded on the first map of the session; the drawing tools on first use:
 * Terra Draw when its loader is given and succeeds, else the click-only tools (`createClickDrawPort`).
 */
import { bboxExpand, PHOTO_LOCATION_SLACK_DEG, type BBox, type Locale, type Logger, type MapView } from '@hcm/shared';
import { createMapboxPort, type AdapterEnv, type MapboxGl, type MapPort } from '@hcm/ui/map';
import { createClickDrawPort, createTerraDrawPort, type MapDrawPort, type TerraDrawModules } from '@hcm/ui/map/draw';

import { createMapPreview, type MapPreview } from './preview.js';

/** The only style the admin's map ever loads. */
export const ADMIN_MAP_STYLE = 'mapbox://styles/mapbox/standard';

/** Standard's configuration: no 3D buildings over the edited shapes. */
const ADMIN_MAP_CONFIG: Readonly<Record<string, boolean>> = { show3dObjects: false };

const ADMIN_MAP_MIN_ZOOM = 9;
const ADMIN_MAP_MAX_ZOOM = 20;

export interface AdminMapOptions {
    /** The city's bounds: the camera stays within them plus `PHOTO_LOCATION_SLACK_DEG`. */
    readonly bounds: BBox;
    readonly view: MapView;
    readonly locale: Locale;
}

export interface AdminMapHandle {
    readonly port: MapPort;
    readonly preview: MapPreview;
    /** The drawing tools, made on first use (the same ones afterwards). */
    draw(): Promise<MapDrawPort>;
    /** Removes the map (and the drawing tools); a new page visit creates a new one. */
    destroy(): void;
}

export type AdminMapResult =
    { readonly ok: true; readonly map: AdminMapHandle } | { readonly ok: false; readonly reason: 'no-token' | 'no-webgl' | 'failed' };

export interface AdminMapFactory {
    /** Mounts the page's map into `container`: Standard style, the admin's token, the city's bounds and view. */
    create(container: HTMLElement, options: AdminMapOptions): Promise<AdminMapResult>;
}

export interface AdminMapDeps {
    /** The page's `mapboxgl`, loaded on the first map (`loadMapboxGl` of `@hcm/ui/map`). */
    readonly gl: () => Promise<MapboxGl>;
    /** `setup/status.mapbox.adminToken`, or null before Setup minted it. */
    readonly token: () => Promise<string | null>;
    /** Terra Draw's constructors, loaded on first use; null: the click-only tools. */
    readonly terraDraw: (() => Promise<TerraDrawModules>) | null;
    readonly reducedMotion: () => boolean;
    /** The browser parts of the adapter (the node tests pass fakes); the page's `window` by default. */
    readonly env: AdapterEnv;
    readonly log: Logger;
}

class Handle implements AdminMapHandle {
    readonly port: MapPort;
    readonly preview: MapPreview;
    readonly #deps: AdminMapDeps;
    #draw: Promise<MapDrawPort> | null = null;

    constructor(port: MapPort, deps: AdminMapDeps) {
        this.port = port;
        this.#deps = deps;
        this.preview = createMapPreview(port, deps.env.frames);
    }

    draw(): Promise<MapDrawPort> {
        this.#draw ??= this.#makeDraw();
        return this.#draw;
    }

    async #makeDraw(): Promise<MapDrawPort> {
        const load = this.#deps.terraDraw;
        if (load === null) {
            return createClickDrawPort();
        }
        try {
            return createTerraDrawPort(await load());
        } catch (error) {
            this.#deps.log.warn('terra draw failed to load: click drawing', { error: String(error) });
            return createClickDrawPort();
        }
    }

    destroy(): void {
        const draw = this.#draw;
        this.#draw = null;
        void draw?.then((tools) => {
            tools.detach();
        });
        this.port.destroy();
    }
}

async function glOf(deps: AdminMapDeps): Promise<MapboxGl | null> {
    try {
        return await deps.gl();
    } catch (error) {
        deps.log.warn('mapbox gl failed to load', { error: String(error) });
        return null;
    }
}

/** Where and how a map is mounted. */
interface Mounting {
    readonly container: HTMLElement;
    readonly options: AdminMapOptions;
    readonly token: string;
}

/** Mounts the map; the reason it could not be, or null. */
async function mount(port: MapPort, mounting: Mounting, deps: AdminMapDeps): Promise<'no-webgl' | 'failed' | null> {
    const { container, options, token } = mounting;
    try {
        await port.mount(container, {
            style: ADMIN_MAP_STYLE,
            config: ADMIN_MAP_CONFIG,
            accessToken: token,
            view: options.view,
            minZoom: ADMIN_MAP_MIN_ZOOM,
            maxZoom: ADMIN_MAP_MAX_ZOOM,
            maxBounds: bboxExpand(options.bounds, PHOTO_LOCATION_SLACK_DEG),
            locale: options.locale,
            reducedMotion: deps.reducedMotion(),
        });
        return null;
    } catch (error) {
        deps.log.warn('admin map failed to mount', { error: String(error) });
        return error instanceof Error && error.message === 'webgl' ? 'no-webgl' : 'failed';
    }
}

class Factory implements AdminMapFactory {
    readonly #deps: AdminMapDeps;

    constructor(deps: AdminMapDeps) {
        this.#deps = deps;
    }

    async create(container: HTMLElement, options: AdminMapOptions): Promise<AdminMapResult> {
        const token = await this.#deps.token();
        if (token === null) {
            return { ok: false, reason: 'no-token' };
        }
        const gl = await glOf(this.#deps);
        if (gl === null) {
            return { ok: false, reason: 'failed' };
        }
        const port = createMapboxPort(gl, this.#deps.env);
        if (!port.isWebGLSupported()) {
            return { ok: false, reason: 'no-webgl' };
        }
        const failure = await mount(port, { container, options, token }, this.#deps);
        if (failure !== null) {
            port.destroy();
            return { ok: false, reason: failure };
        }
        return { ok: true, map: new Handle(port, this.#deps) };
    }
}

export function createAdminMapFactory(deps: AdminMapDeps): AdminMapFactory {
    return new Factory(deps);
}
