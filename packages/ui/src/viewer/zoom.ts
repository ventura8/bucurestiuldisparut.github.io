/**
 * The lightbox's zoom and pan (scenario V08): a scale between 1 and `MAX_SCALE` and an offset that never shows
 * more than the image's edge. Pure, so the gestures (pinch, wheel, keys, drag) are tested apart from the element.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

/** One key press multiplies or divides the scale by this. */
export const KEY_ZOOM_STEP = 1.25;

/** Wheel sensitivity: a typical 100 px notch zooms by about 22 %. */
const WHEEL_FACTOR = 0.002;

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface ZoomState {
    readonly scale: number;
    /** The image's translation in CSS px, applied before the scale. */
    readonly offset: Point;
}

export const ZOOM_RESET: ZoomState = { scale: MIN_SCALE, offset: { x: 0, y: 0 } };

export function clampScale(scale: number): number {
    return Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : MIN_SCALE;
}

function clampAxis(value: number, scale: number, size: number): number {
    const limit = ((scale - 1) * size) / 2 / scale;
    // Adding 0 turns a clamped -0 into 0, so a resting image reads (and transforms) as exactly 0.
    return Math.min(limit, Math.max(-limit, value)) + 0;
}

/** Keeps the image covering its box: at scale 1 the offset is 0, at scale s at most (s - 1) / 2 of the box. */
export function clampOffset(offset: Point, scale: number, box: Point): Point {
    return { x: clampAxis(offset.x, scale, box.x), y: clampAxis(offset.y, scale, box.y) };
}

/** A new scale (clamped), keeping the offset inside the box. */
export function zoomTo(state: ZoomState, scale: number, box: Point): ZoomState {
    const next = clampScale(scale);
    return { scale: next, offset: clampOffset(state.offset, next, box) };
}

/** A wheel turn: up (negative `deltaY`) zooms in. */
export function wheelScale(scale: number, deltaY: number): number {
    return clampScale(scale * Math.exp(-deltaY * WHEEL_FACTOR));
}

export function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The scale while pinching: the start scale times how much the fingers spread (a zero start distance changes nothing). */
export function pinchScale(startScale: number, startDistance: number, currentDistance: number): number {
    return startDistance > 0 ? clampScale((startScale * currentDistance) / startDistance) : clampScale(startScale);
}

/** Moves the image by a drag of `delta` screen px (divided by the scale, because the offset is applied before it). */
export function panBy(state: ZoomState, delta: Point, box: Point): ZoomState {
    const offset = { x: state.offset.x + delta.x / state.scale, y: state.offset.y + delta.y / state.scale };
    return { scale: state.scale, offset: clampOffset(offset, state.scale, box) };
}
