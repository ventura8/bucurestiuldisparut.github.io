/**
 * The georeferencer's two panes (`docs/research/M3-interfaces.md` §10.4): the scan (`<hcm-scan-viewer>`, its numbered
 * markers and the keyboard's help) and the reference map (`<hcm-admin-map>` with the switch between OpenStreetMap and
 * Sentinel-2 when the version has both, and the reference's attribution), side by side from medium windows, one at a
 * time under a Scan | Map switch on compact ones.
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

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

function referenceSwitch(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    const available = referencesOf(view);
    const options = available.map((kind) => ({ value: kind, label: contentText(locale, `adminContent.georef.reference.${kind}`) }));
    return when(
        available.length > 1,
        () =>
            html`<hcm-segmented-button
                .options=${options}
                .value=${String(view.reference)}
                .label=${contentText(locale, 'adminContent.georef.reference.label')}
                @hcm-change=${(event: Detail<{ value: ReferenceKindPort }>) => {
                    intents?.setReference(event.detail.value);
                }}
            ></hcm-segmented-button>`,
    );
}

/** The Sentinel-2 item's year, for its attribution ('' when unknown). */
function s2Year(view: GeorefViewState): string {
    return view.version?.reference?.s2Date?.slice(0, 4) ?? '';
}

function attribution(locale: Locale, view: GeorefViewState): string {
    const reference = view.reference;
    if (reference === null) {
        return contentText(locale, 'adminContent.georef.noReference');
    }
    return contentText(locale, ATTRIBUTION[reference], { year: s2Year(view) });
}

function mapPane(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    return html`${referenceSwitch(context)}
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
            >${contentText(locale, 'adminContent.map.linkViews')}</hcm-button
        >
        ${when(!fitted, () => html`<span class="note" data-state="link-no-fit">${contentText(locale, 'adminContent.map.linkViewsNoFit')}</span>`)}
    </div>`;
}

export function panes(context: GeorefContext): TemplateResult {
    return html`${paneSwitch(context)} ${linkToggle(context)} ${movingNote(context)}
        <div class="panes" ?data-compact=${context.compact} data-pane=${context.view.pane}>
            <div class="scan-pane">${scanPane(context)}</div>
            <div class="map-pane">${mapPane(context)}</div>
        </div>`;
}
