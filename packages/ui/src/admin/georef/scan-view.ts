/**
 * The scan pane's view (`docs/research/M3-interfaces.md` §10.4): where the scan preview sits in the pane, zoomed from
 * "fit" up to 8× and panned, and the conversions between the pane's CSS pixels, the preview's pixels and the
 * full-resolution scan's (`pixel × previewScale` is the preview's: §6.1). Pure, so the element only draws and listens.
 */

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Size {
    readonly width: number;
    readonly height: number;
}

/** How far the admin may zoom in, beyond the scale that fits the whole preview. */
export const MAX_ZOOM = 8;

/** A marker answers a pointer this close to it (CSS pixels): a 48 px target. */
const HIT_RADIUS = 24;

export interface ScanView {
    /** CSS pixels per preview pixel. */
    readonly scale: number;
    /** Where the preview's origin is in the pane (CSS pixels). */
    readonly offset: Point;
}

/** The whole preview in the pane, centred. */
export function fitView(pane: Size, image: Size): ScanView {
    const scale = Math.min(pane.width / Math.max(image.width, 1), pane.height / Math.max(image.height, 1));
    return { scale, offset: { x: (pane.width - image.width * scale) / 2, y: (pane.height - image.height * scale) / 2 } };
}

/** The view zoomed by `factor` about the pane point `at`, within fit … fit × `MAX_ZOOM`. */
export function zoomView(view: ScanView, factor: number, at: Point, fit: ScanView): ScanView {
    const scale = Math.min(Math.max(view.scale * factor, fit.scale), fit.scale * MAX_ZOOM);
    const kept = scale / view.scale;
    return { scale, offset: { x: at.x - (at.x - view.offset.x) * kept, y: at.y - (at.y - view.offset.y) * kept } };
}

export function panView(view: ScanView, dx: number, dy: number): ScanView {
    return { scale: view.scale, offset: { x: view.offset.x + dx, y: view.offset.y + dy } };
}

/** A pane point as a full-resolution scan pixel. */
export function paneToScan(view: ScanView, at: Point, previewScale: number): Point {
    return { x: (at.x - view.offset.x) / view.scale / previewScale, y: (at.y - view.offset.y) / view.scale / previewScale };
}

/** A full-resolution scan pixel as a pane point. */
export function scanToPane(view: ScanView, pixel: Point, previewScale: number): Point {
    return { x: view.offset.x + pixel.x * previewScale * view.scale, y: view.offset.y + pixel.y * previewScale * view.scale };
}

/** The pair under a pane point (the nearest within `HIT_RADIUS`), or null. */
export function hitPair<P extends { readonly id: string; readonly pixel: Point }>(
    view: ScanView,
    pairs: readonly P[],
    at: Point,
    previewScale: number,
): P | null {
    let best: P | null = null;
    let distance = HIT_RADIUS;
    for (const pair of pairs) {
        const point = scanToPane(view, pair.pixel, previewScale);
        const here = Math.hypot(point.x - at.x, point.y - at.y);
        if (here <= distance) {
            best = pair;
            distance = here;
        }
    }
    return best;
}
