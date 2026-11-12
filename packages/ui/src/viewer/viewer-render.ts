/**
 * The template of `<hcm-map-viewer>`, split by region: the frame (panes per window class), the map pane with its
 * status layer (skeleton, error card, no-WebGL fallback) and floating controls, the modal layer (the modal sheets, the
 * About dialog and the lightbox) and, while a modal surface covers the map, the legal bar with the Mapbox logo and
 * attribution (scenario V18: Mapbox's own controls are hidden then, never covered). Every floating control carries
 * `data-layout-check` (its name): the e2e tour checks that no two of them overlap at any viewport
 * (docs/research/design-review-testability.md §4.3). Every function takes the view (state plus derived values) and
 * the element's handlers; none keeps state. The map container is the one static `<div class="map">`: Lit never
 * re-creates it, so the Mapbox canvas that the engine mounts into it survives every render.
 */
import { translate, type Locale, type Manifest, type Photo, type Poi, type PoiCategory } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';
import { keyed } from 'lit/directives/keyed.js';

import type { CameraOffset } from '../map/mapbox-types.js';
import type { AttributionPart } from './attribution.js';
import { EMPTY } from './empty.js';
import type { MapLabelDetail } from './hcm-layer-panel.js';
import { dialogMode, isDialogSheet } from './input-commands.js';
import { DOCKED_OPEN, type Placement, type SheetMode, type ViewerLayout } from './layout.js';
import { renderSheetFrame } from './sheet-frame.js';
import type { ViewerError, ViewerState } from './store-port.js';
import { photosNearYear, type TimelineStop } from './timeline-model.js';
import { lightbox, type LightboxHandlers } from './viewer-lightbox.js';
import { menuActions, menuItem } from './viewer-menu.js';
import { nearYearChip } from './viewer-near-year.js';
import { storiesSheet } from './viewer-stories.js';
import { unplacedSheet } from './viewer-unplaced.js';
import { zoomButtons, type MapSize } from './viewer-zoom.js';
import { legalMirror, modalOpen, renderConsentBanner, renderLegalBar, type LegalMirror } from './viewer-legal.js';

/** What one render needs, derived from the store state by the element. */
export interface ViewerView {
    readonly state: ViewerState | null;
    readonly bootError: ViewerError | null;
    readonly layout: ViewerLayout;
    readonly locale: Locale;
    readonly stops: readonly TimelineStop[];
    readonly manifestUrl: string;
    readonly engineVersion: string;
    readonly mapboxCssUrl: string;
    /** The map's attribution as Mapbox GL shows it (`watchAttribution`), for the legal bar and About. */
    readonly attribution: readonly AttributionPart[];
    /** The map container's box (null before the first render): Zoom out's limit (`viewer-zoom.ts`). */
    readonly mapSize: MapSize | null;
}

/** `hcm-photo-locate` of `<hcm-photo-sheet>`: the photo, and its place's offset from the map's centre (`locateOffset`). */
interface PhotoLocateDetail {
    readonly photoId: string;
    readonly offset: CameraOffset;
}

/** `hcm-overlay-opacity` of `<hcm-overlay-list>`: `final` is false while dragging, true on release. */
export interface OverlayOpacityDetail {
    readonly id: string;
    readonly opacity: number;
    readonly final: boolean;
}

/** The element's event handlers, bound once. */
export interface ViewerHandlers extends LightboxHandlers {
    readonly onYearChange: (event: CustomEvent<{ readonly year: number | null }>) => void;
    readonly onOverlayVisibility: (event: CustomEvent<{ readonly id: string; readonly visible: boolean }>) => void;
    readonly onOverlayOpacity: (event: CustomEvent<OverlayOpacityDetail>) => void;
    readonly onSheetClose: (event: Event) => void;
    /** The photo sheet's "Show on map" (V51). */
    readonly onPhotoLocate: (event: CustomEvent<PhotoLocateDetail>) => void;
    /** M17: a story to open (null: their list), and a place a story names. */
    readonly onStorySelect: (event: CustomEvent<{ readonly storyId: string | null }>) => void;
    readonly onPoiSelect: (event: CustomEvent<{ readonly poiId: string }>) => void;
    readonly onLightboxOpen: (event: Event) => void;
    /** The photo sheet's thumbnail was decoded (or failed): the `photo_timing` field measurement. */
    readonly onPhotoShown: (event: CustomEvent<{ readonly ok: boolean }>) => void;
    readonly onMenuSelect: (event: CustomEvent<{ readonly value: string }>) => void;
    readonly onLocaleChange: (event: CustomEvent<{ readonly locale: Locale }>) => void;
    readonly onThemeChange: (event: CustomEvent<{ readonly theme: ViewerState['theme'] }>) => void;
    readonly onConsent: (event: CustomEvent<{ readonly decision: 'granted' | 'denied' }>) => void;
    readonly onRetry: (event: Event) => void;
    /** The Layers panel's Compare button (M4, V06). */
    readonly onCompareToggle: (event: Event) => void;
    /** The Layers panel's Map labels switches (V31). */
    readonly onMapLabel: (event: CustomEvent<MapLabelDetail>) => void;
    /** The extra-large Layers pane minimized to its rail, or restored (V03). */
    readonly onLayersMinimize: (event: CustomEvent<{ readonly minimized: boolean }>) => void;
    readonly onToastDismiss: (event: Event) => void;
    /** The zoom buttons: one level in (1) or out (-1). */
    readonly onZoom: (step: number) => void;
    /** The help panel's switch of the single-key shortcuts. */
    readonly onShortcuts: (event: CustomEvent<{ readonly enabled: boolean }>) => void;
    /** About's button to the help panel. */
    readonly onHelpOpen: (event: Event) => void;
    readonly onSkip: () => void;
    readonly onNearYear: () => void;
}

/** A ready viewer: the state with its manifest. */
interface Ready {
    readonly state: ViewerState;
    readonly manifest: Manifest;
}

function readyOf(view: ViewerView): Ready | null {
    const state = view.state;
    return state?.status === 'ready' && state.manifest !== null ? { state, manifest: state.manifest } : null;
}

type DockedSheet = 'layers' | 'photo' | 'poi' | 'photos' | 'unplaced' | 'stories';

/** About is always a dialog; the layers panel has its own pane when it is always docked. */
function isDockable(sheet: ViewerState['sheet'], layersDocked: boolean): sheet is DockedSheet {
    return ['photo', 'poi', 'photos', 'unplaced', 'stories'].includes(sheet) || (sheet === 'layers' && !layersDocked);
}

/** The sheet that shows in the docked trailing pane, if any. */
function dockedSheet(view: ViewerView, ready: Ready | null): DockedSheet | 'none' {
    if (ready === null || view.layout.sheetMode !== 'docked') {
        return 'none';
    }
    const sheet = ready.state.sheet;
    return isDockable(sheet, view.layout.layersDocked) ? sheet : 'none';
}

type Panes = 'none' | 'leading' | 'trailing' | 'both';

function panes(view: ViewerView, ready: Ready | null): Panes {
    const trailing = dockedSheet(view, ready) !== 'none';
    if (ready !== null && view.layout.layersDocked) {
        return trailing ? 'both' : 'leading';
    }
    return trailing ? 'trailing' : 'none';
}

function hasTimeline(view: ViewerView, ready: Ready | null): boolean {
    return ready !== null && ready.state.webgl && view.stops.length > 1;
}

/** A city without historical layers yet (Bucharest until M3) has no timeline: a note says the layers are coming. */
function timelineArea(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    if (hasTimeline(view, ready)) {
        return timeline(view, ready.state, handlers);
    }
    return ready.state.webgl ? timelineNote(view.locale) : EMPTY;
}

function timelineNote(locale: Locale): TemplateResult {
    return html`<div class="dock timeline-note">
        <p class="note" data-layout-check="timeline-note">
            <hcm-icon name="timeline"></hcm-icon><span>${translate(locale, 'timeline.empty')}</span>
        </p>
    </div>`;
}

export function renderViewer(view: ViewerView, handlers: ViewerHandlers): TemplateResult {
    const ready = readyOf(view);
    const legal = legalMirror(view.state, view.layout.sheetMode);
    return html`${stylesheet(view)}
        <div class="viewer">
            <div
                class="frame"
                data-panes=${panes(view, ready)}
                ?data-compact-height=${view.state?.compactHeight === true}
                data-timeline=${hasTimeline(view, ready) ? view.layout.timeline : nothing}
                ?data-legal-mirror=${legal !== 'none'}
                ?inert=${modalOpen(view.state, view.layout.sheetMode)}
            >
                ${skipLink(view, ready, handlers)} ${leadingPane(view, ready, handlers)}
                <div class="map-pane">
                    <div class="map" role="region" aria-label=${mapLabel(view, ready)}></div>
                    ${statusLayer(view, handlers)} ${ready === null ? nothing : controls(view, ready, handlers)}
                </div>
                ${trailingPane(view, ready, handlers)}
            </div>
            ${ready === null ? nothing : modalLayer(view, ready, legal, handlers)}
        </div>`;
}

/**
 * The modal surfaces in their own grid row, which ends where the legal bar begins: a sheet, its scrim or the lightbox
 * never covers the logo and the attribution (the frame, and so the map, keeps the whole height).
 */
function modalLayer(view: ViewerView, ready: Ready, legal: LegalMirror, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="modal-layer">${overlays(view, ready, legal, handlers)}</div>
        ${legal === 'bar' ? renderLegalBar(view.attribution, view.locale, view.mapboxCssUrl) : nothing}`;
}

/** mapbox-gl.css inside the shadow root (the page's copy cannot reach it); the browser reuses its cached file. */
function stylesheet(view: ViewerView): TemplateResult {
    return view.mapboxCssUrl === '' ? EMPTY : html`<link rel="stylesheet" href=${view.mapboxCssUrl} />`;
}

function mapLabel(view: ViewerView, ready: Ready | null): string {
    return translate(view.locale, 'viewer.mapLabel', { city: ready === null ? '' : ready.manifest.city.name[view.locale] });
}

function skipLink(view: ViewerView, ready: Ready | null, handlers: ViewerHandlers): TemplateResult {
    return hasTimeline(view, ready)
        ? html`<button type="button" class="skip" @click=${handlers.onSkip}>${translate(view.locale, 'viewer.skipToTimeline')}</button>`
        : EMPTY;
}

function leadingPane(view: ViewerView, ready: Ready | null, handlers: ViewerHandlers): TemplateResult {
    return ready !== null && view.layout.layersDocked
        ? html`<div class="pane leading">${layerPanel(view, ready, { ...DOCKED_OPEN, minimizable: true }, handlers)}</div>`
        : EMPTY;
}

function statusLayer(view: ViewerView, handlers: ViewerHandlers): TemplateResult {
    const state = view.state;
    if (state === null) {
        return view.bootError === null ? skeleton(view.locale) : errorLayer(view.bootError, view.locale, handlers);
    }
    if (!state.webgl && state.manifest !== null) {
        return noWebgl(view, state.manifest, handlers);
    }
    return stateLayer(view, state, handlers);
}

function stateLayer(view: ViewerView, state: ViewerState, handlers: ViewerHandlers): TemplateResult {
    if (state.status === 'error' && state.error !== null) {
        return errorLayer(state.error, view.locale, handlers);
    }
    return state.status === 'ready' ? EMPTY : skeleton(view.locale);
}

/**
 * The boot state: the kit's M3 Expressive loading indicator (a wait of a few seconds). A linear `hcm-progress` has no
 * width of its own and collapsed to nothing in this centred grid, so the screen showed only the static shimmer.
 */
function skeleton(locale: Locale): TemplateResult {
    return html`<div class="status">
        <div class="skeleton" role="status">
            <hcm-loading-indicator .label=${translate(locale, 'viewer.loading')}></hcm-loading-indicator>
            <div class="shimmer"></div>
            <p>${translate(locale, 'viewer.loading')}</p>
        </div>
    </div>`;
}

function errorLayer(error: ViewerError, locale: Locale, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="status">
        <hcm-error-card .error=${error} .locale=${locale} @hcm-retry=${handlers.onRetry}></hcm-error-card>
    </div>`;
}

/** The consent card is asked while analytics is set up and the visitor has not answered yet. */
function consentAsked(state: ViewerState | null, manifest: Manifest): boolean {
    return manifest.city.analytics.measurementId !== undefined && state?.consent === 'unknown';
}

function noWebgl(view: ViewerView, manifest: Manifest, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="status">
        <div class="fallback">
            <hcm-error-card .error=${{ code: 'error.webgl', retryable: false }} .locale=${view.locale}></hcm-error-card>
            ${consentAsked(view.state, manifest) ? renderConsentBanner(view.locale, handlers.onConsent, false) : nothing}
            <hcm-photo-list
                .photos=${manifest.photos}
                .locale=${view.locale}
                .manifestUrl=${view.manifestUrl}
                @hcm-photo-select=${handlers.onPhotoSelect}
            ></hcm-photo-list>
        </div>
    </div>`;
}

function controls(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const { state, manifest } = ready;
    // Without a map the consent card is in the fallback's column (`noWebgl`).
    const consent = state.webgl && consentAsked(state, manifest);
    const items = menuActions({ webgl: state.webgl, layersDocked: view.layout.layersDocked, manifest }).map((action) =>
        menuItem(action, view.locale, state.myLocation !== null),
    );
    return html`${timelineArea(view, ready, handlers)} ${nearYearChip(view, ready.state.year, ready.manifest.photos, handlers.onNearYear)}
        <div class="dock menu">
            <hcm-fab-menu
                data-layout-check="menu"
                icon="menu"
                .label=${translate(view.locale, 'action.menu')}
                .closeLabel=${translate(view.locale, 'action.close')}
                .items=${items}
                @hcm-select=${handlers.onMenuSelect}
            ></hcm-fab-menu>
        </div>
        ${state.webgl ? zoomButtons(view, state.view, manifest, handlers.onZoom) : nothing}
        ${consent ? renderConsentBanner(view.locale, handlers.onConsent) : nothing} ${toast(view, state, handlers)}`;
}

function timeline(view: ViewerView, state: ViewerState, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="dock timeline">
        <hcm-timeline
            id="timeline"
            data-layout-check="timeline"
            .stops=${view.stops}
            .value=${state.year}
            .locale=${view.locale}
            .orientation=${view.layout.timeline}
            @hcm-year-change=${handlers.onYearChange}
        ></hcm-timeline>
    </div>`;
}

function toast(view: ViewerView, state: ViewerState, handlers: ViewerHandlers): TemplateResult {
    const current = state.toast;
    if (current === null) {
        return EMPTY;
    }
    return html`<div class="dock toast">
        ${keyed(
            current,
            html`<hcm-snackbar
                data-layout-check="toast"
                .message=${translate(view.locale, current.key, current.params)}
                .closeLabel=${translate(view.locale, 'action.close')}
                @hcm-dismiss=${handlers.onToastDismiss}
            ></hcm-snackbar>`,
        )}
    </div>`;
}

function layerPanel(view: ViewerView, ready: Ready, placement: Placement, handlers: ViewerHandlers): TemplateResult {
    return html`<hcm-layer-panel
        .overlays=${ready.state.overlays}
        .manifest=${ready.manifest}
        .locale=${view.locale}
        .mode=${placement.mode}
        .open=${placement.open}
        .minimizable=${placement.minimizable === true}
        .minimized=${ready.state.layersHidden}
        .canCompare=${ready.state.webgl && ready.manifest.layers.length > 0}
        .comparing=${ready.state.compare !== null}
        .labels=${ready.state.webgl ? ready.state.mapLabels : null}
        ?inert=${placement.inert === true}
        @hcm-close=${handlers.onSheetClose}
        @hcm-overlay-visibility=${handlers.onOverlayVisibility}
        @hcm-overlay-opacity=${handlers.onOverlayOpacity}
        @hcm-compare-toggle=${handlers.onCompareToggle}
        @hcm-map-label=${handlers.onMapLabel}
        @hcm-layers-minimize=${handlers.onLayersMinimize}
    ></hcm-layer-panel>`;
}

interface Selection {
    readonly photo: Photo | null;
    readonly poi: Poi | null;
    readonly category: PoiCategory | null;
}

function selectedPoi(ready: Ready): Poi | null {
    if (ready.state.sheet !== 'poi') {
        return null;
    }
    return (ready.manifest.pois ?? []).find((candidate) => candidate.id === ready.state.selectedPoiId) ?? null;
}

function categoryOf(manifest: Manifest, poi: Poi | null): PoiCategory | null {
    return poi === null ? null : ((manifest.poiCategories ?? []).find((candidate) => candidate.id === poi.category) ?? null);
}

function selection(ready: Ready): Selection {
    const poi = selectedPoi(ready);
    const photo = ready.manifest.photos.find((candidate) => candidate.id === ready.state.selectedPhotoId) ?? null;
    return { photo, poi, category: categoryOf(ready.manifest, poi) };
}

function photoSheet(view: ViewerView, ready: Ready, placement: Placement, handlers: ViewerHandlers): TemplateResult {
    const { photo, poi, category } = selection(ready);
    return html`<hcm-photo-sheet
        .photo=${photo}
        .poi=${poi}
        .category=${category}
        .photos=${ready.manifest.photos}
        .locale=${view.locale}
        .mode=${placement.mode}
        .open=${placement.open}
        .manifestUrl=${view.manifestUrl}
        .contributeUrl=${ready.manifest.contributeUrl ?? null}
        .stories=${ready.manifest.stories ?? []}
        .canLocate=${ready.state.webgl}
        .years=${view.stops}
        .photoVersion=${ready.state.photoVersion}
        ?inert=${placement.inert === true}
        @hcm-close=${handlers.onSheetClose}
        @hcm-year-change=${handlers.onYearChange}
        @hcm-photo-locate=${handlers.onPhotoLocate}
        @hcm-photo-select=${handlers.onPhotoSelect}
        @hcm-story-select=${handlers.onStorySelect}
        @hcm-lightbox-open=${handlers.onLightboxOpen}
        @hcm-photo-shown=${handlers.onPhotoShown}
        @hcm-photo-version=${handlers.onPhotoVersion}
    ></hcm-photo-sheet>`;
}

function photosSheet(view: ViewerView, ready: Ready, placement: Placement, handlers: ViewerHandlers): TemplateResult {
    const { year } = ready.state;
    const photos = year === null ? ready.manifest.photos : photosNearYear(ready.manifest.photos, year);
    const label = year === null ? translate(view.locale, 'photos.list') : translate(view.locale, 'photos.nearYear', { year: String(year) });
    const content = html`<hcm-photo-list
        .photos=${photos}
        .locale=${view.locale}
        .manifestUrl=${view.manifestUrl}
        @hcm-photo-select=${handlers.onPhotoSelect}
    ></hcm-photo-list>`;
    const onClose = (): void => {
        handlers.onSheetClose(new CustomEvent('hcm-close'));
    };
    return html`<div class="photos-sheet" ?inert=${placement.inert === true} @hcm-close=${handlers.onSheetClose}>
        ${renderSheetFrame({ ...placement, label, closeLabel: translate(view.locale, 'action.close'), handleLabel: translate(view.locale, 'sheet.resize'), onClose }, content)}
    </div>`;
}

function trailingPane(view: ViewerView, ready: Ready | null, handlers: ViewerHandlers): TemplateResult {
    const sheet = dockedSheet(view, ready);
    if (ready === null || sheet === 'none') {
        return EMPTY;
    }
    const content = {
        layers: () => layerPanel(view, ready, DOCKED_OPEN, handlers),
        photos: () => photosSheet(view, ready, DOCKED_OPEN, handlers),
        unplaced: () => unplacedSheet(view, ready.manifest, DOCKED_OPEN, handlers.onSheetClose),
        photo: () => photoSheet(view, ready, DOCKED_OPEN, handlers),
        poi: () => photoSheet(view, ready, DOCKED_OPEN, handlers),
        stories: () => storiesSheet({ ...view, storyId: ready.state.selectedStoryId }, ready.manifest, DOCKED_OPEN, handlers),
    }[sheet];
    return html`<div class="pane trailing">${content()}</div>`;
}

function overlays(view: ViewerView, ready: Ready, legal: LegalMirror, handlers: ViewerHandlers): TemplateResult {
    const { state, manifest } = ready;
    const mode = view.layout.sheetMode;
    const modal = mode === 'docked' ? nothing : modalSheets(view, ready, mode, handlers);
    return html`${modal}
        <hcm-about-dialog
            .open=${isDialogSheet(state.sheet)}
            .mode=${dialogMode(state.sheet)}
            .shortcuts=${state.shortcuts}
            .city=${manifest.city}
            .locale=${view.locale}
            .engineVersion=${view.engineVersion}
            .consent=${state.consent}
            .analytics=${manifest.city.analytics.measurementId !== undefined}
            .attribution=${legal === 'about' ? view.attribution : null}
            .mapboxCssUrl=${view.mapboxCssUrl}
            ?fullscreen=${view.layout.aboutFullscreen}
            @hcm-close=${handlers.onSheetClose}
            .theme=${state.theme}
            @hcm-consent=${handlers.onConsent}
            @hcm-locale-change=${handlers.onLocaleChange}
            @hcm-theme-change=${handlers.onThemeChange}
            @hcm-shortcuts-change=${handlers.onShortcuts}
            @hcm-help-open=${handlers.onHelpOpen}
        ></hcm-about-dialog>
        ${lightbox(state, manifest.photos, view, handlers)}`;
}

/**
 * The modal sheets; under the lightbox (opened from the photo sheet) they are inert, as the frame is: the tour found the
 * photo sheet's image button, handle and Close usable and in the Tab order beneath the lightbox.
 */
function modalSheets(view: ViewerView, ready: Ready, mode: SheetMode, handlers: ViewerHandlers): TemplateResult {
    const { sheet, lightbox: inert } = ready.state;
    return html`${layerPanel(view, ready, { mode, open: sheet === 'layers', inert }, handlers)}
    ${photoSheet(view, ready, { mode, open: sheet === 'photo' || sheet === 'poi', inert }, handlers)}
    ${photosSheet(view, ready, { mode, open: sheet === 'photos', inert }, handlers)}
    ${unplacedSheet(view, ready.manifest, { mode, open: sheet === 'unplaced', inert }, handlers.onSheetClose)}
    ${storiesSheet({ ...view, storyId: ready.state.selectedStoryId }, ready.manifest, { mode, open: sheet === 'stories', inert }, handlers)}`;
}
