/**
 * The georeferencer's pictures (`docs/research/M3-interfaces.md` §10.4): the scan preview (`scan-preview.jpg`) as a
 * `blob:` address for the scan pane and decoded for the warped preview, the reference shown on the map (OpenStreetMap
 * lines or Sentinel-2, switchable: never Mapbox Satellite), and the warped preview itself, drawn again at most once per
 * frame however fast the pairs move (`WARP_DELAY_MS`).
 */
import type { BBox, FittedTransform } from '@hcm/shared';

import type { Clock } from '../app/ports.js';
import type { FilePort, Picture, PicturePort } from '../imagery/files.js';
import { cornersOfBox, type PictureOverlays } from '../imagery/overlay.js';
import type { GeorefVersion, ReferenceKind, ScanImage } from './state.js';
import { warpFrame, warpTriangles } from './warp.js';

/** The overlays' ids on the map. */
export const REFERENCE_PICTURE = 'reference';
export const WARPED_PICTURE = 'warped';

/** The warped preview is drawn again this long after the last change (one frame). */
export const WARP_DELAY_MS = 16;

/** The scan and the reference are decoded at most this long (a canvas texture). */
const DECODE_MAX_SIDE = 4096;

export interface GeorefPicturesDeps {
    readonly files: FilePort;
    readonly pictures: PicturePort | null;
    readonly clock: Clock;
    readonly overlays: PictureOverlays;
    /** The scan pane's image. */
    readonly scan: (image: ScanImage) => void;
}

type Scan = NonNullable<GeorefVersion['scan']>;

/** The reference shown: its kind, its picture's path and its box. */
export interface ReferenceChoice {
    readonly kind: ReferenceKind;
    readonly path: string;
    readonly bounds: BBox;
}

/** The reference to show: the one asked for when the version has it, else OpenStreetMap, else Sentinel-2, else none. */
export function referenceOf(version: GeorefVersion, wanted: ReferenceKind | null): ReferenceChoice | null {
    const reference = version.reference;
    if (reference === null) {
        return null;
    }
    const choices = [
        { kind: 'osm' as const, path: reference.osmPath },
        { kind: 's2' as const, path: reference.s2Path },
    ].flatMap(({ kind, path }) => (path === null ? [] : [{ kind, path, bounds: reference.bounds }]));
    return choices.find((choice) => choice.kind === wanted) ?? choices[0] ?? null;
}

/** A decoded picture and the port that draws with it. */
interface Decoded {
    readonly pictures: PicturePort;
    readonly picture: Picture;
}

/** What the warped preview is drawn from. */
interface WarpInput {
    readonly transform: FittedTransform | null;
    readonly scan: Scan | null;
    readonly opacity: number;
}

interface ReadyWarp {
    readonly source: Decoded;
    readonly transform: FittedTransform;
    readonly scan: Scan;
    readonly opacity: number;
}

export class GeorefPictures {
    readonly #deps: GeorefPicturesDeps;
    #versionId: string | null = null;
    #scanUrl: string | null = null;
    #scanPicture: Decoded | null = null;
    #target: Picture | null = null;
    #reference: ReferenceKind | null = null;
    #timer: unknown = null;
    #next: WarpInput | null = null;
    /** Bumped by `clear`: a decode that ends after it is dropped. */
    #generation = 0;

    constructor(deps: GeorefPicturesDeps) {
        this.#deps = deps;
    }

    get reference(): ReferenceKind | null {
        return this.#reference;
    }

    /** A version's scan (once per version) and the reference asked for. */
    load(version: GeorefVersion, wanted: ReferenceKind | null): void {
        if (version.id !== this.#versionId) {
            this.#versionId = version.id;
            void this.#loadScan(version.scan);
        }
        const choice = referenceOf(version, wanted);
        const kind = choice?.kind ?? null;
        if (kind !== this.#reference) {
            this.#reference = kind;
            this.#deps.overlays.remove(REFERENCE_PICTURE);
            void this.#showReference(choice);
        }
    }

    /** Draws the warped preview of `transform` again (soon, once); null removes it. */
    warp(transform: FittedTransform | null, scan: Scan | null, opacity: number): void {
        this.#next = { transform, scan, opacity };
        if (this.#timer === null) {
            this.#timer = this.#deps.clock.setTimeout(() => {
                this.#timer = null;
                this.#render();
            }, WARP_DELAY_MS);
        }
    }

    setOpacity(opacity: number): void {
        this.#deps.overlays.setOpacity(WARPED_PICTURE, opacity);
    }

    clear(): void {
        this.#generation += 1;
        if (this.#timer !== null) {
            this.#deps.clock.clearTimeout(this.#timer);
            this.#timer = null;
        }
        if (this.#scanUrl !== null) {
            this.#deps.files.release(this.#scanUrl);
        }
        this.#scanUrl = null;
        this.#scanPicture = null;
        this.#target = null;
        this.#versionId = null;
        this.#reference = null;
        this.#next = null;
        this.#deps.scan({ status: 'none' });
    }

    async #loadScan(scan: Scan | null): Promise<void> {
        if (scan === null) {
            this.#deps.scan({ status: 'none' });
            return;
        }
        const generation = this.#generation;
        this.#deps.scan({ status: 'loading' });
        const url = await this.#deps.files.url(scan.previewPath);
        const picture = await this.#decode(scan.previewPath);
        if (generation !== this.#generation) {
            this.#release(url);
            return;
        }
        this.#scanUrl = url;
        this.#scanPicture = picture;
        this.#deps.scan(url === null ? { status: 'failed' } : { status: 'ready', url });
        this.#render();
    }

    async #showReference(choice: ReferenceChoice | null): Promise<void> {
        if (choice === null) {
            return;
        }
        const decoded = await this.#decode(choice.path);
        if (decoded === null || choice.kind !== this.#reference) {
            return;
        }
        this.#deps.overlays.show({ id: REFERENCE_PICTURE, picture: decoded.picture, corners: cornersOfBox(choice.bounds), opacity: 1 });
        // The reference went on top: the warped preview goes back above it.
        this.#render();
    }

    async #decode(path: string): Promise<Decoded | null> {
        const pictures = this.#deps.pictures;
        if (pictures === null) {
            return null;
        }
        const blob = await this.#deps.files.read(path);
        const picture = blob === null ? null : await pictures.decode(blob, DECODE_MAX_SIDE);
        return picture === null ? null : { pictures, picture };
    }

    #release(url: string | null): void {
        if (url !== null) {
            this.#deps.files.release(url);
        }
    }

    #render(): void {
        const input = this.#ready();
        if (input === null) {
            this.#deps.overlays.remove(WARPED_PICTURE);
            return;
        }
        this.#draw(input);
    }

    /** The scan decoded and a fit to draw it through, or null (the preview is then taken off the map). */
    #ready(): ReadyWarp | null {
        const next = this.#next;
        const source = this.#scanPicture;
        if (next === null || source === null) {
            return null;
        }
        const { transform, scan, opacity } = next;
        return transform === null || scan === null ? null : { source, transform, scan, opacity };
    }

    #draw(input: ReadyWarp): void {
        const { pictures, picture } = input.source;
        const frame = warpFrame(input.transform, input.scan);
        const target = this.#targetOf(pictures, frame.width, frame.height);
        pictures.draw(target, picture, warpTriangles(input.transform, frame, input.scan, picture));
        this.#deps.overlays.show({ id: WARPED_PICTURE, picture: target, corners: cornersOfBox(frame.bounds), opacity: input.opacity });
    }

    /** The warped canvas, made again only when its size changes. */
    #targetOf(pictures: PicturePort, width: number, height: number): Picture {
        const kept = this.#target;
        const target = kept !== null && kept.width === width && kept.height === height ? kept : pictures.blank(width, height);
        this.#target = target;
        return target;
    }
}
