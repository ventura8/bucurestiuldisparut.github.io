/**
 * The scan pane's view (`docs/research/M3-interfaces.md` §10.4): where the scan preview sits in the pane, zoomed from
 * "fit" up to 8× and panned, and the conversions between the pane's CSS pixels, the preview's pixels and the
 * full-resolution scan's (`pixel × previewScale` is the preview's: §6.1). Pure, so the element only draws and listens.
 */
import { clamp } from '@hcm/shared';

import { PAIR_HIT_RADIUS } from './marker-badge.js';

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Size {
    readonly width: number;
    readonly height: number;
}

/** How far the admin may zoom in, beyond the scale that fits the whole preview. */
export const MAX_ZOOM = 32;

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
    const scale = clamp(view.scale * factor, fit.scale, fit.scale * MAX_ZOOM);
    const kept = scale / view.scale;
    return { scale, offset: { x: at.x - (at.x - view.offset.x) * kept, y: at.y - (at.y - view.offset.y) * kept } };
}

/** The view with the full-resolution `camera.centre` at the pane's centre, `camera.scale` CSS px a scan pixel (within fit … fit × `MAX_ZOOM`). */
export function centredView(
    pane: Size,
    camera: { readonly centre: Point; readonly scale: number },
    previewScale: number,
    fit: ScanView,
): ScanView {
    const zoom = clamp(camera.scale / previewScale, fit.scale, fit.scale * MAX_ZOOM);
    const across = previewScale * zoom;
    return { scale: zoom, offset: { x: pane.width / 2 - camera.centre.x * across, y: pane.height / 2 - camera.centre.y * across } };
}

/**
 * The view after the pane went from `before` to `after` (a scrollbar came, the window changed): still the whole preview when it showed
 * the whole preview (or the pane had never been shown), else the same zoom with the same scan point at the pane's centre, so a pair
 * added below never throws the owner's zoom away (2026-11-12).
 */
export function resizedView(view: ScanView, before: Size, after: Size, image: Size): ScanView {
    if (before.width === 0 || before.height === 0 || view.scale <= fitView(before, image).scale) {
        return fitView(after, image);
    }
    return panView(view, (after.width - before.width) / 2, (after.height - before.height) / 2);
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
    let distance = PAIR_HIT_RADIUS;
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
