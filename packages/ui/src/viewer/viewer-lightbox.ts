/**
 * The full-size view in the viewer's modal layer (V08): `<hcm-lightbox>`, which the engine side-loads the first time it
 * opens (`lightbox-loader.ts`); until then the tag is an unknown element that keeps the properties set on it.
 */
import type { Locale, Photo, PhotoView } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { ViewerState } from './store-port.js';

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
