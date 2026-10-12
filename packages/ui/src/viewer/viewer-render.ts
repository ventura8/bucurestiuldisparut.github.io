/**
 * The template of `<hcm-map-viewer>`, split by region: the frame (panes per window class), the map pane with its
 * status layer (skeleton, error card, no-WebGL fallback) and floating controls, the modal sheets, the About dialog
 * and the lightbox. Every function takes the view (state plus derived values) and the element's handlers; none keeps
 * state. The map container is the one static `<div class="map">`: Lit never re-creates it, so the Mapbox canvas that
 * the engine mounts into it survives every render.
 */
import { translate, type Locale, type Manifest, type MessageKey, type Photo, type Poi, type PoiCategory } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';
import { keyed } from 'lit/directives/keyed.js';

import type { FabMenuItem } from '../components/fab-menu.js';
import { EMPTY } from './empty.js';
import type { SheetMode, ViewerLayout } from './layout.js';
import { renderSheetFrame } from './sheet-frame.js';
import type { ViewerError, ViewerState } from './store-port.js';
import { photosNearYear, type TimelineStop } from './timeline-model.js';
import { otherLocale, type MenuAction } from './viewer-actions.js';

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
}

/** `hcm-overlay-opacity` of `<hcm-overlay-list>`: `final` is false while dragging, true on release. */
export interface OverlayOpacityDetail {
    readonly id: string;
    readonly opacity: number;
    readonly final: boolean;
}

/** The element's event handlers, bound once. */
export interface ViewerHandlers {
    readonly onYearChange: (event: CustomEvent<{ readonly year: number | null }>) => void;
    readonly onOverlayVisibility: (event: CustomEvent<{ readonly id: string; readonly visible: boolean }>) => void;
    readonly onOverlayOpacity: (event: CustomEvent<OverlayOpacityDetail>) => void;
    readonly onSheetClose: (event: Event) => void;
    readonly onPhotoSelect: (event: CustomEvent<{ readonly photoId: string }>) => void;
    readonly onLightboxOpen: (event: Event) => void;
    readonly onLightboxClose: (event: Event) => void;
    readonly onMenuSelect: (event: CustomEvent<{ readonly value: string }>) => void;
    readonly onLocaleChange: (event: CustomEvent<{ readonly locale: Locale }>) => void;
    readonly onThemeChange: (event: CustomEvent<{ readonly theme: ViewerState['theme'] }>) => void;
    readonly onConsent: (event: CustomEvent<{ readonly decision: 'granted' | 'denied' }>) => void;
    readonly onRetry: (event: Event) => void;
    readonly onToastDismiss: (event: Event) => void;
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

type DockedSheet = 'layers' | 'photo' | 'poi' | 'photos';

/** About is always a dialog; the layers panel has its own pane when it is always docked. */
function isDockable(sheet: ViewerState['sheet'], layersDocked: boolean): sheet is DockedSheet {
    return sheet === 'photo' || sheet === 'poi' || sheet === 'photos' || (sheet === 'layers' && !layersDocked);
}

/** The sheet that shows in the docked trailing pane, if any. */
function dockedSheet(view: ViewerView, ready: Ready | null): DockedSheet | 'none' {
    if (ready === null || view.layout.sheetMode !== 'docked') {
        return 'none';
    }
    const sheet = ready.state.sheet;
    return isDockable(sheet, view.layout.layersDocked) ? sheet : 'none';
}

/** True while a modal surface covers the frame (its content is then inert): the lightbox, About, a modal sheet. */
function modalOpen(view: ViewerView): boolean {
    const state = view.state;
    if (state === null) {
        return false;
    }
    return state.lightbox || state.sheet === 'about' || (view.layout.sheetMode !== 'docked' && state.sheet !== 'none');
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
        <p class="note"><hcm-icon name="timeline"></hcm-icon><span>${translate(locale, 'timeline.empty')}</span></p>
    </div>`;
}

export function renderViewer(view: ViewerView, handlers: ViewerHandlers): TemplateResult {
    const ready = readyOf(view);
    return html`${stylesheet(view)}
        <div
            class="frame"
            data-panes=${panes(view, ready)}
            ?data-compact-height=${view.state?.compactHeight === true}
            ?data-timeline=${hasTimeline(view, ready)}
            ?inert=${modalOpen(view)}
        >
            ${skipLink(view, ready, handlers)} ${leadingPane(view, ready, handlers)}
            <div class="map-pane">
                <div class="map" role="region" aria-label=${mapLabel(view, ready)}></div>
                ${statusLayer(view, handlers)} ${ready === null ? nothing : controls(view, ready, handlers)}
            </div>
            ${trailingPane(view, ready, handlers)}
        </div>
        ${ready === null ? nothing : overlays(view, ready, handlers)}`;
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
        ? html`<div class="pane leading">${layerPanel(view, ready, { ...DOCKED_OPEN, closable: false }, handlers)}</div>`
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

function skeleton(locale: Locale): TemplateResult {
    return html`<div class="status">
        <div class="skeleton" role="status">
            <hcm-progress indeterminate .label=${translate(locale, 'viewer.loading')}></hcm-progress>
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

function noWebgl(view: ViewerView, manifest: Manifest, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="status">
        <div class="fallback">
            <hcm-error-card .error=${{ code: 'error.webgl', retryable: false }} .locale=${view.locale}></hcm-error-card>
            <hcm-photo-list
                .photos=${manifest.photos}
                .locale=${view.locale}
                .manifestUrl=${view.manifestUrl}
                @hcm-photo-select=${handlers.onPhotoSelect}
            ></hcm-photo-list>
        </div>
    </div>`;
}

/** The actions the FAB menu offers: no layers when the panel is docked, no map actions without WebGL, no list without photos. */
function menuActions(view: ViewerView, ready: Ready): readonly MenuAction[] {
    const map = ready.state.webgl;
    const candidates: readonly (readonly [MenuAction, boolean])[] = [
        ['layers', map && !view.layout.layersDocked],
        ['photos', ready.manifest.photos.length > 0],
        ['locate', map],
        ['share', true],
        ['language', true],
        ['about', true],
    ];
    return candidates.filter(([, shown]) => shown).map(([action]) => action);
}

const MENU_ENTRIES: Readonly<Record<Exclude<MenuAction, 'language'>, { readonly icon: string; readonly label: MessageKey }>> = {
    layers: { icon: 'layers', label: 'layers.title' },
    photos: { icon: 'photo_library', label: 'photos.list' },
    locate: { icon: 'my_location', label: 'action.locate' },
    share: { icon: 'share', label: 'action.share' },
    about: { icon: 'info', label: 'about.title' },
};

/** One FAB menu item; the language item is named after the language it switches to (`English`, `Română`). */
function menuItem(action: MenuAction, locale: Locale): FabMenuItem {
    if (action === 'language') {
        return { value: action, icon: 'translate', label: translate(locale, `language.${otherLocale(locale)}`) };
    }
    const entry = MENU_ENTRIES[action];
    return { value: action, icon: entry.icon, label: translate(locale, entry.label) };
}

function controls(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const { state, manifest } = ready;
    const analytics = manifest.city.analytics.measurementId !== undefined;
    return html`${timelineArea(view, ready, handlers)} ${nearYearChip(view, ready, handlers)}
        <div class="dock menu">
            <hcm-fab-menu
                icon="menu"
                .label=${translate(view.locale, 'action.menu')}
                .closeLabel=${translate(view.locale, 'action.close')}
                .items=${menuActions(view, ready).map((action) => menuItem(action, view.locale))}
                @hcm-select=${handlers.onMenuSelect}
            ></hcm-fab-menu>
        </div>
        ${analytics && state.consent === 'unknown' ? consentBanner(view.locale, handlers) : nothing} ${toast(view, state, handlers)}`;
}

function consentBanner(locale: Locale, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="dock consent">
        <hcm-consent-banner
            .headline=${translate(locale, 'consent.title')}
            .body=${translate(locale, 'consent.body')}
            .acceptLabel=${translate(locale, 'consent.accept')}
            .declineLabel=${translate(locale, 'consent.decline')}
            @hcm-consent=${handlers.onConsent}
        ></hcm-consent-banner>
    </div>`;
}

function timeline(view: ViewerView, state: ViewerState, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="dock timeline">
        <hcm-timeline
            id="timeline"
            .stops=${view.stops}
            .value=${state.year}
            .locale=${view.locale}
            .orientation=${view.layout.timeline}
            @hcm-year-change=${handlers.onYearChange}
        ></hcm-timeline>
    </div>`;
}

function nearYearChip(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const year = ready.state.year;
    if (year === null || photosNearYear(ready.manifest.photos, year).length === 0) {
        return EMPTY;
    }
    return html`<div class="dock chip">
        <hcm-button variant="tonal" icon="photo_library" @click=${handlers.onNearYear}
            >${translate(view.locale, 'photos.nearYear', { year: String(year) })}</hcm-button
        >
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
                .message=${translate(view.locale, current.key, current.params)}
                .closeLabel=${translate(view.locale, 'action.close')}
                @hcm-dismiss=${handlers.onToastDismiss}
            ></hcm-snackbar>`,
        )}
    </div>`;
}

/** Where a sheet shows, whether it is open and whether it can be closed (the always-docked layers pane cannot). */
interface Placement {
    readonly mode: SheetMode;
    readonly open: boolean;
    readonly closable?: boolean;
}

const DOCKED_OPEN: Placement = { mode: 'docked', open: true };

function layerPanel(view: ViewerView, ready: Ready, placement: Placement, handlers: ViewerHandlers): TemplateResult {
    return html`<hcm-layer-panel
        .overlays=${ready.state.overlays}
        .manifest=${ready.manifest}
        .locale=${view.locale}
        .mode=${placement.mode}
        .open=${placement.open}
        .closable=${placement.closable !== false}
        @hcm-close=${handlers.onSheetClose}
        @hcm-overlay-visibility=${handlers.onOverlayVisibility}
        @hcm-overlay-opacity=${handlers.onOverlayOpacity}
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
        @hcm-close=${handlers.onSheetClose}
        @hcm-photo-select=${handlers.onPhotoSelect}
        @hcm-lightbox-open=${handlers.onLightboxOpen}
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
    return html`<div class="photos-sheet" @hcm-close=${handlers.onSheetClose}>
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
        photo: () => photoSheet(view, ready, DOCKED_OPEN, handlers),
        poi: () => photoSheet(view, ready, DOCKED_OPEN, handlers),
    }[sheet];
    return html`<div class="pane trailing">${content()}</div>`;
}

function overlays(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const { state, manifest } = ready;
    const mode = view.layout.sheetMode;
    const modal = mode === 'docked' ? nothing : modalSheets(view, ready, mode, handlers);
    return html`${modal}
        <hcm-about-dialog
            .open=${state.sheet === 'about'}
            .city=${manifest.city}
            .locale=${view.locale}
            .engineVersion=${view.engineVersion}
            .consent=${state.consent}
            .analytics=${manifest.city.analytics.measurementId !== undefined}
            ?fullscreen=${view.layout.aboutFullscreen}
            @hcm-close=${handlers.onSheetClose}
            .theme=${state.theme}
            @hcm-consent=${handlers.onConsent}
            @hcm-locale-change=${handlers.onLocaleChange}
            @hcm-theme-change=${handlers.onThemeChange}
        ></hcm-about-dialog>
        <hcm-lightbox
            .open=${state.lightbox && state.selectedPhotoId !== null}
            .photos=${manifest.photos}
            .photoId=${state.selectedPhotoId}
            .locale=${view.locale}
            .manifestUrl=${view.manifestUrl}
            @hcm-close=${handlers.onLightboxClose}
            @hcm-photo-select=${handlers.onPhotoSelect}
        ></hcm-lightbox>`;
}

function modalSheets(view: ViewerView, ready: Ready, mode: SheetMode, handlers: ViewerHandlers): TemplateResult {
    const sheet = ready.state.sheet;
    return html`${layerPanel(view, ready, { mode, open: sheet === 'layers' }, handlers)}
    ${photoSheet(view, ready, { mode, open: sheet === 'photo' || sheet === 'poi' }, handlers)}
    ${photosSheet(view, ready, { mode, open: sheet === 'photos' }, handlers)}`;
}
