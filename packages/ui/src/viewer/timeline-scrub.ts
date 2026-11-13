/**
 * A finger on the timeline (the owner, 2026-11-13): dragged along the track it scrubs through the years, each year it
 * enters selected at once (its layer to the front), the chip naming it clear of the finger (`timeline-tip.ts`); lifting
 * ends the drag; a tap selects the year under it. Locked to the track's axis like the opacity slider (`touchIntent`,
 * DECISIONS §178b): a finger that first moves across the track, more than `TOUCH_SLOP_PX`, is a swipe, not a scrub, and
 * selects nothing (nothing is selected before the finger has moved along the track or lifted). Each new year under the
 * finger gives a light tick (`navigator.vibrate`) where the device has one and the visitor did not ask for reduced motion.
 */
import { touchIntent } from '../components/slider.js';

/** How long the tick of a new year lasts, in ms. */
const TICK_MS = 8;

export interface ScrubHooks {
    /** The track runs up and down (a phone held upright). */
    readonly vertical: boolean;
    /** The stop under a pointer event. */
    readonly indexAt: (event: PointerEvent) => number;
    /** The stop under the finger changed (also once at the press): the chip follows it. */
    readonly onIndex: (index: number) => void;
    /** The year under a finger moving along the track, or under one lifted where it went down (a tap). */
    readonly onSelect: (index: number) => void;
    /** The finger is up, or the press ended across the track or cancelled. */
    readonly onEnd: () => void;
}

/** A light tick where the device vibrates and motion is welcome. */
export function tick(win: Window = window): void {
    if (typeof win.navigator.vibrate === 'function' && !win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        win.navigator.vibrate(TICK_MS);
    }
}

/** A pointer's place in the track's axes: along it, then across it. */
type Axes = (event: PointerEvent) => { readonly x: number; readonly y: number };

const LYING: Axes = (event) => ({ x: event.clientX, y: event.clientY });
const STANDING: Axes = (event) => ({ x: event.clientY, y: event.clientX });

/** Starts a scrub at `down`; returns what removes its listeners (called at the end too). */
export function startScrub(down: PointerEvent, hooks: ScrubHooks, win: Window = window): () => void {
    const axes = hooks.vertical ? STANDING : LYING;
    const start = axes(down);
    let intent: 'wait' | 'drag' | 'scroll' = 'wait';
    let index = hooks.indexAt(down);
    hooks.onIndex(index);
    /** The finger moved: a swipe across ends the press; along the track the chip follows and the year is selected. */
    const step = (event: PointerEvent): void => {
        const along = axes(event);
        intent = intent === 'wait' ? touchIntent(start, along.x, along.y) : intent;
        if (intent === 'scroll') {
            finish();
            return;
        }
        const next = hooks.indexAt(event);
        if (next !== index) {
            index = next;
            tick(win);
            hooks.onIndex(index);
        }
        if (intent === 'drag') {
            hooks.onSelect(index);
        }
    };
    const move = (event: PointerEvent): void => {
        if (event.pointerId === down.pointerId) {
            step(event);
        }
    };
    const up = (event: PointerEvent): void => {
        if (event.pointerId === down.pointerId) {
            hooks.onSelect(index);
            finish();
        }
    };
    const cancel = (event: PointerEvent): void => {
        if (event.pointerId === down.pointerId) {
            finish();
        }
    };
    const stop = (): void => {
        win.removeEventListener('pointermove', move);
        win.removeEventListener('pointerup', up);
        win.removeEventListener('pointercancel', cancel);
    };
    function finish(): void {
        stop();
        hooks.onEnd();
    }
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', cancel);
    return stop;
}
