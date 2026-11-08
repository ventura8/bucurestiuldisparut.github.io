/**
 * Settings → Browser tab icon as a chunk of its own (`icon-card`, fetched the first time its section opens; its budget in
 * `scripts/ci/check_bundle_budget.py`), so the settings chunk stays within its 20 KB: Loading until then, a failed fetch
 * with Try again; the page renders again when a fetch settles (`context.refresh`).
 */
import { html, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../editing/states.js';
import { chunkLoader, type ChunkLoader } from '../imagery/orders/lazy-card.js';
import type { iconSection } from './icon-section.js';
import { sectionRowTexts, type SectionContext } from './section-parts.js';

export interface IconCardChunk {
    readonly iconSection: typeof iconSection;
}

export const ICON_CARD_CHUNK: ChunkLoader<IconCardChunk> = chunkLoader(async () => import('./icon-section.js'));

/** The card, or its heading with Loading (or the failed fetch's Try again) until its chunk is in. */
export function lazyIconCard(context: SectionContext, chunk: ChunkLoader<IconCardChunk> = ICON_CARD_CHUNK): TemplateResult {
    const card = chunk.loaded();
    if (card !== undefined) {
        return card.iconSection(context);
    }
    const heading = html`<h2 tabindex="-1" data-detail-heading>${sectionRowTexts(context.locale, 'icon').title}</h2>`;
    const fetchCard = (): void => {
        chunk.load().then(context.refresh, context.refresh);
    };
    if (!chunk.failed()) {
        fetchCard();
        return html`${heading}${loadingTemplate(context.locale)}`;
    }
    return html`${heading}${errorTemplate(context.locale, { kind: 'unavailable', code: 'network' }, () => {
        fetchCard();
        context.refresh();
    })}`;
}
