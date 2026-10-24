/**
 * The Imagery page's map (`docs/research/M3-interfaces.md` §10.2): one map per page visit (the layers area's `AreaMap`),
 * always Mapbox Standard, **never Satellite**. Find draws every listed scene's footprint (a click selects the scene) and
 * the selected one above them with its browse image over its corners; a version's page draws its preview over its
 * output bounds, with the opacity slider's value. The pictures are canvas sources (`./overlay.ts`).
 */
import type { LngLat, Locale } from '@hcm/shared';
import type { PoiFeature, Unsubscribe, VectorOverlaySpec } from '@hcm/ui/map';

import { AreaMap, type CityFrame, type MapStatus } from '../layers/map-session.js';
import { PreviewLayer } from '../layers/preview.js';
import type { AdminMapFactory } from '../map/factory.js';
import type { FilePort, Picture, PicturePort } from './files.js';
import type { SceneItem } from './model.js';
import { cornersOfBox, PictureOverlays, type Corners } from './overlay.js';

export const FOOTPRINTS_OVERLAY = 'imagery-footprints';
export const SELECTED_OVERLAY = 'imagery-selected';
/** The ids of the map's pictures. */
export const BROWSE_PICTURE = 'browse';
export const PREVIEW_PICTURE = 'preview';

/** A browse image or a preview is decoded at most this long (a canvas texture). */
const PICTURE_MAX_SIDE = 2048;

const FOOTPRINT_COLOR = '#3949ab';
const SELECTED_COLOR = '#c2185b';

export interface ImageryMapDeps {
    readonly maps: AdminMapFactory | null;
    readonly locale: () => Locale;
    readonly files: FilePort;
    readonly pictures: PicturePort | null;
    readonly status: (status: MapStatus) => void;
    /** A footprint was clicked. */
    readonly picked: (sceneId: string) => void;
}

function footprintFeature(scene: SceneItem): PoiFeature {
    const ring = [...scene.footprint, ...scene.footprint.slice(0, 1)].map((point): [number, number] => [point[0], point[1]]);
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id: scene.id, title: scene.displayId } };
}

function overlay(id: string, scenes: readonly SceneItem[], color: string): VectorOverlaySpec {
    return { id, kind: 'poi', features: scenes.map(footprintFeature), color, icon: 'satellite_alt', visible: true, opacity: 0.6 };
}

/** The four corners a scene's picture goes on: its metadata's, else its footprint's box. */
export function sceneCorners(scene: SceneItem): Corners {
    if (scene.corners !== null) {
        return scene.corners;
    }
    const lngs = scene.footprint.map((point) => point[0]);
    const lats = scene.footprint.map((point) => point[1]);
    return cornersOfBox([
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
    ]);
}

export class ImageryMap {
    readonly #deps: ImageryMapDeps;
    readonly #area: AreaMap;
    readonly overlays: PictureOverlays;
    #clicks: Unsubscribe | null = null;
    /** Bumped by every picture asked for: a slower decode of an older one is dropped. */
    #request = 0;

    constructor(deps: ImageryMapDeps) {
        this.#deps = deps;
        this.#area = new AreaMap({
            ...{ maps: deps.maps, locale: deps.locale, preview: new PreviewLayer() },
            status: (status) => {
                this.#statusChanged(status);
            },
        });
        this.overlays = new PictureOverlays(() => this.#area.port);
    }

    attach(container: HTMLElement): void {
        this.#area.attach(container);
    }

    setFrame(frame: CityFrame): void {
        this.#area.setFrame(frame);
    }

    zoomBy(delta: number): void {
        this.#area.zoomBy(delta);
    }

    detach(): void {
        this.#clicks?.();
        this.#clicks = null;
        this.overlays.clear();
        this.#area.detach();
    }

    /** Find: the listed scenes' footprints, the selected one above them (null: none). */
    showScenes(scenes: readonly SceneItem[], selected: SceneItem | null): void {
        const categories = [overlay(FOOTPRINTS_OVERLAY, scenes, FOOTPRINT_COLOR)];
        this.#area.showContent({
            categories: selected === null ? categories : [...categories, overlay(SELECTED_OVERLAY, [selected], SELECTED_COLOR)],
        });
        if (selected !== null) {
            this.#area.port?.fitBounds(boxOf(sceneCorners(selected)), { padding: 32 });
        }
    }

    /** A picture of the bucket over `corners` (the selected scene's browse image, a version's preview). */
    async showPicture(id: string, path: string, corners: Corners, opacity: number): Promise<void> {
        this.#request += 1;
        const request = this.#request;
        const picture = await this.#decode(path);
        if (picture !== null && request === this.#request) {
            this.overlays.show({ id, picture, corners, opacity });
        }
    }

    /** No pictures (the selection or the page changed). */
    clearPictures(): void {
        this.#request += 1;
        this.overlays.clear();
    }

    /** A version's page: its preview's box on the map. */
    fitBox(box: readonly [LngLat, LngLat]): void {
        this.#area.port?.fitBounds(box, { padding: 32 });
    }

    async #decode(path: string): Promise<Picture | null> {
        const pictures = this.#deps.pictures;
        if (pictures === null) {
            return null;
        }
        const blob = await this.#deps.files.read(path);
        return blob === null ? null : pictures.decode(blob, PICTURE_MAX_SIDE);
    }

    /** The map's status; once it is drawn (the port exists only then) its footprints answer clicks. */
    #statusChanged(status: MapStatus): void {
        this.#deps.status(status);
        const port = this.#area.port;
        if (port !== null) {
            this.#clicks = port.onPoiClick((id) => {
                this.#deps.picked(id);
            });
        }
    }
}

function boxOf(corners: Corners): readonly [LngLat, LngLat] {
    const lngs = corners.map((corner) => corner[0]);
    const lats = corners.map((corner) => corner[1]);
    return [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
    ];
}
