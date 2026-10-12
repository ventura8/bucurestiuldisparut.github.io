/**
 * `<hcm-map-viewer>`: the public element of the engine (docs/ENGINE_API.md → `<hcm-map-viewer>`). It renders the
 * viewer store's state (`store-port.ts`) in its shadow root, adapts its layout to its own size (window classes from
 * a ResizeObserver, container queries for the rest), maps the parts' events to store actions and fires the public
 * events. The engine (`@hcm/engine` `mount`) creates the store and the map and `attach`es them; a declarative element
 * (`<hcm-map-viewer manifest-url=...>`) asks the engine to do so through `setViewerBootstrap` when it connects.
 *
 * It never touches the map or the URL hash: the store does. The map container is a stable `<div>` in the shadow root
 * (`mapContainer`); mapbox-gl.css is linked inside the shadow root (`mapboxCssUrl`), the city theme is adopted on the
 * host (`applyTheme`).
 */
import { resolveLocale, type ThemeTokens } from '@hcm/shared';
import { LitElement, type TemplateResult } from 'lit';

import { deepActiveElement, restoreFocus } from '../components/focus.js';
import { applyTheme } from '../theme/apply.js';
import { BASELINE_THEME } from '../theme/baseline.js';
import { OverlayChangeTracker, overlayEvents, viewerEvents, type PublicEvent } from './events.js';
import type { HcmTimeline } from './hcm-timeline.js';
import { layoutFor, type ViewerLayout } from './layout.js';
import { browserServices, type ViewerServices } from './services.js';
import type { Unsubscribe, ViewerController, ViewerError, ViewerState, ViewerStorePort } from './store-port.js';
import { timelineStops, type TimelineStop } from './timeline-model.js';
import { syncLocale } from './viewer-actions.js';
import { createHandlers } from './viewer-handlers.js';
import { renderViewer, type OverlayOpacityDetail, type ViewerHandlers } from './viewer-render.js';
import { viewerStyles } from './viewer-styles.js';

export const HCM_MAP_VIEWER_TAG = 'hcm-map-viewer';

/** Boots a declarative `<hcm-map-viewer>` from its attributes (set by the engine's `defineElements`). */
export type ViewerBootstrap = (element: HcmMapViewer) => void;

let bootstrap: ViewerBootstrap | null = null;

/** The engine's boot function for declarative elements (`@hcm/engine` `defineElements` sets it; null clears it). */
export function setViewerBootstrap(boot: ViewerBootstrap | null): void {
    bootstrap = boot;
}

function layoutOf(state: ViewerState | null): ViewerLayout {
    return state === null ? layoutFor('compact', false) : layoutFor(state.windowClass, state.compactHeight);
}

function stopsOf(state: ViewerState | null): readonly TimelineStop[] {
    return timelineStops(state?.manifest?.layers ?? []);
}

/** The city's colour tokens, or the baseline theme until a manifest is loaded. */
function tokensOf(state: ViewerState | null): ThemeTokens {
    return state?.manifest?.city.theme.tokens ?? BASELINE_THEME;
}

/** A copy of `state` before boot: the starting point of the events of a store attached in any state. */
function idleOf(state: ViewerState): ViewerState {
    return { ...state, status: 'idle', selectedPhotoId: null, selectedPoiId: null };
}

type Opener = 'sheet' | 'lightbox';

export class HcmMapViewer extends LitElement {
    static override readonly properties = {
        manifestUrl: { type: String, attribute: 'manifest-url' },
        cityId: { type: String, attribute: 'city-id' },
        engineBase: { type: String, attribute: 'engine-base' },
        manifest: { attribute: false },
        bootError: { attribute: false },
        services: { attribute: false },
        mapboxCssUrl: { attribute: false },
        engineVersion: { attribute: false },
        viewState: { state: true },
    };

    static override readonly styles = viewerStyles;

    /** The native `lang` attribute is observed too: setting it switches the language live. */
    static override get observedAttributes(): string[] {
        return [...super.observedAttributes, 'lang'];
    }

    declare manifestUrl: string;
    declare cityId: string;
    declare engineBase: string;
    /** An inline City Manifest v1 (set it before the element is connected). */
    declare manifest: unknown;
    /** A boot error found before any store exists (an invalid configuration). */
    declare bootError: ViewerError | null;
    declare services: ViewerServices;
    declare mapboxCssUrl: string;
    declare engineVersion: string;
    declare viewState: ViewerState | null;

    #store: ViewerStorePort | null = null;
    #controller: ViewerController | null = null;
    #unsubscribe: Unsubscribe = () => undefined;
    readonly #tracker = new OverlayChangeTracker();
    readonly #openers: Record<Opener, Element | null> = { sheet: null, lightbox: null };
    readonly #resizeObserver = new ResizeObserver((entries) => {
        this.#onResize(entries);
    });

    readonly #handlers: ViewerHandlers = createHandlers({
        act: (event, action) => {
            this.#act(event, action);
        },
        setOpacity: (store, detail) => {
            this.#setOpacity(store, detail);
        },
        services: () => this.services,
        focusTimeline: () => {
            this.renderRoot.querySelector<HcmTimeline>('#timeline')?.focus();
        },
    });

    constructor() {
        super();
        this.manifestUrl = '';
        this.cityId = '';
        this.engineBase = '';
        this.manifest = undefined;
        this.bootError = null;
        this.services = browserServices(window);
        this.mapboxCssUrl = '';
        this.engineVersion = '';
        this.viewState = null;
    }

    /** The controller `mount` returned for this element; null before the engine attached one. */
    get controller(): ViewerController | null {
        return this.#controller;
    }

    /** The element the map is mounted into (exists after the first render: await `updateComplete`). */
    get mapContainer(): HTMLElement | null {
        return this.renderRoot.querySelector<HTMLElement>('.map');
    }

    /** Connects the viewer to a store (and the controller that drives it); the current state renders at once. */
    attach(store: ViewerStorePort, controller: ViewerController | null): void {
        this.detach();
        this.#store = store;
        this.#controller = controller;
        const state = store.getState();
        this.#onState(state, idleOf(state));
        this.#subscribe();
    }

    /** Disconnects the store; the element shows its loading state again. */
    detach(): void {
        this.#unsubscribe();
        this.#unsubscribe = () => undefined;
        this.#store = null;
        this.#controller = null;
        this.viewState = null;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#resizeObserver.observe(this);
        this.#applyTheme(this.viewState);
        this.#subscribe();
        if (this.#store === null && this.bootError === null) {
            bootstrap?.(this);
        }
    }

    override disconnectedCallback(): void {
        this.#resizeObserver.disconnect();
        this.#unsubscribe();
        this.#unsubscribe = () => undefined;
        super.disconnectedCallback();
    }

    override attributeChangedCallback(name: string, old: string | null, value: string | null): void {
        super.attributeChangedCallback(name, old, value);
        if (name === 'lang') {
            this.#act(null, (store) => {
                syncLocale(store, resolveLocale(value));
            });
        }
    }

    override render(): TemplateResult {
        const state = this.viewState;
        const view = {
            state,
            bootError: this.bootError,
            layout: layoutOf(state),
            locale: state === null ? resolveLocale(this.getAttribute('lang')) : state.locale,
            stops: stopsOf(state),
            manifestUrl: this.manifestUrl,
            engineVersion: this.engineVersion,
            mapboxCssUrl: this.mapboxCssUrl,
        };
        return renderViewer(view, this.#handlers);
    }

    #subscribe(): void {
        const store = this.#store;
        if (store === null || !this.isConnected) {
            return;
        }
        this.#unsubscribe();
        this.#unsubscribe = store.subscribe((state, previous) => {
            this.#onState(state, previous);
        });
    }

    #onState(state: ViewerState, previous: ViewerState): void {
        this.viewState = state;
        this.#dispatchAll(viewerEvents(previous, state, this.#tracker, this.engineVersion));
        if (this.getAttribute('lang') !== state.locale) {
            this.setAttribute('lang', state.locale);
            this.ownerDocument.documentElement.lang = state.locale;
        }
        if (state.theme !== previous.theme || state.manifest !== previous.manifest) {
            this.#applyTheme(state);
        }
        this.#trackOpener('sheet', previous.sheet !== 'none', state.sheet !== 'none');
        this.#trackOpener('lightbox', previous.lightbox, state.lightbox);
    }

    #applyTheme(state: ViewerState | null): void {
        if (this.isConnected) {
            applyTheme(this, tokensOf(state), state === null ? 'system' : state.theme, false);
        }
    }

    /**
     * Remembers what had focus when a sheet or the lightbox opened, and returns focus there once it is closed after
     * the render (a close that is undone in the same turn, such as stepping to the next photo, keeps the opener).
     */
    #trackOpener(kind: Opener, wasOpen: boolean, isOpen: boolean): void {
        if (wasOpen === isOpen) {
            return;
        }
        if (isOpen) {
            this.#openers[kind] ??= deepActiveElement(this.ownerDocument);
            return;
        }
        void this.updateComplete.then(() => {
            this.#restoreOpener(kind);
        });
    }

    #restoreOpener(kind: Opener): void {
        if (this.#isOpen(kind)) {
            return;
        }
        restoreFocus(this.#openers[kind]);
        this.#openers[kind] = null;
    }

    #isOpen(kind: Opener): boolean {
        const state = this.viewState;
        if (state === null) {
            return false;
        }
        return kind === 'lightbox' ? state.lightbox : state.sheet !== 'none';
    }

    #dispatchAll(events: readonly PublicEvent[]): void {
        for (const event of events) {
            this.dispatchEvent(new CustomEvent(event.type, { detail: event.detail, bubbles: true, composed: true }));
        }
    }

    /** Runs `action` on the attached store; the event (a part's viewer-internal event) never leaves the viewer. */
    #act(event: Event | null, action: (store: ViewerStorePort) => void): void {
        event?.stopPropagation();
        const store = this.#store;
        if (store !== null) {
            action(store);
        }
    }

    /** A slider's live value goes to the store at once; its release also fires the settled public events. */
    #setOpacity(store: ViewerStorePort, detail: OverlayOpacityDetail): void {
        this.#tracker.drag(detail.id, detail.final);
        store.setOverlayOpacity(detail.id, detail.opacity, detail.final);
        if (detail.final) {
            const state = store.getState();
            this.#dispatchAll(overlayEvents(this.#tracker.changes(state.overlays), state.manifest));
        }
    }

    /** The viewer's own box decides its window class (the map adapter follows its container by itself). */
    #onResize(entries: readonly ResizeObserverEntry[]): void {
        for (const entry of entries) {
            this.#act(null, (store) => {
                store.setWindowSize(entry.contentRect.width, entry.contentRect.height);
            });
        }
    }
}

/** Registers `<hcm-map-viewer>` once; calling it again is a no-op. */
export function defineHcmMapViewer(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_MAP_VIEWER_TAG) === undefined) {
        registry.define(HCM_MAP_VIEWER_TAG, HcmMapViewer);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-map-viewer': HcmMapViewer;
    }
}
