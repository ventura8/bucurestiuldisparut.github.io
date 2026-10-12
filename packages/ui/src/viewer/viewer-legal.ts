/**
 * Modal surfaces and the map's legal line (scenario V18; Mapbox terms, docs/research/design-review-security-cost.md §5):
 * while a modal sheet, the lightbox or About covers the map, its frame is inert and Mapbox GL's own logo and attribution
 * would sit under it, so the viewer hides them and shows the same in its legal bar (below a sheet or the lightbox) or at
 * the foot of About (`<hcm-map-attribution>`). Without a map (loading, an error, no WebGL) there is nothing to credit.
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { AttributionPart } from './attribution.js';
import type { SheetMode } from './layout.js';
import type { ViewerState } from './store-port.js';

/** Where the logo and attribution show: on the map (nothing covers it), in the legal bar, or at the foot of About. */
export type LegalMirror = 'none' | 'bar' | 'about';

/** True while a modal surface covers the frame (its content is then inert): the lightbox, About, a modal sheet. */
export function modalOpen(state: ViewerState | null, mode: SheetMode): boolean {
    return state !== null && (state.lightbox || state.sheet === 'about' || (mode !== 'docked' && state.sheet !== 'none'));
}

/** A ready viewer that draws a map (WebGL): the only state with a Mapbox logo and attribution to keep visible. */
function hasMap(state: ViewerState | null): state is ViewerState {
    return state !== null && state.status === 'ready' && state.webgl;
}

/** About is in the browser's top layer, above everything the viewer draws: it carries its own copy. */
export function legalMirror(state: ViewerState | null, mode: SheetMode): LegalMirror {
    if (!hasMap(state) || !modalOpen(state, mode)) {
        return 'none';
    }
    return state.sheet === 'about' ? 'about' : 'bar';
}

/** The legal bar: the viewer's last grid row, under the modal layer, so a sheet, its scrim or the lightbox ends above it. */
export function renderLegalBar(parts: readonly AttributionPart[], locale: Locale, cssUrl: string): TemplateResult {
    return html`<div class="legal">
        <hcm-map-attribution .parts=${parts} .locale=${locale} .cssUrl=${cssUrl}></hcm-map-attribution>
    </div>`;
}
