/**
 * The photos near the selected year, one press away (V04): a text chip on the lying timeline; under the standing one (a
 * phone held upright; the owner, 2026-11-12: no wide text pill there) an icon button with the same name, which is also
 * its tooltip. No year (today) or no photo near it: nothing. Its dock is `.dock.chip` of `viewer-styles.ts`.
 */
import { translate, type Locale, type Photo } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { ViewerLayout } from './layout.js';
import { photosNearYear } from './timeline-model.js';

export function nearYearChip(
    view: { readonly locale: Locale; readonly layout: Pick<ViewerLayout, 'timeline'> },
    year: number | null,
    photos: readonly Photo[],
    onNearYear: () => void,
): TemplateResult {
    if (year === null || photosNearYear(photos, year).length === 0) {
        return EMPTY;
    }
    const label = translate(view.locale, 'photos.nearYear', { year: String(year) });
    const chip =
        view.layout.timeline === 'vertical'
            ? html`<hcm-icon-button
                  variant="tonal"
                  icon="photo_library"
                  data-layout-check="near-year"
                  .label=${label}
                  title=${label}
                  @click=${onNearYear}
              ></hcm-icon-button>`
            : html`<hcm-button variant="tonal" icon="photo_library" data-layout-check="near-year" @click=${onNearYear}
                  >${label}</hcm-button
              >`;
    return html`<div class="dock chip">${chip}</div>`;
}
