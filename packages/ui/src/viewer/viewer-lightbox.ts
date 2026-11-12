/**
 * The full-size view in the viewer's modal layer (V08): `<hcm-lightbox>`, which the engine side-loads the first time it
 * opens (`extras-loader.ts`); until then the tag is an unknown element that keeps the properties set on it. The map's
 * menu (V62) is side-loaded the same way, the first time it opens.
 */
import type { Locale, Photo, PhotoView } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { MenuPoint } from './map-menu-trigger.js';
import type { ViewerState } from './store-port.js';

/** The map's menu's events (V62). */
export interface MapMenuHandlers {
    readonly onMapMenuClose: (event: Event) => void;
    readonly onMapMenuCopy: (event: CustomEvent<{ readonly text: string }>) => void;
    /** Share a link to this view: the page's address, as the menu's Share. */
    readonly onMapMenuShare: (event: Event) => void;
}

/** The map's menu over the map (side-loaded with the full-size view; closed while `point` is null). */
export function mapMenu(
    view: { readonly locale: Locale; readonly mapMenu: MenuPoint | null },
    state: ViewerState,
    handlers: MapMenuHandlers,
): TemplateResult {
    return html`<hcm-map-menu
        .point=${view.mapMenu}
        .view=${state.view}
        .locale=${view.locale}
        @hcm-close=${handlers.onMapMenuClose}
        @hcm-map-menu-copy=${handlers.onMapMenuCopy}
        @hcm-map-menu-share=${handlers.onMapMenuShare}
    ></hcm-map-menu>`;
}

/** The full-size view's events, as the viewer handles them. */
export interface LightboxHandlers {
    readonly onPhotoSelect: (event: CustomEvent<{ readonly photoId: string }>) => void;
    /** `hcm-photo-version` of the sheet and the lightbox: the version the visitor picked. */
    readonly onPhotoVersion: (event: CustomEvent<{ readonly view: PhotoView }>) => void;
    readonly onLightboxClose: (event: Event) => void;
}

export function lightbox(
    state: ViewerState,
    photos: readonly Photo[],
    view: { readonly locale: Locale; readonly manifestUrl: string },
    handlers: LightboxHandlers,
): TemplateResult {
    return html`<hcm-lightbox
        .open=${state.lightbox && state.selectedPhotoId !== null}
        .photos=${photos}
        .photoId=${state.selectedPhotoId}
        .photoVersion=${state.photoVersion}
        .locale=${view.locale}
        .manifestUrl=${view.manifestUrl}
        @hcm-close=${handlers.onLightboxClose}
        @hcm-photo-select=${handlers.onPhotoSelect}
        @hcm-photo-version=${handlers.onPhotoVersion}
    ></hcm-lightbox>`;
}
