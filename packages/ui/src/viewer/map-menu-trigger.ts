/**
 * What opens the map's menu (the owner, 2026-11-09; V62): a right click, a long press on a touch screen (500 ms, cancelled
 * by a move or a second finger), or the keyboard's ContextMenu key or Shift+F10 on the map (at its centre). Only a click
 * that did not drag opens it: Mapbox's right-drag rotates the map and a press that moves pans it. The menu itself is the
 * side-loaded `<hcm-map-menu>` (`map-menu.ts`); this is the engine's small part that listens.
 */

/** A point in the map's container, in CSS px from its top left corner. */
export interface MenuPoint {
    readonly x: number;
    readonly y: number;
}

export const LONG_PRESS_MS = 500;
/** A pointer that moved more than this (px) dragged: no menu. */
const MOVE_TOLERANCE_PX = 8;

interface Press {
    readonly x: number;
    readonly y: number;
    moved: boolean;
    /** A right click's menu, held until the button is released without a drag (where the browser asks on press). */
    pending: MenuPoint | null;
}

export interface MenuTimers {
    readonly set: (run: () => void, ms: number) => number;
    readonly clear: (id: number) => void;
}

const WINDOW_TIMERS: MenuTimers = {
    set: (run, ms) => window.setTimeout(run, ms),
    clear: (id) => {
        window.clearTimeout(id);
    },
};

/** Listens on the map's container `target` until the returned call. */
export function watchMapMenu(target: HTMLElement, open: (point: MenuPoint) => void): () => void {
    const trigger = new MapMenuTrigger(target, open);
    return () => {
        trigger.stop();
    };
}

export class MapMenuTrigger {
    readonly #target: HTMLElement;
    readonly #open: (point: MenuPoint) => void;
    readonly #timers: MenuTimers;
    readonly #presses = new Map<number, Press>();
    /** The last mouse press, kept after release: a browser that asks for the menu on release asks after `pointerup`. */
    #last: Press | null = null;
    #timer: number | null = null;
    /** A long press opened the menu: the contextmenu a touch browser fires after it is the same gesture. */
    #pressed = false;

    constructor(target: HTMLElement, open: (point: MenuPoint) => void, timers: MenuTimers = WINDOW_TIMERS) {
        this.#target = target;
        this.#open = open;
        this.#timers = timers;
        target.addEventListener('pointerdown', this.#down, true);
        target.addEventListener('pointermove', this.#move, true);
        target.addEventListener('pointerup', this.#up, true);
        target.addEventListener('pointercancel', this.#up, true);
        target.addEventListener('contextmenu', this.#contextMenu, true);
        target.addEventListener('keydown', this.#key, true);
    }

    stop(): void {
        this.#cancel();
        for (const [type, listener] of this.#listeners()) {
            this.#target.removeEventListener(type, listener, true);
        }
    }

    #listeners(): readonly (readonly [string, EventListener])[] {
        return [
            ['pointerdown', this.#down as EventListener],
            ['pointermove', this.#move as EventListener],
            ['pointerup', this.#up as EventListener],
            ['pointercancel', this.#up as EventListener],
            ['contextmenu', this.#contextMenu as EventListener],
            ['keydown', this.#key as EventListener],
        ];
    }

    #point(event: MouseEvent): MenuPoint {
        const box = this.#target.getBoundingClientRect();
        return { x: event.clientX - box.left, y: event.clientY - box.top };
    }

    #cancel(): void {
        if (this.#timer !== null) {
            this.#timers.clear(this.#timer);
            this.#timer = null;
        }
    }

    readonly #down = (event: PointerEvent): void => {
        const press: Press = { x: event.clientX, y: event.clientY, moved: false, pending: null };
        this.#presses.set(event.pointerId, press);
        this.#last = press;
        this.#cancel();
        this.#pressed = false;
        if (event.pointerType === 'touch' && this.#presses.size === 1) {
            const point = this.#point(event);
            this.#timer = this.#timers.set(() => {
                this.#timer = null;
                this.#pressed = true;
                this.#open(point);
            }, LONG_PRESS_MS);
        }
    };

    readonly #move = (event: PointerEvent): void => {
        const press = this.#presses.get(event.pointerId);
        if (press !== undefined && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE_PX) {
            press.moved = true;
            this.#cancel();
        }
    };

    readonly #up = (event: PointerEvent): void => {
        this.#cancel();
        const press = this.#presses.get(event.pointerId);
        this.#presses.delete(event.pointerId);
        const pending = press?.moved === false ? press.pending : null;
        if (pending !== null) {
            this.#open(pending);
        }
    };

    /**
     * A press still down waits for its release (a right-drag rotates the map: no menu); one released opens at once unless it
     * dragged; a long press already answered opens nothing more.
     */
    readonly #contextMenu = (event: MouseEvent): void => {
        event.preventDefault();
        const down = [...this.#presses.values()].at(-1);
        if (this.#pressed || this.#last?.moved === true) {
            this.#pressed = false;
            return;
        }
        if (down === undefined) {
            this.#open(this.#point(event));
            return;
        }
        down.pending = this.#point(event);
    };

    readonly #key = (event: KeyboardEvent): void => {
        if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault();
            const box = this.#target.getBoundingClientRect();
            this.#open({ x: box.width / 2, y: box.height / 2 });
        }
    };
}
