/**
 * The legacy import card's body (step h, `docs/research/M2b-interfaces.md` §3.3 h): one button imports the old
 * Bucharest photos (one click), a progress bar counts them, the photos that failed processing are listed with their
 * reason, and the card says when all of them are on the map. Importing again is safe: nothing is created twice.
 */
import { html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { EMPTY } from '../shell/empty.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';
import { setupText } from './setup-text.js';

const HCM_SETUP_IMPORT_TAG = 'hcm-setup-import';

type ImportSlice = SetupViewState['legacyImport'];

function isComplete(imported: ImportSlice): boolean {
    return imported.total > 0 && imported.done >= imported.total;
}

/** The bar shows while the import runs and while a partial import waits to be finished. */
function showsProgress(imported: ImportSlice): boolean {
    return imported.running || (imported.done > 0 && !isComplete(imported));
}

export class HcmSetupImport extends SetupBody {
    static override readonly styles = [setupTextStyles];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const imported = state.legacyImport;
        return html`<div class="body">
            ${
                isComplete(imported)
                    ? html`<p class="success">${this.t('adminSetup.import.done', { count: String(imported.total) })}</p>`
                    : this.renderAction(state)
            }
            ${showsProgress(imported) ? this.renderProgress(imported) : nothing} ${this.renderFailed(imported)}
        </div>`;
    }

    private renderAction(state: SetupViewState): TemplateResult {
        const { total, running } = state.legacyImport;
        return html`<div class="actions">
            <hcm-button
                variant="filled"
                icon="upload"
                ?disabled=${running || total === 0 || this.step(state, 'legacyImport').busy}
                @click=${() => {
                    this.act((intents) => {
                        intents.importLegacy();
                    });
                }}
                >${this.t('adminSetup.import.action', { count: String(total) })}</hcm-button
            >
        </div>`;
    }

    private renderProgress(imported: ImportSlice): TemplateResult {
        const text = this.t('adminSetup.import.progress', { done: String(imported.done), total: String(imported.total) });
        return html`<hcm-progress .value=${imported.done / Math.max(imported.total, 1)} label=${text}></hcm-progress>
            <p class="note" role="status">${text}</p>`;
    }

    private renderFailed(imported: ImportSlice): TemplateResult {
        if (imported.failed.length === 0) {
            return EMPTY;
        }
        return html`<ul class="failed">
            ${imported.failed.map(
                (failure) =>
                    html`<li data-photo=${failure.id}><code>${failure.id}</code>: ${setupText(this.locale, { key: failure.detail })}</li>`,
            )}
        </ul>`;
    }
}

/** Registers `<hcm-setup-import>` and what it renders. */
export function defineHcmSetupImport(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmProgress(registry);
    defineOnce(registry, HCM_SETUP_IMPORT_TAG, HcmSetupImport);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-import': HcmSetupImport;
    }
}
