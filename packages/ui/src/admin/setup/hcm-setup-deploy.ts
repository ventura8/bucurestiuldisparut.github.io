/**
 * The deployment card's body (step d, `docs/research/M2b-interfaces.md` §3.3 d): who installs the server and how, the
 * functions installed so far against the registry, whether the card is watching, and the GitHub repository variables
 * the deploy job reads, each with a copy button. No input: the card turns green by itself.
 */
import { html, nothing, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { copyStyles, setupTextStyles } from './setup-styles.js';

const HCM_SETUP_DEPLOY_TAG = 'hcm-setup-deploy';

export class HcmSetupDeploy extends SetupBody {
    static override readonly styles = [setupTextStyles, copyStyles];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const { ready, total, variables, watching } = state.deploy;
        const progress = this.t('adminSetup.deploy.progress', { ready: String(ready), total: String(total) });
        return html`<div class="body">
            <p>${this.t('adminSetup.deploy.explain')}</p>
            <hcm-progress .value=${total === 0 ? 0 : ready / total} label=${progress}></hcm-progress>
            <p class="note">${progress}</p>
            <p class="note" role="status">${watching ? this.t('adminSetup.deploy.watching') : nothing}</p>
            <p>${this.t('adminSetup.deploy.variables')}</p>
            <ul class="copy-list">
                ${variables.map(
                    (variable) =>
                        html`<li class="copy-row">
                            <span><code>${variable.name}</code><code class="note">${variable.value}</code></span>
                            ${this.copyButton(variable.name, this.t('adminSetup.copy', { name: variable.name }), variable.value)}
                        </li>`,
                )}
            </ul>
        </div>`;
    }
}

/** Registers `<hcm-setup-deploy>` and what it renders. */
export function defineHcmSetupDeploy(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmProgress(registry);
    defineOnce(registry, HCM_SETUP_DEPLOY_TAG, HcmSetupDeploy);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-deploy': HcmSetupDeploy;
    }
}
