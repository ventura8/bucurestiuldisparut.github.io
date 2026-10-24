/**
 * The georeferencer's reference map (`docs/research/M3-interfaces.md` §10.4): one map per page visit, Mapbox Standard
 * (**never Satellite**), with the version's reference image (OpenStreetMap lines or Sentinel-2) and the live warped
 * preview as canvas pictures (`../imagery/overlay.ts`), and the pairs' places as points of the drawing tools: dragged in
 * `select`, still (`static`) while pairs are being added, when a click on the map is the place of the next pair.
 */
import {
    bboxExpand,
    MAX_GEOMETRY_VERTICES,
    MAX_POLYGON_RINGS,
    PHOTO_LOCATION_SLACK_DEG,
    roundTo,
    type Gcp,
    type LngLat,
    type Locale,
    type Logger,
} from '@hcm/shared';
import type { Unsubscribe } from '@hcm/ui/map';
import type { DrawChange, MapDrawPort } from '@hcm/ui/map/draw';

import { PictureOverlays } from '../imagery/overlay.js';
import type { CityFrame, MapStatus } from '../layers/map-session.js';
import type { AdminMapFactory, AdminMapHandle, AdminMapResult } from '../map/factory.js';
import type { GeoPosition } from './pairs.js';

/** The pairs' colour on the map. */
export const PAIR_COLOR = '#d81b60';

export interface GeorefMapDeps {
    readonly maps: AdminMapFactory | null;
    readonly locale: () => Locale;
    readonly log: Logger;
    readonly status: (status: MapStatus) => void;
    /** A click on the map (the place of the next pair while adding). */
    readonly clicked: (geo: GeoPosition) => void;
    /** A pair's place was dragged (once the drag ends). */
    readonly moved: (id: string, geo: GeoPosition) => void;
    /** A pair's point was selected on the map (null: none). */
    readonly selected: (id: string | null) => void;
}

export class GeorefMap {
    readonly #deps: GeorefMapDeps;
    readonly overlays: PictureOverlays;
    #container: HTMLElement | null = null;
    #frame: CityFrame | null = null;
    #handle: AdminMapHandle | null = null;
    #draw: MapDrawPort | null = null;
    #listeners: Unsubscribe[] = [];
    #pairs: readonly Gcp[] = [];
    #selected: string | null = null;
    #adding = false;
    /** Bumped by every attach and detach: a slower create of an older host is dropped. */
    #generation = 0;

    constructor(deps: GeorefMapDeps) {
        this.#deps = deps;
        this.overlays = new PictureOverlays(() => this.#handle?.port ?? null);
    }

    attach(container: HTMLElement): void {
        if (container !== this.#container) {
            this.detach();
            this.#container = container;
            void this.#create();
        }
    }

    /** Where the map opens: the reference's box, else the city's. */
    setFrame(frame: CityFrame): void {
        const first = this.#frame === null;
        this.#frame = frame;
        if (first) {
            void this.#create();
        }
    }

    /** The map's centre (the keyboard's crosshair), or null without a map. */
    get centre(): GeoPosition | null {
        const view = this.#handle?.port.getView();
        return view === undefined ? null : { lat: view.center[1], lng: view.center[0] };
    }

    zoomBy(delta: number): void {
        const port = this.#handle?.port;
        if (port !== undefined) {
            port.flyTo({ zoom: roundTo(port.getView().zoom + delta, 2) });
        }
    }

    /** The pairs' places, the selected one selected. */
    showPairs(pairs: readonly Gcp[], selected: string | null): void {
        this.#pairs = pairs;
        this.#selected = selected;
        this.#loadPairs();
    }

    /** While adding pairs a click on the map is a place, not a selection: the points stand still. */
    setAdding(adding: boolean): void {
        this.#adding = adding;
        this.#draw?.setMode(adding ? 'static' : 'select');
    }

    detach(): void {
        this.#generation += 1;
        this.#container = null;
        for (const stop of this.#listeners.splice(0)) {
            stop();
        }
        this.overlays.clear();
        this.#draw = null;
        this.#handle?.destroy();
        this.#handle = null;
        this.#deps.status('none');
    }

    #loadPairs(): void {
        const draw = this.#draw;
        if (draw !== null) {
            draw.load(this.#pairs.map((pair) => ({ id: pair.id, geometry: { type: 'Point', coordinates: [pair.geo.lng, pair.geo.lat] } })));
            draw.select(this.#selected);
        }
    }

    async #create(): Promise<void> {
        const request = this.#request();
        if (request === null) {
            return;
        }
        const { container, frame, maps } = request;
        const generation = this.#generation;
        this.#deps.status('loading');
        const result = await maps.create(container, { bounds: frame.bounds, view: frame.view, locale: this.#deps.locale() });
        await this.#created(result, frame, generation);
    }

    /** What a new map needs, once the page shows the host and the frame is known; null before (or with a map already). */
    #request(): { readonly container: HTMLElement; readonly frame: CityFrame; readonly maps: AdminMapFactory } | null {
        const container = this.#container;
        const frame = this.#frame;
        if (container === null || frame === null || this.#handle !== null) {
            return null;
        }
        const { maps } = this.#deps;
        if (maps === null) {
            this.#deps.status('failed');
            return null;
        }
        return { container, frame, maps };
    }

    async #created(result: AdminMapResult, frame: CityFrame, generation: number): Promise<void> {
        if (generation !== this.#generation) {
            if (result.ok) {
                result.map.destroy();
            }
            return;
        }
        if (!result.ok) {
            this.#deps.status(result.reason);
            return;
        }
        this.#handle = result.map;
        this.#deps.status('ready');
        this.#listeners.push(
            result.map.port.onMapClick(([lng, lat]) => {
                this.#deps.clicked({ lat, lng });
            }),
        );
        await this.#tools(result.map, frame, generation);
    }

    /** The drawing tools for the pairs' places, once loaded. */
    async #tools(handle: AdminMapHandle, frame: CityFrame, generation: number): Promise<void> {
        const draw = await handle.draw();
        if (generation !== this.#generation) {
            return;
        }
        const limits = bboxExpand(frame.bounds, PHOTO_LOCATION_SLACK_DEG);
        draw.attach(handle.port, { limits, color: PAIR_COLOR, maxVertices: MAX_GEOMETRY_VERTICES, maxRings: MAX_POLYGON_RINGS });
        this.#draw = draw;
        this.#listeners.push(
            draw.on('change', (change) => {
                this.#changed(change);
            }),
            draw.on('select', (id) => {
                this.#deps.selected(id);
            }),
        );
        draw.setMode(this.#adding ? 'static' : 'select');
        this.#loadPairs();
    }

    #changed(change: DrawChange): void {
        if (!change.final) {
            return;
        }
        // Only the pairs' points are loaded: every feature is a Point.
        for (const feature of change.features) {
            const [lng, lat] = (feature.geometry as { readonly coordinates: LngLat }).coordinates;
            this.#deps.moved(feature.id, { lat, lng });
        }
    }
}
