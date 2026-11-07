/**
 * The gamepad's lazy chunk (docs/research/viewer-input.md §3; a fake pad in the tests, no real hardware was available):
 * one animation-frame loop while a pad of the standard mapping is connected and the tab is visible. The left stick pans,
 * the right stick and the triggers zoom, each button is a viewer command or a move of the focus. A pad of any other
 * mapping is refused once with a toast and never polled.
 */
import type { Logger, MapView, MessageKey } from '@hcm/shared';

import { deepActiveElement, tabbableElements } from '../../components/focus.js';
import type { MapPort } from '../../map/map-port.js';
import { wrapped, type InputCommand } from '../input-commands.js';
import { connectedPads, type PadWindow } from './pads.js';

/** What the session needs from `<hcm-map-viewer>`. */
export interface GamepadSurface {
    readonly renderRoot: Element | DocumentFragment;
    runInput(command: InputCommand): void;
    mapCovered(): boolean;
    toast(key: MessageKey): void;
}

export interface GamepadDeps {
    readonly win: PadWindow;
    readonly surface: GamepadSurface;
    readonly map: Pick<MapPort, 'getView' | 'flyTo'>;
    readonly log: Pick<Logger, 'warn'>;
}

export interface GamepadSession {
    /** A pad connected or the tab came back: start the loop if there is a usable pad. */
    wake(): void;
    destroy(): void;
}

export interface GamepadModule {
    readonly startGamepad: (deps: GamepadDeps) => GamepadSession;
}

const DEAD_ZONE = 0.15;
const PAN_PX_PER_S = 500;
const ZOOM_PER_S = 1.5;
const MAX_FRAME_MS = 100;
const WORLD_PX = 512;
const LEFT_TRIGGER = 6;
const RIGHT_TRIGGER = 7;

/** A stick's two axes, or nothing inside the radial dead zone. */
export function stick(x: number, y: number): readonly [number, number] {
    return Math.hypot(x, y) < DEAD_ZONE ? [0, 0] : [x, y];
}

/** `view` moved by screen pixels (x right, y down) and zoom levels; Mapbox applies the bounds and the zoom range. */
export function movedView(view: MapView, dx: number, dy: number, dz: number): MapView {
    const degrees = 360 / (WORLD_PX * 2 ** view.zoom);
    const bearing = (view.bearing * Math.PI) / 180;
    const east = dx * Math.cos(bearing) - dy * Math.sin(bearing);
    const north = -dx * Math.sin(bearing) - dy * Math.cos(bearing);
    const [lng, lat] = view.center;
    return {
        ...view,
        center: [lng + east * degrees, lat + north * degrees * Math.cos((lat * Math.PI) / 180)],
        zoom: view.zoom + dz,
    };
}

function isStandard(pad: Gamepad): boolean {
    return pad.mapping === 'standard';
}

function axisValue(pad: Gamepad, index: number): number {
    return pad.axes[index] ?? 0;
}

function buttonValue(pad: Gamepad, index: number): number {
    return pad.buttons[index]?.value ?? 0;
}

function held(pad: Gamepad): ReadonlySet<number> {
    return new Set(pad.buttons.flatMap((button, index) => (button.pressed ? [index] : [])));
}

/** Inert reaches into a shadow tree from any host above it, which `closest` alone does not cross. */
function isInert(element: Element): boolean {
    if (element.closest('[inert]') !== null) {
        return true;
    }
    const root = element.getRootNode();
    return root instanceof ShadowRoot && isInert(root.host);
}

/** The ring of a focus the pad moved: `:focus-visible` shows none on a programmatic focus after a mouse click. */
function showRing(element: Element | null): void {
    if (element instanceof HTMLElement) {
        element.style.outline = '3px solid var(--md-sys-color-secondary,Highlight)';
        element.addEventListener(
            'blur',
            () => {
                element.style.removeProperty('outline');
            },
            { once: true },
        );
    }
}

class Session implements GamepadSession {
    readonly #deps: GamepadDeps;
    readonly #buttons: ReadonlyMap<number, () => void>;
    #frame: number | null = null;
    #last: number | null = null;
    #held: ReadonlySet<number> = new Set();
    #greeted = false;
    #refused = false;

    readonly #onVisibility = (): void => {
        if (this.#deps.win.document.hidden) {
            this.#stop();
        } else {
            this.wake();
        }
    };

    constructor(deps: GamepadDeps) {
        this.#deps = deps;
        const command = (name: InputCommand) => (): void => {
            deps.surface.runInput(name);
        };
        this.#buttons = new Map([
            [
                0,
                () => {
                    this.#activate();
                },
            ],
            [
                1,
                () => {
                    this.#close();
                },
            ],
            [3, command('layers')],
            [4, command('photo-previous')],
            [5, command('photo-next')],
            [8, command('help')],
            [
                9,
                () => {
                    this.#fab()?.click();
                },
            ],
            [
                12,
                () => {
                    this.#moveFocus(-1);
                },
            ],
            [
                13,
                () => {
                    this.#moveFocus(1);
                },
            ],
            [14, command('year-previous')],
            [15, command('year-next')],
        ]);
        deps.win.document.addEventListener('visibilitychange', this.#onVisibility);
    }

    wake(): void {
        const pads = connectedPads(this.#deps.win);
        if (pads.some(isStandard)) {
            if (!this.#greeted) {
                this.#greeted = true;
                this.#deps.surface.toast('gamepad.ready');
            }
            this.#run();
        } else if (pads.length > 0 && !this.#refused) {
            this.#refused = true;
            this.#deps.surface.toast('gamepad.refused');
        }
    }

    #run(): void {
        if (this.#frame === null && !this.#deps.win.document.hidden) {
            this.#last = null;
            this.#schedule();
        }
    }

    #schedule(): void {
        this.#frame = this.#deps.win.requestAnimationFrame((now) => {
            this.#tick(now);
        });
    }

    #stop(): void {
        if (this.#frame !== null) {
            this.#deps.win.cancelAnimationFrame(this.#frame);
            this.#frame = null;
        }
    }

    #tick(now: number): void {
        this.#frame = null;
        const pad = connectedPads(this.#deps.win).find(isStandard);
        if (pad === undefined) {
            return;
        }
        if (this.#last !== null) {
            this.#move(pad, Math.min(now - this.#last, MAX_FRAME_MS) / 1000);
            this.#press(pad);
        }
        this.#held = held(pad);
        this.#last = now;
        this.#schedule();
    }

    #press(pad: Gamepad): void {
        const now = held(pad);
        for (const [index, action] of this.#buttons) {
            if (now.has(index) && !this.#held.has(index)) {
                action();
            }
        }
    }

    #move(pad: Gamepad, seconds: number): void {
        const { surface, map } = this.#deps;
        const [panX, panY] = stick(axisValue(pad, 0), axisValue(pad, 1));
        const [, zoomY] = stick(0, axisValue(pad, 3));
        const zoom = buttonValue(pad, RIGHT_TRIGGER) - buttonValue(pad, LEFT_TRIGGER) - zoomY;
        if (Math.hypot(panX, panY, zoom) === 0 || surface.mapCovered()) {
            return;
        }
        const pixels = PAN_PX_PER_S * seconds;
        map.flyTo(movedView(map.getView(), panX * pixels, panY * pixels, zoom * ZOOM_PER_S * seconds), { animate: false });
    }

    #fab(): HTMLElement | null {
        return this.#deps.surface.renderRoot.querySelector('hcm-fab-menu')?.shadowRoot?.querySelector<HTMLElement>('.fab') ?? null;
    }

    #active(): Element | null {
        return deepActiveElement(this.#deps.win.document);
    }

    /** What has the focus, or what Enter does on the map: the photo or place at its centre (`map/pointer.ts`). */
    #activate(): void {
        const active = this.#active();
        if (active instanceof HTMLElement && active !== this.#deps.win.document.body && active.localName !== 'canvas') {
            active.click();
        } else {
            this.#enterOnMap();
        }
    }

    #enterOnMap(): void {
        const canvas = this.#deps.surface.renderRoot.querySelector('canvas');
        if (canvas !== null && !this.#deps.surface.mapCovered()) {
            canvas.focus();
            canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        }
    }

    #close(): void {
        if (this.#deps.surface.renderRoot.querySelector('hcm-fab-menu')?.hasAttribute('open') === true) {
            this.#fab()?.click();
        } else {
            this.#deps.surface.runInput('close');
        }
    }

    /** Through the tabbable, non-inert controls; inside the open menu, its own arrow keys. */
    #moveFocus(step: number): void {
        const active = this.#active();
        if (active?.getAttribute('role') === 'menuitem') {
            active.dispatchEvent(new KeyboardEvent('keydown', { key: step > 0 ? 'ArrowDown' : 'ArrowUp', bubbles: true, composed: true }));
        } else {
            const list = tabbableElements(this.#deps.surface.renderRoot as ShadowRoot).filter((element) => !isInert(element));
            list[wrapped(list.indexOf(active as HTMLElement), step, list.length)]?.focus();
        }
        showRing(this.#active());
    }

    destroy(): void {
        this.#stop();
        this.#deps.win.document.removeEventListener('visibilitychange', this.#onVisibility);
    }
}

export function startGamepad(deps: GamepadDeps): GamepadSession {
    return new Session(deps);
}
