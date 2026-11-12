/**
 * The georeferencer's two panes (`docs/research/M3-interfaces.md` §10.4): the scan (`<hcm-scan-viewer>`, its numbered
 * markers and the keyboard's help) and the reference map (`<hcm-admin-map>` with the list of what it shows: OpenStreetMap,
 * Sentinel-2 or one of the city's published layers, and its credit), side by side from medium windows, one at a
 * time under a Scan | Map switch on compact ones.
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { labelText } from '../imagery/imagery-text.js';
import { when, withValue } from '../imagery/when.js';
import { contentText } from '../shell/text.js';
import type { GeorefContext } from './georef-parts.js';
import type { GeorefViewState, HalfPairPort, PixelPositionPort, ReferenceKindPort, ScanCameraPort } from './georef-port.js';
import { badgeToneOf } from './marker-badge.js';
import type { ScanMarker } from './scan-draw.js';

const ATTRIBUTION = {
    osm: 'adminContent.georef.attribution.osm',
    s2: 'adminContent.georef.attribution.s2',
} as const satisfies Readonly<Record<ReferenceKindPort, string>>;

/** The scan's markers, numbered as the residual table numbers its rows (in the pairs' order). */
function markersOf(view: GeorefViewState): readonly ScanMarker[] {
    return view.pairs.map((pair, index) => ({
        id: pair.id,
        label: String(index + 1),
        pixel: pair.pixel,
        enabled: pair.enabled,
        tone: badgeToneOf(view.fit.residuals[pair.id], view.thresholdM),
    }));
}

/** The matcher's suggestions still to decide, labelled `a1`, `a2`, … as in their list (drawn dashed, M4 §2.5). */
function suggestionMarkersOf(view: GeorefViewState): readonly ScanMarker[] {
    return view.suggestions.pending.map((row) => ({ id: row.pair.id, label: row.label, pixel: row.pair.pixel, enabled: true }));
}

/** The half pair's scan end, when it began on the scan. */
function halfPixel(half: HalfPairPort | null): PixelPositionPort | null {
    return half !== null && 'pixel' in half ? half.pixel : null;
}

type Detail<T> = CustomEvent<T>;

function scanViewer(context: GeorefContext, scan: NonNullable<NonNullable<GeorefViewState['version']>['scan']>): TemplateResult {
    const { locale, view, intents } = context;
    return html`<hcm-scan-viewer
            .src=${view.scan.status === 'ready' ? view.scan.url : ''}
            .scanWidth=${scan.width}
            .scanHeight=${scan.height}
            .previewScale=${scan.previewScale}
            .markers=${markersOf(view)}
            .selected=${view.selected}
            .suggestions=${suggestionMarkersOf(view)}
            .selectedSuggestion=${view.suggestions.selected}
            .half=${halfPixel(view.half)}
            .ghost=${halfPixel(view.ghost)}
            .detail=${view.scanDetail}
            .follow=${view.scanFollow}
            ?adding=${view.adding || view.moving !== null}
            .label=${contentText(locale, 'adminContent.georef.scanLabel')}
            .zoomInLabel=${contentText(locale, 'adminContent.map.zoomIn')}
            .zoomOutLabel=${contentText(locale, 'adminContent.map.zoomOut')}
            @hcm-pick=${(event: Detail<{ pixel: PixelPositionPort }>) => {
                intents?.pickScan(event.detail.pixel);
            }}
            @hcm-select=${(event: Detail<{ id: string | null }>) => {
                intents?.select(event.detail.id);
            }}
            @hcm-move=${(event: Detail<{ id: string; pixel: PixelPositionPort }>) => {
                intents?.movePixel(event.detail.id, event.detail.pixel);
            }}
            @hcm-delete=${(event: Detail<{ id: string }>) => {
                intents?.remove(event.detail.id);
            }}
            @hcm-escape=${() => {
                intents?.cancelHalf();
            }}
            @hcm-view=${(event: Detail<ScanCameraPort>) => {
                intents?.scanMoved(event.detail);
            }}
        ></hcm-scan-viewer>
        <p class="note">${contentText(locale, 'adminContent.georef.scanKeys')}</p>`;
}

function scanPane(context: GeorefContext): TemplateResult {
    const scan = context.view.version?.scan ?? null;
    if (scan === null || context.view.scan.status === 'failed') {
        return html`<p class="note" data-state="no-scan">${contentText(context.locale, 'adminContent.georef.noScan')}</p>`;
    }
    return scanViewer(context, scan);
}

/** The references the version has. */
function referencesOf(view: GeorefViewState): readonly ReferenceKindPort[] {
    const reference = view.version?.reference ?? null;
    if (reference === null) {
        return [];
    }
    return (['osm', 's2'] as const).filter((kind) => (kind === 'osm' ? reference.osmPath : reference.s2Path) !== null);
}

/** One thing the map pane can show: a reference of the version, or a published layer of the city. */
interface MapChoice {
    readonly value: string;
    readonly label: string;
    readonly choose: (intents: NonNullable<GeorefContext['intents']>) => void;
}

function mapChoices({ locale, view }: GeorefContext): readonly MapChoice[] {
    const references = referencesOf(view).map((kind) => ({
        value: `reference:${kind}`,
        label: contentText(locale, `adminContent.georef.reference.${kind}`),
        choose: (intents: NonNullable<GeorefContext['intents']>): void => {
            intents.setBase(null);
            intents.setReference(kind);
        },
    }));
    const layers = view.baseLayers.map((layer) => ({
        value: `layer:${layer.id}`,
        label: contentText(locale, 'adminContent.georef.shows.layer', { name: labelText(layer.label, locale), year: String(layer.year) }),
        choose: (intents: NonNullable<GeorefContext['intents']>): void => {
            intents.setBase(layer.id);
        },
    }));
    return [...references, ...layers];
}

/** What the map pane shows now, as a choice's value. */
function shownValue(view: GeorefViewState): string {
    return view.base === null ? `reference:${String(view.reference)}` : `layer:${view.base}`;
}

/**
 * The map shows: OpenStreetMap, Sentinel-2 or one of the city's published layers (align 1914 on the 1911 plan). A native list: the
 * keyboard and a screen reader have it as it is. Shown once there is more than one thing to show.
 */
function mapShows(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    const choices = mapChoices(context);
    const shown = shownValue(view);
    const change = (event: Event): void => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        const choice = choices.find((item) => item.value === value);
        if (choice !== undefined && intents !== null) {
            choice.choose(intents);
        }
    };
    return when(
        choices.length > 1,
        () =>
            html`<div class="field shows">
                <label for="map-shows">${contentText(locale, 'adminContent.georef.shows.map')}</label>
                <select id="map-shows" @change=${change}>
                    ${choices.map((choice) => html`<option value=${choice.value} ?selected=${choice.value === shown}>${choice.label}</option>`)}
                </select>
            </div>`,
    );
}

/** The Sentinel-2 item's year, for its attribution ('' when unknown). */
function s2Year(view: GeorefViewState): string {
    return view.version?.reference?.s2Date?.slice(0, 4) ?? '';
}

/** The credit of what the map shows: the published layer's name and year, else the reference's. */
function attribution(locale: Locale, view: GeorefViewState): string {
    const layer = view.baseLayers.find((item) => item.id === view.base);
    if (layer !== undefined) {
        return contentText(locale, 'adminContent.georef.shows.layerNote', {
            name: labelText(layer.label, locale),
            year: String(layer.year),
        });
    }
    const reference = view.reference;
    if (reference === null) {
        return contentText(locale, 'adminContent.georef.noReference');
    }
    return contentText(locale, ATTRIBUTION[reference], { year: s2Year(view) });
}

function mapPane(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    return html`${mapShows(context)}
        <hcm-admin-map
            .status=${view.map}
            .locale=${locale}
            .cssUrl=${context.mapCss}
            @hcm-map-host=${(event: Detail<{ container: HTMLElement }>) => {
                intents?.attachMap(event.detail.container);
            }}
            @hcm-zoom=${(event: Detail<{ delta: number }>) => {
                intents?.zoomBy(event.detail.delta);
            }}
            @hcm-map-focus=${(event: Detail<{ focused: boolean }>) => {
                intents?.setMapFocus(event.detail.focused);
            }}
            @hcm-map-nudge=${(event: Detail<{ dx: number; dy: number }>) => {
                intents?.nudgeMap(event.detail.dx, event.detail.dy);
            }}
            @hcm-map-delete=${() => {
                removeSelected(context);
            }}
        ></hcm-admin-map>
        <p class="note">${attribution(locale, view)}</p>`;
}

function paneSwitch(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    const options = [
        { value: 'scan', label: contentText(locale, 'adminContent.georef.pane.scan') },
        { value: 'map', label: contentText(locale, 'adminContent.georef.pane.map') },
    ];
    return when(
        context.compact,
        () =>
            html`<hcm-segmented-button
                .options=${options}
                .value=${view.pane}
                .label=${contentText(locale, 'adminContent.georef.pane.label')}
                @hcm-change=${(event: Detail<{ value: 'scan' | 'map' }>) => {
                    intents?.setPane(event.detail.value);
                }}
            ></hcm-segmented-button>`,
    );
}

/** While a point picked up from the context menu waits for its place: which one, where to click, and Esc. */
function movingNote(context: GeorefContext): TemplateResult {
    const { locale, view } = context;
    return withValue(view.moving, (moving) => {
        const number = String(view.pairs.findIndex((pair) => pair.id === moving.id) + 1);
        return html`<p class="note" role="status" data-state="moving">
            ${contentText(locale, `adminContent.georef.menu.moving.${moving.pane}`, { number })}
        </p>`;
    });
}

/** The selected pair goes (the button beside the panes, Delete or Backspace on the map), unless nothing writes. */
function removeSelected({ view, intents, locked }: GeorefContext): void {
    if (view.selected !== null && !locked) {
        intents?.remove(view.selected);
    }
}

/** Delete pair N: shown while a pair is selected, so removing it never needs the table below. */
function deleteSelected(context: GeorefContext): TemplateResult {
    const { locale, view } = context;
    const index = view.pairs.findIndex((pair) => pair.id === view.selected);
    return when(
        index >= 0,
        () =>
            html`<hcm-button
                variant="outlined"
                icon="delete"
                data-action="delete-selected"
                ?disabled=${context.locked}
                @click=${() => {
                    removeSelected(context);
                }}
                >${contentText(locale, 'adminContent.georef.deleteSelected', { number: String(index + 1) })}</hcm-button
            >`,
    );
}

/** Link the views: on by default once a fit exists; without one it is off and says when it will work. */
function linkToggle(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    const fitted = view.fit.refusal === null;
    return html`<div class="actions">
        <hcm-button
            variant="outlined"
            icon="link"
            data-action="link-views"
            .pressed=${fitted && view.linked}
            ?disabled=${!fitted}
            @click=${() => {
                intents?.setLinked(!view.linked);
            }}
            >${contentText(locale, 'adminContent.georef.linkViews')}</hcm-button
        >
        ${deleteSelected(context)}
        ${when(!fitted, () => html`<span class="note" data-state="link-no-fit">${contentText(locale, 'adminContent.georef.linkViewsNoFit')}</span>`)}
    </div>`;
}

export function panes(context: GeorefContext): TemplateResult {
    return html`${paneSwitch(context)} ${linkToggle(context)} ${movingNote(context)}
        <div class="panes" ?data-compact=${context.compact} data-pane=${context.view.pane}>
            <div class="scan-pane">${scanPane(context)}</div>
            <div class="map-pane">${mapPane(context)}</div>
        </div>`;
}
