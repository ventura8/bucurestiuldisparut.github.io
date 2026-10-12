/**
 * Registers every viewer element once (idempotent per registry). The ui-kit elements the viewer renders (`hcm-sheet`,
 * `hcm-dialog`, `hcm-overlay-list`, `hcm-fab-menu`, `hcm-consent-banner`, ...) are registered by the kit's own
 * `defineUiKit`; the engine's `defineElements` calls both.
 */
import { defineHcmAboutDialog, HCM_ABOUT_DIALOG_TAG } from './hcm-about-dialog.js';
import { defineHcmErrorCard, HCM_ERROR_CARD_TAG } from './hcm-error-card.js';
import { defineHcmLayerPanel, HCM_LAYER_PANEL_TAG } from './hcm-layer-panel.js';
import { defineHcmLightbox, HCM_LIGHTBOX_TAG } from './hcm-lightbox.js';
import { defineHcmMapAttribution, HCM_MAP_ATTRIBUTION_TAG } from './hcm-map-attribution.js';
import { defineHcmMapViewer, HCM_MAP_VIEWER_TAG } from './hcm-map-viewer.js';
import { defineHcmPhotoList, HCM_PHOTO_LIST_TAG } from './hcm-photo-list.js';
import { defineHcmPhotoSheet, HCM_PHOTO_SHEET_TAG } from './hcm-photo-sheet.js';
import { defineHcmPoiDetail, HCM_POI_DETAIL_TAG } from './hcm-poi-detail.js';
import { defineHcmTimeline, HCM_TIMELINE_TAG } from './hcm-timeline.js';

/** Every tag the viewer defines (the kit's tags are listed by the kit). */
export const VIEWER_TAGS = [
    HCM_MAP_VIEWER_TAG,
    HCM_TIMELINE_TAG,
    HCM_LAYER_PANEL_TAG,
    HCM_PHOTO_SHEET_TAG,
    HCM_POI_DETAIL_TAG,
    HCM_PHOTO_LIST_TAG,
    HCM_LIGHTBOX_TAG,
    HCM_ABOUT_DIALOG_TAG,
    HCM_ERROR_CARD_TAG,
    HCM_MAP_ATTRIBUTION_TAG,
] as const;

const DEFINERS: readonly ((registry: CustomElementRegistry) => void)[] = [
    defineHcmMapViewer,
    defineHcmTimeline,
    defineHcmLayerPanel,
    defineHcmPhotoSheet,
    defineHcmPoiDetail,
    defineHcmPhotoList,
    defineHcmLightbox,
    defineHcmAboutDialog,
    defineHcmErrorCard,
    defineHcmMapAttribution,
];

/** Registers the viewer elements in `registry`; calling it again is a no-op. */
export function defineViewerElements(registry: CustomElementRegistry = customElements): void {
    for (const define of DEFINERS) {
        define(registry);
    }
}
