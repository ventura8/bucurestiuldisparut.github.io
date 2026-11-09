/**
 * The event handlers of `<hcm-map-viewer>`: each maps one viewer-internal event of a part (or a ui-kit event that
 * bubbles out of one) to a store action. `act` stops the event first, so none of them leaves the viewer: the page
 * sees only the public events of docs/ENGINE_API.md.
 */
import type { ViewerServices } from './services.js';
import type { ViewerStorePort } from './store-port.js';
import { closeSheet, isMenuAction, menuAction, selectPhoto, toggleCompare } from './viewer-actions.js';
import type { OverlayOpacityDetail, ViewerHandlers } from './viewer-render.js';

/** What the handlers need from the element. */
export interface HandlerHost {
    /** Stops `event` (when given) and runs `action` on the attached store, if any. */
    act(event: Event | null, action: (store: ViewerStorePort) => void): void;
    /** A slider moved (live) or was released (`final`). */
    setOpacity(store: ViewerStorePort, detail: OverlayOpacityDetail): void;
    services(): ViewerServices;
    focusTimeline(): void;
}

/** A handler that stops its event and runs `action` on the store. */
type On = <E extends Event>(action: (store: ViewerStorePort, event: E) => void) => (event: E) => void;

function actingOn(host: HandlerHost): On {
    return (action) => (event) => {
        host.act(event, (store) => {
            action(store, event);
        });
    };
}

/** The Layers panel's Map labels, the help panel's switch, and About's button to the panel. */
function inputHandlers(on: On): Pick<ViewerHandlers, 'onMapLabel' | 'onShortcuts' | 'onHelpOpen'> {
    return {
        onMapLabel: on((store, event) => {
            store.setMapLabels({ [event.detail.kind]: event.detail.visible });
        }),
        onShortcuts: on((store, event) => {
            store.setShortcuts(event.detail.enabled);
        }),
        onHelpOpen: on((store) => {
            store.openSheet('help');
        }),
    };
}

/** A photo to open, to show on the map (V51) or full size, and its thumbnail on screen. */
type PhotoHandlers = Pick<ViewerHandlers, 'onPhotoSelect' | 'onPhotoLocate' | 'onLightboxOpen' | 'onPhotoShown' | 'onLightboxClose'>;

function photoHandlers(on: On): PhotoHandlers {
    return {
        onPhotoSelect: on((store, event) => {
            selectPhoto(store, event.detail.photoId);
        }),
        onPhotoLocate: on((store, event) => {
            store.locatePhoto(event.detail.photoId, event.detail.offset);
        }),
        onLightboxOpen: on((store) => {
            store.setLightbox(true);
        }),
        onPhotoShown: on((store, event) => {
            store.photoShown?.(event.detail.ok);
        }),
        onLightboxClose: on((store) => {
            store.setLightbox(false);
        }),
    };
}

/** M17: a story to open (null: their list), and a place a story names. */
function storyHandlers(on: On): Pick<ViewerHandlers, 'onStorySelect' | 'onPoiSelect'> {
    return {
        onStorySelect: on((store, event) => {
            store.openStory(event.detail.storyId);
        }),
        onPoiSelect: on((store, event) => {
            store.openPoi(event.detail.poiId);
        }),
    };
}

/** The zoom buttons (V52): one level in (1) or out (-1); a click is no event of a part, nothing to stop. */
function zoomHandler(host: HandlerHost): Pick<ViewerHandlers, 'onZoom'> {
    return {
        onZoom: (step) => {
            host.act(null, (store) => {
                store.zoomBy(step);
            });
        },
    };
}

export function createHandlers(host: HandlerHost): ViewerHandlers {
    const on = actingOn(host);
    return {
        onYearChange: on((store, event) => {
            store.setYear(event.detail.year);
        }),
        onOverlayVisibility: on((store, event) => {
            store.toggleOverlay(event.detail.id, event.detail.visible);
        }),
        onOverlayOpacity: on((store, event) => {
            host.setOpacity(store, event.detail);
        }),
        onSheetClose: on(closeSheet),
        ...photoHandlers(on),
        onMenuSelect: on((store, event) => {
            const value = event.detail.value;
            if (isMenuAction(value)) {
                menuAction(store, host.services(), value);
            }
        }),
        onLocaleChange: on((store, event) => {
            store.setLocale(event.detail.locale);
        }),
        onThemeChange: on((store, event) => {
            store.setTheme(event.detail.theme);
        }),
        onConsent: on((store, event) => {
            store.setConsent(event.detail.decision);
        }),
        onRetry: on((store) => {
            void store.retry();
        }),
        onCompareToggle: on(toggleCompare),
        ...zoomHandler(host),
        onToastDismiss: on((store) => {
            store.dismissToast();
        }),
        ...inputHandlers(on),
        ...storyHandlers(on),
        onSkip: () => {
            host.focusTimeline();
        },
        onNearYear: () => {
            host.act(null, (store) => {
                store.openSheet('photos');
            });
        },
    };
}
