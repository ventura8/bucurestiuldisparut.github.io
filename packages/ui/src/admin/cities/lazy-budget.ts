/**
 * The city's budget card as a chunk of its own (M5, `docs/research/M5-interfaces.md` §1.8; the admin's
 * `city-budget-<hash>.js`, its budget in `scripts/ci/check_bundle_budget.py`): fetched the first time its section opens,
 * Loading until then, a failed fetch with Try again; the page renders again when a fetch settles (`refresh`).
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../editing/states.js';
import { chunkLoader, type ChunkLoader } from '../imagery/orders/lazy-card.js';
import { contentText } from '../shell/text.js';
import type { budgetCard, BudgetCardContext } from './city-budget.js';

export interface BudgetCardChunk {
    readonly budgetCard: typeof budgetCard;
}

export const BUDGET_CARD_CHUNK: ChunkLoader<BudgetCardChunk> = chunkLoader(async () => import('./city-budget.js'));

const CHUNK_FAILURE = { kind: 'unavailable', code: 'network' } as const;

export interface LazyBudgetContext extends BudgetCardContext {
    readonly refresh: () => void;
}

function heading(locale: Locale): TemplateResult {
    return html`<h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.budgets.title')}</h2>`;
}

function fetchChunk(context: LazyBudgetContext, chunk: ChunkLoader<BudgetCardChunk>): void {
    chunk.load().then(context.refresh, context.refresh);
}

/** The section's card, fetched on first need. */
export function lazyBudgetCard(context: LazyBudgetContext, chunk: ChunkLoader<BudgetCardChunk> = BUDGET_CARD_CHUNK): TemplateResult {
    const loaded = chunk.loaded();
    if (loaded !== undefined) {
        return loaded.budgetCard(context);
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
