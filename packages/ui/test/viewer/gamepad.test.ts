import { FakeMap } from '@hcm/test-support/fake-map';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { movedView, startGamepad, stick, type GamepadSurface } from '../../src/viewer/gamepad/gamepad.js';
import type { PadWindow } from '../../src/viewer/gamepad/pads.js';
import { connectedPads } from '../../src/viewer/gamepad/pads.js';
import { watchGamepads } from '../../src/viewer/gamepad/watch.js';
import type { InputCommand } from '../../src/viewer/input-commands.js';

/** A fake pad, as the Gamepad API shows one (no real hardware in the tests). */
function fakePad(
    mapping: GamepadMappingType = 'standard',
): Gamepad & { axes: number[]; press(index: number, down?: boolean, value?: number): void } {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    return {
        id: 'fake',
        index: 0,
        connected: true,
        mapping,
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons,
        vibrationActuator: null,
        press(index: number, down = true, value = down ? 1 : 0) {
            const button = buttons[index];
            if (button !== undefined) {
                button.pressed = down;
                button.value = value;
            }
        },
    } as unknown as Gamepad & { axes: number[]; press(index: number, down?: boolean, value?: number): void };
}

/** A fake window: `frame(ms)` runs the scheduled animation frame; the document is real, its `hidden` is ours. */
class FakeWindow extends EventTarget {
    pads: (Gamepad | null)[] = [];
    hidden = false;
    readonly frames = new Map<number, FrameRequestCallback>();
    #next = 1;
    readonly navigator = { getGamepads: (): (Gamepad | null)[] => this.pads };
    readonly #visibility = new EventTarget();
    readonly document = Object.assign(this.#visibility, {
        body: document.body,
        activeElement: document.activeElement,
    }) as unknown as Document;

    constructor() {
        super();
        Object.defineProperty(this.document, 'hidden', { get: () => this.hidden });
        Object.defineProperty(this.document, 'activeElement', { get: () => document.activeElement });
    }

    requestAnimationFrame(callback: FrameRequestCallback): number {
        const id = this.#next;
        this.#next += 1;
        this.frames.set(id, callback);
        return id;
    }

    cancelAnimationFrame(id: number): void {
        this.frames.delete(id);
    }

    frame(now: number): void {
        const pending = [...this.frames.values()];
        this.frames.clear();
        for (const callback of pending) {
            callback(now);
        }
    }

    setHidden(hidden: boolean): void {
        this.hidden = hidden;
        this.document.dispatchEvent(new Event('visibilitychange'));
    }

    get asWindow(): PadWindow {
        return this as PadWindow;
    }
}

interface World {
    readonly win: FakeWindow;
    readonly map: FakeMap;
    readonly root: HTMLElement;
    readonly commands: InputCommand[];
    readonly toasts: string[];
    readonly surface: GamepadSurface;
    covered: boolean;
}

function world(): World {
    const root = document.createElement('div');
    document.body.append(root);
    const commands: InputCommand[] = [];
    const toasts: string[] = [];
    const state: World = {
        win: new FakeWindow(),
        map: new FakeMap(),
        root,
        commands,
        toasts,
        covered: false,
        surface: {
            renderRoot: root,
            runInput: (command) => {
                commands.push(command);
            },
            mapCovered: () => state.covered,
            toast: (key) => {
                toasts.push(key);
            },
        },
    };
    return state;
}

function session(w: World): ReturnType<typeof startGamepad> {
    return startGamepad({ win: w.win.asWindow, surface: w.surface, map: w.map, log: { warn: () => undefined } });
}

/** The loop's baseline frame: what is held now counts as held. */
function started(w: World, pad: Gamepad): ReturnType<typeof startGamepad> {
    w.win.pads = [pad];
    const pads = session(w);
    pads.wake();
    w.win.frame(1000);
    return pads;
}

describe('stick', () => {
    it('badPath_insideTheDeadZoneNothingMoves', () => {
        expect(stick(0.1, 0.05)).toEqual([0, 0]);
    });

    it('happyPath_pastTheDeadZoneItIsTheTilt', () => {
        expect(stick(1, 0)).toEqual([1, 0]);
        expect(stick(0.16, 0)).toEqual([0.16, 0]);
    });
});

describe('movedView', () => {
    const VIEW = { center: [26, 44] as [number, number], zoom: 14, bearing: 0 };

    it('happyPath_stickRightMovesEastAndDownMovesSouth', () => {
        const moved = movedView(VIEW, 100, 100, 0.5);

        expect(moved.center[0]).toBeGreaterThan(26);
        expect(moved.center[1]).toBeLessThan(44);
        expect(moved.zoom).toBe(14.5);
    });

    it('edge_aTurnedMapMovesAlongTheScreen', () => {
        const moved = movedView({ ...VIEW, bearing: 90 }, 100, 0, 0);

        expect(moved.center[0]).toBeCloseTo(26);
        expect(moved.center[1]).toBeLessThan(44);
    });
});

describe('connectedPads', () => {
    it('badPath_emptySlotsAndARefusingFrameAreNoPads', () => {
        const pad = fakePad();
        expect(connectedPads({ navigator: { getGamepads: () => [null, pad, null] } })).toEqual([pad]);
        const refusing = {
            getGamepads: (): (Gamepad | null)[] => {
                throw new DOMException('not allowed', 'SecurityError');
            },
        };
        expect(connectedPads({ navigator: refusing })).toEqual([]);
    });
});

describe('the gamepad session', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theLeftStickPansAndTheRightZoomsPastTheDeadZone', () => {
        const w = world();
        const pad = fakePad();
        started(w, pad);
        pad.axes[0] = 1;
        pad.axes[3] = -1;

        w.win.frame(1016);

        const [view] = w.map.callsOf('flyTo').at(-1) ?? [];
        expect((view as { center: [number, number] }).center[0]).toBeGreaterThan(0);
        expect((view as { zoom: number }).zoom).toBeGreaterThan(0);
        expect(w.map.callsOf('flyTo').at(-1)?.[1]).toEqual({ animate: false });
    });

    it('happyPath_theTriggersZoomByTheirValue', () => {
        const w = world();
        const pad = fakePad();
        started(w, pad);
        pad.press(7, true, 0.5);

        w.win.frame(1100);

        expect(w.map.view.zoom).toBeCloseTo(0.075);
    });

    it('badPath_aRestingPadOrACoveredMapMovesNothing', () => {
        const w = world();
        const pad = fakePad();
        started(w, pad);
        pad.axes[0] = 0.1;
        w.win.frame(1016);
        expect(w.map.callsOf('flyTo')).toEqual([]);

        w.covered = true;
        pad.axes[0] = 1;
        w.win.frame(1032);
        expect(w.map.callsOf('flyTo')).toEqual([]);
    });

    it('happyPath_eachButtonIsItsCommandOncePerPress', () => {
        const w = world();
        const pad = fakePad();
        started(w, pad);
        const presses: readonly (readonly [number, InputCommand])[] = [
            [3, 'layers'],
            [4, 'photo-previous'],
            [5, 'photo-next'],
            [8, 'help'],
            [14, 'year-previous'],
            [15, 'year-next'],
            [1, 'close'],
        ];
        let now = 1000;
        for (const [index, command] of presses) {
            pad.press(index);
            now += 16;
            w.win.frame(now);
            now += 16;
            w.win.frame(now);
            expect(w.commands.at(-1)).toBe(command);
            pad.press(index, false);
            now += 16;
            w.win.frame(now);
        }
        expect(w.commands).toHaveLength(presses.length);
    });

    it('edge_aButtonHeldBeforeTheLoopFiresNothing', () => {
        const w = world();
        const pad = fakePad();
        pad.press(5);
        started(w, pad);

        w.win.frame(1016);

        expect(w.commands).toEqual([]);
    });

    it('happyPath_startOpensTheMenuAndBClosesIt', () => {
        const w = world();
        const pad = fakePad();
        const menu = document.createElement('hcm-fab-menu');
        const shadow = menu.attachShadow({ mode: 'open' });
        const fab = document.createElement('button');
        fab.className = 'fab';
        let clicks = 0;
        fab.addEventListener('click', () => {
            clicks += 1;
        });
        shadow.append(fab);
        w.root.append(menu);
        started(w, pad);

        pad.press(9);
        w.win.frame(1016);
        expect(clicks).toBe(1);
        pad.press(9, false);
        menu.setAttribute('open', '');
        pad.press(1);
        w.win.frame(1032);

        expect(clicks).toBe(2);
        expect(w.commands).toEqual([]);
    });
});

/** A FAB menu in `w`, with its FAB's clicks counted, inside `parent` (the viewer's frame). */
function fabMenu(w: World, parent: HTMLElement = w.root): { readonly menu: HTMLElement; readonly clicks: () => number } {
    const menu = document.createElement('hcm-fab-menu');
    const fab = document.createElement('button');
    fab.className = 'fab';
    let clicks = 0;
    fab.addEventListener('click', () => {
        clicks += 1;
    });
    menu.attachShadow({ mode: 'open' }).append(fab);
    parent.append(menu);
    return { menu, clicks: () => clicks };
}

describe('the gamepad session: the menu and a modal surface', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_startUnderAModalLeavesTheMenuClosedAndBClosesTheModal', () => {
        const w = world();
        const pad = fakePad();
        const frame = document.createElement('div');
        frame.setAttribute('inert', '');
        w.root.append(frame);
        const { clicks } = fabMenu(w, frame);
        started(w, pad);

        pad.press(9);
        w.win.frame(1016);
        expect(clicks()).toBe(0);
        pad.press(9, false);
        pad.press(1);
        w.win.frame(1032);

        expect(clicks()).toBe(0);
        expect(w.commands).toEqual(['close']);
    });

    it('badPath_anOpenMenuTakesNoCommandAsItTakesNoShortcut', () => {
        const w = world();
        const pad = fakePad();
        const { menu } = fabMenu(w);
        menu.setAttribute('open', '');
        started(w, pad);

        pad.press(8);
        pad.press(3);
        w.win.frame(1016);

        expect(w.commands).toEqual([]);
    });
});

describe('the gamepad session: the ring', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    /** A command that moves the focus later, as Layers does after its render, and its first frames. */
    function focusAfterCommand(w: World, target: HTMLElement): void {
        w.root.append(target);
        w.surface.runInput = () => {
            queueMicrotask(() => {
                target.focus();
            });
        };
    }

    it('happyPath_aFocusACommandMovedGetsTheRingToo', async () => {
        const w = world();
        const pad = fakePad();
        const target = document.createElement('button');
        focusAfterCommand(w, target);
        started(w, pad);

        pad.press(3);
        w.win.frame(1016);
        await Promise.resolve();
        expect(document.activeElement).toBe(target);
        w.win.frame(1032);

        expect(target.style.outline).toContain('3px');
    });

    it('badPath_beforeAnyPressAFocusGetsNoRing', () => {
        const w = world();
        const pad = fakePad();
        const clicked = document.createElement('button');
        w.root.append(clicked);
        started(w, pad);

        clicked.focus();
        w.win.frame(1016);

        expect(document.activeElement).toBe(clicked);
        expect(clicked.style.outline).toBe('');
    });

    it('edge_aPageWithNothingFocusedDrawsNoRingOnTheBody', () => {
        const w = world();
        const pad = fakePad();
        started(w, pad);
        pad.press(5);
        w.win.frame(1016);

        expect(document.body.style.outline).toBe('');
    });

    it('edge_aRingLostToABlurComesBackWhenTheFocusReturns', () => {
        const w = world();
        const pad = fakePad();
        const target = document.createElement('button');
        w.root.append(target);
        started(w, pad);
        pad.press(13);
        w.win.frame(1016);
        pad.press(13, false);
        w.win.frame(1032);

        target.blur();
        expect(target.style.outline).toBe('');
        target.focus();
        w.win.frame(1048);

        expect(target.style.outline).toContain('3px');
    });
});

describe('the gamepad session: focus and A', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theDpadMovesAVisibleFocusSkippingInert', () => {
        const w = world();
        const pad = fakePad();
        const [first, inert, last] = [document.createElement('button'), document.createElement('button'), document.createElement('button')];
        const wall = document.createElement('div');
        wall.setAttribute('inert', '');
        wall.append(inert);
        w.root.append(first, wall, last);
        started(w, pad);

        pad.press(13);
        w.win.frame(1016);
        expect(document.activeElement).toBe(first);
        expect(first.style.outline).toContain('3px');
        pad.press(13, false);
        w.win.frame(1032);
        pad.press(13);
        w.win.frame(1048);
        expect(document.activeElement).toBe(last);
        expect(first.style.outline).toBe('');
        pad.press(13, false);
        w.win.frame(1064);
        pad.press(12);
        w.win.frame(1080);
        expect(document.activeElement).toBe(first);
    });

    it('edge_insideShadowHostsInertStillCounts', () => {
        const w = world();
        const pad = fakePad();
        const host = document.createElement('div');
        host.setAttribute('inert', '');
        const inner = host.attachShadow({ mode: 'open' });
        inner.append(document.createElement('button'));
        const free = document.createElement('button');
        w.root.append(host, free);
        started(w, pad);

        pad.press(13);
        w.win.frame(1016);

        expect(document.activeElement).toBe(free);
    });

    it('happyPath_insideTheMenuTheDpadSendsItsArrowKeys', () => {
        const w = world();
        const pad = fakePad();
        const item = document.createElement('button');
        item.setAttribute('role', 'menuitem');
        const seen: string[] = [];
        item.addEventListener('keydown', (event) => {
            seen.push(event.key);
        });
        w.root.append(item);
        item.focus();
        started(w, pad);

        pad.press(13);
        w.win.frame(1016);
        pad.press(13, false);
        pad.press(12);
        w.win.frame(1032);

        expect(seen).toEqual(['ArrowDown', 'ArrowUp']);
    });

    it('happyPath_aClicksWhatHasTheFocus', () => {
        const w = world();
        const pad = fakePad();
        const button = document.createElement('button');
        const click = vi.fn();
        button.addEventListener('click', click);
        w.root.append(button);
        button.focus();
        started(w, pad);

        pad.press(0);
        w.win.frame(1016);

        expect(click).toHaveBeenCalledOnce();
    });

    it('happyPath_aWithNoFocusDoesWhatEnterDoesOnTheMap', () => {
        const w = world();
        const pad = fakePad();
        const canvas = document.createElement('canvas');
        canvas.tabIndex = 0;
        const seen: string[] = [];
        canvas.addEventListener('keydown', (event) => {
            seen.push(event.key);
        });
        w.root.append(canvas);
        started(w, pad);

        pad.press(0);
        w.win.frame(1016);

        expect(seen).toEqual(['Enter']);
        expect(document.activeElement).toBe(canvas);
    });

    it('badPath_aOnACoveredMapDoesNothing', () => {
        const w = world();
        const pad = fakePad();
        const canvas = document.createElement('canvas');
        const seen = vi.fn();
        canvas.addEventListener('keydown', seen);
        w.root.append(canvas);
        w.covered = true;
        started(w, pad);

        pad.press(0);
        w.win.frame(1016);

        expect(seen).not.toHaveBeenCalled();
    });
});

describe('the gamepad session: its life', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_itGreetsOnceAStandardPad', () => {
        const w = world();
        const pad = fakePad();
        const pads = started(w, pad);

        pads.wake();

        expect(w.toasts).toEqual(['gamepad.ready']);
    });

    it('badPath_anotherMappingIsRefusedOnceAndNeverPolled', () => {
        const w = world();
        w.win.pads = [fakePad('')];
        const pads = session(w);

        pads.wake();
        pads.wake();

        expect(w.toasts).toEqual(['gamepad.refused']);
        expect(w.win.frames.size).toBe(0);
    });

    it('badPath_noPadsNoToastNoLoop', () => {
        const w = world();
        session(w).wake();

        expect(w.toasts).toEqual([]);
        expect(w.win.frames.size).toBe(0);
    });

    it('happyPath_itStopsWhileTheTabIsHiddenAndComesBackWithoutAPress', () => {
        const w = world();
        const pad = fakePad();
        started(w, pad);

        w.win.setHidden(true);
        expect(w.win.frames.size).toBe(0);

        pad.press(5);
        w.win.setHidden(false);
        expect(w.win.frames.size).toBe(1);
        w.win.frame(9000);
        w.win.frame(9016);

        expect(w.commands).toEqual([]);
    });

    it('edge_aHiddenTabDoesNotStartTheLoop', () => {
        const w = world();
        w.win.pads = [fakePad()];
        w.win.hidden = true;

        session(w).wake();

        expect(w.win.frames.size).toBe(0);
    });

    it('edge_theLoopEndsWhenThePadGoes', () => {
        const w = world();
        started(w, fakePad());

        w.win.pads = [null];
        w.win.frame(1016);

        expect(w.win.frames.size).toBe(0);
    });

    it('happyPath_destroyStopsEverything', () => {
        const w = world();
        const pads = started(w, fakePad());

        pads.destroy();
        expect(w.win.frames.size).toBe(0);
        w.win.setHidden(false);
        expect(w.win.frames.size).toBe(0);
    });

    it('edge_aPadWithMissingAxesAndButtonsReadsAsResting', () => {
        const w = world();
        const pad = Object.assign(fakePad(), { axes: [], buttons: [] });
        started(w, pad);

        w.win.frame(1016);

        expect(w.map.callsOf('flyTo')).toEqual([]);
    });
});

describe('watchGamepads', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    function deps(w: World): {
        readonly surface: GamepadSurface;
        readonly map: FakeMap;
        readonly log: { warn: (message: string) => void };
    } {
        return { surface: w.surface, map: w.map, log: { warn: vi.fn<(message: string) => void>() } };
    }

    it('happyPath_theChunkComesOnlyOnceAPadConnects', async () => {
        const w = world();
        const session = { wake: vi.fn(), destroy: vi.fn() };
        const load = vi.fn(() => Promise.resolve({ startGamepad: () => session }));
        const stop = watchGamepads(w.win.asWindow, load, deps(w));
        expect(load).not.toHaveBeenCalled();

        w.win.dispatchEvent(new Event('gamepadconnected'));
        w.win.dispatchEvent(new Event('gamepadconnected'));
        expect(load).toHaveBeenCalledOnce();
        await vi.waitFor(() => {
            expect(session.wake).toHaveBeenCalledTimes(2);
        });

        stop();
        await vi.waitFor(() => {
            expect(session.destroy).toHaveBeenCalledOnce();
        });
        w.win.dispatchEvent(new Event('gamepadconnected'));
        await Promise.resolve();
        expect(session.wake).toHaveBeenCalledTimes(2);
    });

    it('happyPath_aPadAlreadyRevealedLoadsAtOnce', () => {
        const w = world();
        w.win.pads = [fakePad()];
        const load = vi.fn(() => new Promise<never>(() => undefined));

        watchGamepads(w.win.asWindow, load, deps(w));

        expect(load).toHaveBeenCalledOnce();
    });

    it('badPath_aFailedChunkLogsAndTriesAgainAtTheNextPad', async () => {
        const w = world();
        const d = deps(w);
        const load = vi.fn(() => Promise.reject(new Error('offline')));
        watchGamepads(w.win.asWindow, load, d);

        w.win.dispatchEvent(new Event('gamepadconnected'));
        await vi.waitFor(() => {
            expect(d.log.warn).toHaveBeenCalledOnce();
        });

        await Promise.resolve();
        w.win.dispatchEvent(new Event('gamepadconnected'));
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('edge_stoppedWhileAFailingChunkLoadsNothingIsThrown', async () => {
        const w = world();
        const d = deps(w);
        const stop = watchGamepads(w.win.asWindow, () => Promise.reject(new Error('offline')), d);

        w.win.dispatchEvent(new Event('gamepadconnected'));
        stop();

        await vi.waitFor(() => {
            expect(d.log.warn).toHaveBeenCalledOnce();
        });
    });

    it('edge_stoppedWhileTheChunkLoadsTheSessionEndsAsItStarts', async () => {
        const w = world();
        const session = { wake: vi.fn(), destroy: vi.fn() };
        const stop = watchGamepads(w.win.asWindow, () => Promise.resolve({ startGamepad: () => session }), deps(w));

        w.win.dispatchEvent(new Event('gamepadconnected'));
        stop();

        await vi.waitFor(() => {
            expect(session.destroy).toHaveBeenCalledOnce();
        });
    });
});
