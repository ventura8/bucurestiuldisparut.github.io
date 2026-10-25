/**
 * A recording viewer store for the element tests: it implements `ViewerStorePort` with the same overlay model the
 * engine store uses (`@hcm/shared`), records every action in `calls`, and lets a test move the state with `set`.
 * The engine's real store is tested in `packages/engine`; this one only has to be faithful enough to drive the UI.
 */
import { isCompactHeight, windowClassFor } from '../../src/theme/tokens.js';
import type { SheetName, ThemeMode, ViewerState, ViewerStorePort } from '../../src/viewer/store-port.js';
import {
    overlaysFromManifest,
    withOverlayOpacity,
    withOverlayVisibility,
    type Locale,
    type Manifest,
    type MapView,
    type MessageKey,
} from '@hcm/shared';

import { testManifest } from './fixtures.js';

export interface StoreCall {
    readonly method: string;
    readonly args: readonly unknown[];
}

const VIEW: MapView = { center: [26.0853, 44.4271], zoom: 14.5, bearing: 0 };

/** A state before boot (no manifest yet). */
export function idleState(): ViewerState {
    return {
        status: 'idle',
        error: null,
        locale: 'ro',
        manifest: null,
        webgl: true,
        view: VIEW,
        year: null,
        overlays: [],
        selectedPhotoId: null,
        selectedPoiId: null,
        lightbox: false,
        sheet: 'none',
        windowClass: 'compact',
        compactHeight: false,
        theme: 'system',
        consent: 'unknown',
        toast: null,
        compare: null,
    };
}

/** A ready state with `manifest` (the test manifest by default) and its overlays at their defaults. */
export function readyState(manifest: Manifest = testManifest(), change: Partial<ViewerState> = {}): ViewerState {
    return { ...idleState(), status: 'ready', manifest, overlays: overlaysFromManifest(manifest), ...change };
}

export class FakeStore implements ViewerStorePort {
    readonly calls: StoreCall[] = [];
    #state: ViewerState;
    readonly #listeners = new Set<(state: ViewerState, previous: ViewerState) => void>();

    constructor(state: ViewerState = idleState()) {
        this.#state = state;
    }

    get listenerCount(): number {
        return this.#listeners.size;
    }

    getState(): ViewerState {
        return this.#state;
    }

    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /** Moves the state and notifies the subscribers (the engine store's contract). */
    set(change: Partial<ViewerState>): void {
        const previous = this.#state;
        this.#state = { ...previous, ...change };
        for (const listener of [...this.#listeners]) {
            listener(this.#state, previous);
        }
    }

    /** The calls of one action, in order. */
    callsOf(method: string): readonly (readonly unknown[])[] {
        return this.calls.filter((call) => call.method === method).map((call) => call.args);
    }

    #record(method: string, ...args: unknown[]): void {
        this.calls.push({ method, args });
    }

    retry(): Promise<void> {
        this.#record('retry');
        return Promise.resolve();
    }

    setLocale(locale: Locale): void {
        this.#record('setLocale', locale);
        this.set({ locale });
    }

    setYear(year: number | null): void {
        this.#record('setYear', year);
        this.set({ year });
    }

    toggleOverlay(overlayId: string, visible?: boolean): void {
        this.#record('toggleOverlay', overlayId, visible);
        this.set({ overlays: withOverlayVisibility(this.#state.overlays, overlayId, visible) });
    }

    setOverlayOpacity(overlayId: string, opacity: number, final?: boolean): void {
        this.#record('setOverlayOpacity', overlayId, opacity, final);
        const overlays = withOverlayOpacity(this.#state.overlays, overlayId, opacity);
        if (overlays !== this.#state.overlays) {
            this.set({ overlays });
        }
    }

    openPhoto(photoId: string | null): void {
        this.#record('openPhoto', photoId);
        this.set({ selectedPhotoId: photoId, sheet: photoId === null ? 'none' : 'photo', lightbox: false });
    }

    openPoi(poiId: string | null): void {
        this.#record('openPoi', poiId);
        this.set({ selectedPoiId: poiId, sheet: poiId === null ? 'none' : 'poi' });
    }

    setLightbox(open: boolean): void {
        this.#record('setLightbox', open);
        this.set({ lightbox: open });
    }

    openSheet(sheet: SheetName): void {
        this.#record('openSheet', sheet);
        this.set({ sheet });
    }

    setView(view: MapView): void {
        this.#record('setView', view);
        this.set({ view });
    }

    flyTo(view: MapView): void {
        this.#record('flyTo', view);
        this.set({ view });
    }

    logShare(): void {
        this.#record('logShare');
    }

    setWindowSize(width: number, height: number): void {
        this.#record('setWindowSize', width, height);
        this.set({ windowClass: windowClassFor(width), compactHeight: isCompactHeight(height) });
    }

    setTheme(theme: ThemeMode): void {
        this.#record('setTheme', theme);
        this.set({ theme });
    }

    setConsent(consent: 'granted' | 'denied'): void {
        this.#record('setConsent', consent);
        this.set({ consent });
    }

    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void {
        this.#record('showToast', key, params);
        this.set({ toast: params === undefined ? { key } : { key, params } });
    }

    dismissToast(): void {
        this.#record('dismissToast');
        this.set({ toast: null });
    }

    openCompare(layerId: string | null, position?: number): void {
        this.#record('openCompare', layerId, position);
        this.set({ compare: { layerId, position: position ?? this.#state.compare?.position ?? 0.5 } });
    }

    setComparePosition(position: number): void {
        this.#record('setComparePosition', position);
        const compare = this.#state.compare;
        if (compare !== null) {
            this.set({ compare: { ...compare, position } });
        }
    }

    closeCompare(): void {
        this.#record('closeCompare');
        this.set({ compare: null });
    }
}
