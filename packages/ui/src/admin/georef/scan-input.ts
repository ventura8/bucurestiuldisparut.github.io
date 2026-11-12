/**
 * What `<hcm-scan-viewer>` (`./hcm-scan-viewer.ts`) keeps of a pointer, a pinch and an arrow key, and how it loads a picture: out of the
 * element, which keeps its 400 lines with the ghost and the sharper scan (2026-11-12); and the holder of the sharper scan's tiles.
 */
import type { ScanMarker } from './scan-draw.js';
import type { OpenDetail, ScanDetailScene } from './scan-tiles.js';
import type { Point, ScanView, Size } from './scan-view.js';

/** One pointer's press: where it began, the view then, the marker it drags (null: the view pans). */
export interface Gesture {
    readonly start: Point;
    readonly view: ScanView;
    /** The marker being dragged, or null (the view pans). */
    readonly marker: ScanMarker | null;
    moved: boolean;
    last: Point;
}

/** Two fingers: the view when they came down, their spread and their midpoint. */
export interface Pinch {
    readonly view: ScanView;
    readonly startDistance: number;
    readonly centre: Point;
}

/** What an arrow key moves: the selected marker by one preview pixel, or the view. */
export const ARROW_STEPS: Readonly<Record<string, Point>> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
};

/** An image of `url`; `loaded` hears it once it is in (a picture that never loads is never heard). */
export function imageOf(url: string, loaded: (image: HTMLImageElement) => void): HTMLImageElement {
    const image = new Image();
    image.addEventListener('load', () => {
        loaded(image);
    });
    image.src = url;
    return image;
}

/** The sharper scan a pane was handed: its tiles' file and its pixels per scan pixel. */
export interface ScanDetailFile {
    readonly file: Blob;
    readonly scale: number;
}

/** A lazy chunk that did not load: the preview stays. */
const NOTHING = (): void => undefined;

/**
 * The pane's sharper scan (`./scan-tiles.ts`, a lazy chunk fetched when a version's first arrives): opened from its file, kept while
 * it is still the one the pane wants, its decoded tiles closed when the pane lets it go.
 */
export class DetailTiles {
    #wanted: ScanDetailFile | null = null;
    #opened: OpenDetail | null = null;

    /** Opens `detail` (null: none); `changed` hears it open and each tile decoded. */
    load(detail: ScanDetailFile | null, changed: () => void): void {
        this.drop();
        this.#wanted = detail;
        if (detail !== null) {
            void import('./scan-tiles.js')
                .then(async ({ openDetail }) => openDetail(detail, changed))
                .then((opened) => {
                    this.#keep(detail, opened);
                    changed();
                }, NOTHING);
        }
    }

    #keep(detail: ScanDetailFile, opened: OpenDetail | null): void {
        if (this.#wanted === detail) {
            this.#opened = opened;
        } else {
            opened?.dispose();
        }
    }

    /** Lets the sharper scan go: its decoded tiles are closed, one still opening is dropped when it arrives. */
    drop(): void {
        this.#wanted = null;
        this.#opened?.dispose();
        this.#opened = null;
    }

    /** What to draw of it for a view (null: none open, or the preview is enough). */
    scene(view: ScanView, pane: Size, previewScale: number): ScanDetailScene | null {
        return this.#opened?.scene({ view, pane, previewScale, ratio: Math.max(globalThis.devicePixelRatio, 1) }) ?? null;
    }
}
