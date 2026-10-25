/**
 * Export the city as a chunk of its own (M5, `docs/research/M5-interfaces.md` §5.6; the admin's `export-card-<hash>.js`,
 * its budget in `scripts/ci/check_bundle_budget.py`): Settings keeps its budget, and the card is fetched the first time
 * its section opens. Until the chunk is in, the section says Loading; a failed fetch says so with Try again; once it is
 * in, every render is synchronous. The page renders again when a fetch settles (`refresh`).
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../editing/states.js';
import { chunkLoader, type ChunkLoader } from '../imagery/orders/lazy-card.js';
import { contentText } from '../shell/text.js';
import type { exportCard, ExportCardContext } from './export-card.js';

/** What the chunk gives the settings page: the card's template. */
export interface ExportCardChunk {
    readonly exportCard: typeof exportCard;
}

/** The card's chunk: one dynamic `import()`, so the bundler splits it. */
export const EXPORT_CARD_CHUNK: ChunkLoader<ExportCardChunk> = chunkLoader(async () => import('./export-card.js'));

/** Why the card is not there: its chunk could not be fetched (offline, or a deploy replaced it). */
const CHUNK_FAILURE = { kind: 'unavailable', code: 'network' } as const;

/** What the settings page gives the lazy card: the card's own context and a way to render the page again. */
export interface LazyExportContext extends Omit<ExportCardContext, 'save'> {
    readonly refresh: () => void;
}

/**
 * Saves a ready export: a link to its signed address, followed once and dropped, so the browser downloads it (the
 * server's `Content-Disposition` names the file) and the address never shows on the page.
 */
export function saveFrom(scope: { readonly document: Document }): ExportCardContext['save'] {
    return (target) => {
        const link = scope.document.createElement('a');
        link.href = target.url;
        link.download = target.fileName;
        link.rel = 'noopener';
        link.hidden = true;
        scope.document.body.append(link);
        link.click();
        link.remove();
    };
}

function fetchChunk(context: LazyExportContext, chunk: ChunkLoader<ExportCardChunk>): void {
    chunk.load().then(context.refresh, context.refresh);
}

function heading(locale: Locale): TemplateResult {
    return html`<h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.export.title')}</h2>`;
}

/** The section's card, fetched on first need. */
export function lazyExportCard(
    context: LazyExportContext,
    chunk: ChunkLoader<ExportCardChunk> = EXPORT_CARD_CHUNK,
    scope: { readonly document: Document } = globalThis,
): TemplateResult {
    const loaded = chunk.loaded();
    if (loaded !== undefined) {
        return loaded.exportCard({ ...context, save: saveFrom(scope) });
    }
    if (chunk.failed()) {
        return html`${heading(context.locale)}${errorTemplate(context.locale, CHUNK_FAILURE, () => {
            fetchChunk(context, chunk);
            context.refresh();
        })}`;
    }
    fetchChunk(context, chunk);
    return html`${heading(context.locale)}${loadingTemplate(context.locale)}`;
}
