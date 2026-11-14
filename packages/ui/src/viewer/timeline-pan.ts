/**
 * A mouse on a scrolling timeline (`density` `scroll`): the visitor drags the years along as a finger does (the owner,
 * 2026-11-14: with a mouse the years beyond the card could not be reached). A press that moves more than
 * `PAN_SLOP_PX` pans the scroller and never selects; one that does not is a click and selects the year under it. The
 * wheel scrolls a lying track along: a vertical wheel and a shift-wheel move it sideways.
 */

/** Px a mouse may move and still click a year; beyond it the press pans the track. */
const PAN_SLOP_PX = 4;

export interface PanHooks {
    readonly vertical: boolean;
    /** The press ended within the slop: a click at this pointer. */
    readonly onClick: (event: PointerEvent) => void;
    /** The press is over (`released`: lifted, not cancelled). */
    readonly onEnd: (released: boolean) => void;
}

/** Starts a pan on `scroller` from `down`; returns what stops it. */
export function startPan(scroller: HTMLElement, down: PointerEvent, hooks: PanHooks): () => void {
    const origin = { x: down.clientX, y: down.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    let panning = false;
    const move = (event: PointerEvent): void => {
        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        if (!panning && Math.hypot(dx, dy) <= PAN_SLOP_PX) {
            return;
        }
        panning = true;
        scroller.toggleAttribute('data-panning', true);
        if (hooks.vertical) {
            scroller.scrollTop = origin.top - dy;
        } else {
            scroller.scrollLeft = origin.left - dx;
        }
    };
    const up = (event: PointerEvent): void => {
        if (!panning) {
            hooks.onClick(event);
        }
        hooks.onEnd(true);
    };
    const cancel = (): void => {
        hooks.onEnd(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
        scroller.removeAttribute('data-panning');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
    };
}

/** A wheel over a lying scrolling track (`along`): its vertical turn (a plain or a shift-wheel) scrolls the track sideways. */
export function wheelAlong(event: WheelEvent, along: boolean): void {
    const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!along || event.deltaY === 0 || sideways || !(event.currentTarget instanceof HTMLElement)) {
        return;
    }
    event.preventDefault();
    event.currentTarget.scrollBy({ left: event.deltaY });
}
