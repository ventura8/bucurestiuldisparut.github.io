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

export function createHandlers(host: HandlerHost): ViewerHandlers {
    const on =
        <E extends Event>(action: (store: ViewerStorePort, event: E) => void) =>
        (event: E): void => {
            host.act(event, (store) => {
                action(store, event);
            });
        };
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
        onPhotoSelect: on((store, event) => {
            selectPhoto(store, event.detail.photoId);
        }),
        onLightboxOpen: on((store) => {
            store.setLightbox(true);
        }),
        onLightboxClose: on((store) => {
            store.setLightbox(false);
        }),
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
        onToastDismiss: on((store) => {
            store.dismissToast();
        }),
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
