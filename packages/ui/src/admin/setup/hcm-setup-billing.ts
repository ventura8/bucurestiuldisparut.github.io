/**
 * The billing card's body (step b, `docs/research/M2b-interfaces.md` §3.3 b): the budget it creates, then one button
 * that links billing and creates the budget (one click, one Google consent). While no open account exists it waits for
 * the one the owner creates on Google's page; with several it offers the choice, the first preselected.
 */
import { html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { fieldStyles, setupTextStyles } from './setup-styles.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { formatMoney } from './setup-text.js';

const HCM_SETUP_BILLING_TAG = 'hcm-setup-billing';

export class HcmSetupBilling extends SetupBody {
    static override readonly styles = [setupTextStyles, fieldStyles];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const amount = formatMoney(this.locale, state.billing.amount, state.billing.currency);
        const step = this.step(state, 'billing');
        return html`<div class="body">
            <p>${this.t('adminSetup.billing.budget', { amount })}</p>
            ${state.billing.waitingForAccount ? this.renderWaiting() : nothing}
            ${state.billing.accounts.length > 1 ? this.renderChoice(state) : this.renderMain(step.state === 'ok', step.busy, amount)}
        </div>`;
    }

    private renderWaiting(): TemplateResult {
        return html`<div class="waiting" role="status">
            <hcm-progress indeterminate label=${this.t('adminSetup.billing.waiting')}></hcm-progress>
            <p>${this.t('adminSetup.billing.waiting')}</p>
        </div>`;
    }

    private renderMain(done: boolean, busy: boolean, amount: string): TemplateResult {
        if (done) {
            return html`<p class="success">${this.t('adminSetup.billing.done', { amount })}</p>`;
        }
        return html`<div class="actions">
            <hcm-button
                variant="filled"
                icon="credit_card"
                ?disabled=${busy}
                @click=${() => {
                    this.act((intents) => {
                        intents.linkBilling();
                    });
                }}
                >${this.t('adminSetup.billing.link', { amount })}</hcm-button
            >
        </div>`;
    }

    private renderChoice(state: SetupViewState): TemplateResult {
        return html`<fieldset class="choice">
            <legend>${this.t('adminSetup.billing.chooseAccount')}</legend>
            ${state.billing.accounts.map(
                (account) =>
                    html`<label class="option"
                        ><input
                            class="radio"
                            type="radio"
                            name="account"
                            .value=${account.name}
                            .checked=${account.name === state.billing.chosen}
                            @change=${() => {
                                this.act((intents) => {
                                    intents.chooseBillingAccount(account.name);
                                });
                            }}
                        />${account.displayName} (${account.currency})</label
                    >`,
            )}
            <div class="actions">
                <hcm-button
                    variant="filled"
                    ?disabled=${this.step(state, 'billing').busy}
                    @click=${() => {
                        this.act((intents) => {
                            intents.confirmBillingAccount();
                        });
                    }}
                    >${this.t('adminSetup.billing.useAccount')}</hcm-button
                >
            </div>
        </fieldset>`;
    }
}

/** Registers `<hcm-setup-billing>` and what it renders. */
export function defineHcmSetupBilling(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmProgress(registry);
    defineOnce(registry, HCM_SETUP_BILLING_TAG, HcmSetupBilling);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-billing': HcmSetupBilling;
    }
}
