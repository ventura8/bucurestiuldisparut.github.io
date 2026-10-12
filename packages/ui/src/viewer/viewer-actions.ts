/**
 * What the viewer's controls do to the store: closing a sheet, opening a photo, the FAB menu's actions (sheets, share,
 * locate) and the language. Plain functions over `ViewerStorePort` and `ViewerServices`, so each is tested without
 * the element.
 */
import type { Locale, Manifest, MapView } from '@hcm/shared';

import { locateVisitor, shareMessage, sharePage, type ViewerServices } from './services.js';
import type { ViewerState, ViewerStorePort } from './store-port.js';
import { localizedText } from './text.js';

/** The camera zooms in at least this far on the visitor's position. */
export const LOCATE_ZOOM = 16;

/** The FAB menu's actions (`language` switches to the other language). */
const MENU_ACTIONS = ['layers', 'photos', 'locate', 'share', 'about', 'language'] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

export function isMenuAction(value: string): value is MenuAction {
    return (MENU_ACTIONS as readonly string[]).includes(value);
}

/** The viewer speaks two languages: the language item switches to the one not shown. */
export function otherLocale(locale: Locale): Locale {
    return locale === 'ro' ? 'en' : 'ro';
}

/** Closes whatever sheet is open: a photo's or a POI's details close their selection too. */
export function closeSheet(store: ViewerStorePort): void {
    const sheet = store.getState().sheet;
    if (sheet === 'photo') {
        store.openPhoto(null);
        return;
    }
    if (sheet === 'poi') {
        store.openPoi(null);
        return;
    }
    store.openSheet('none');
}

/** Opens a photo; the lightbox stays open when it was (its arrows step through the photos). */
export function selectPhoto(store: ViewerStorePort, photoId: string): void {
    const lightbox = store.getState().lightbox;
    store.openPhoto(photoId);
    if (lightbox) {
        store.setLightbox(true);
    }
}

/** Switches the store to `locale` unless it already shows it (the element's `lang` attribute follows the store). */
export function syncLocale(store: ViewerStorePort, locale: Locale): void {
    if (store.getState().locale !== locale) {
        store.setLocale(locale);
    }
}

/** The title a share uses: the open photo's title, else the city's name in `locale` (nothing before the manifest). */
export function shareTitle(manifest: Manifest | null, state: Pick<ViewerState, 'selectedPhotoId'>, locale: Locale): string {
    if (manifest === null) {
        return '';
    }
    const photo = manifest.photos.find((candidate) => candidate.id === state.selectedPhotoId);
    return photo === undefined ? manifest.city.name[locale] : localizedText(photo.title, locale);
}

/**
 * Shares the page (the hash carries the view) and says "copied" or "failed" when the clipboard was used; a page that
 * was shared or copied is logged as the `share` event (dropped by telemetry without consent).
 */
export async function shareViewer(store: ViewerStorePort, services: ViewerServices): Promise<void> {
    const state = store.getState();
    const outcome = await sharePage(services, shareTitle(state.manifest, state, state.locale));
    if (outcome === 'shared' || outcome === 'copied') {
        store.logShare();
    }
    const message = shareMessage(outcome);
    if (message !== null) {
        store.showToast(message);
    }
}

/** Moves the camera to the visitor when they are inside the city; otherwise says why it cannot. */
export async function locateViewer(store: ViewerStorePort, services: ViewerServices): Promise<void> {
    store.showToast('geolocate.locating');
    const result = await locateVisitor(services, store.getState().manifest?.city.bounds ?? null);
    if (!result.ok) {
        store.showToast(result.code);
        return;
    }
    store.dismissToast();
    const view: MapView = store.getState().view;
    store.flyTo({ ...view, center: result.center, zoom: Math.max(view.zoom, LOCATE_ZOOM) });
}

/** One FAB menu choice. */
export function menuAction(store: ViewerStorePort, services: ViewerServices, action: MenuAction): void {
    const actions: Readonly<Record<MenuAction, () => void>> = {
        layers: () => {
            store.openSheet('layers');
        },
        photos: () => {
            store.openSheet('photos');
        },
        about: () => {
            store.openSheet('about');
        },
        share: () => {
            void shareViewer(store, services);
        },
        locate: () => {
            void locateViewer(store, services);
        },
        language: () => {
            store.setLocale(otherLocale(store.getState().locale));
        },
    };
    actions[action]();
}
