/**
 * What `<hcm-scan-viewer>` (`./hcm-scan-viewer.ts`) keeps of a pointer, a pinch and an arrow key, and how it loads a picture: out of the
 * element, which keeps its 400 lines with the ghost and the sharper scan (2026-11-12).
 */
import type { ScanMarker } from './scan-draw.js';
import type { Point, ScanView } from './scan-view.js';

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
