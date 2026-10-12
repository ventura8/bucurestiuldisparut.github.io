/**
 * One step of the Setup Assistant (`docs/research/M2b-interfaces.md` §3.3): its letter, title and status chip in the
 * header; open, why the step is needed and what it costs, why it waits (earlier steps, the server), the recorded
 * reason, the last action's failure (an alert), Continue after an expired Google token, the verified deep links (new
 * tab), the consent note before a Google popup (admin-shell's `hcm-consent-note`), the card's own body (the slot) and
 * Check again. Modes: `inline` (an accordion card of the one-column page), `summary` (a row of the list in list and
 * detail) and `detail` (the open step beside the list). The host carries `data-step`, `data-state` and the counted
 * inputs and consents against the step's budget (`data-inputs`, `data-input-budget`, `data-consents`,
 * `data-consent-budget`) for the e2e input budget.
 */
import { DEFAULT_LOCALE, type AdminSetupKey, type Locale, type ServiceState } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmLoadingIndicator } from '../../components/loading-indicator.js';
import { baseStyles, focusRing, stateLayer, typeStyles, visuallyHidden } from '../../components/styles.js';
import { defineHcmConsentNote } from '../auth/hcm-consent-note.js';
import { EMPTY } from '../shell/empty.js';
import type { SetupIntentsPort, SetupLinkId, SetupMessage, SetupStepId, SetupStepView } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';
import { setupLabel, setupText } from './setup-text.js';

const HCM_SETUP_STEP_TAG = 'hcm-setup-step';

export type SetupStepMode = 'inline' | 'summary' | 'detail';

/** The placeholders of admin-shell's `<hcm-consent-note>`. */
export interface ConsentNoteParams {
    readonly projectId: string;
    readonly amount: string;
    readonly domain: string;
}

/** The status chip's icon per state, so the state never shows by colour alone. */
const STATE_ICONS: Readonly<Record<ServiceState, string>> = {
    missing: 'info',
    pending: 'schedule',
    ok: 'check_circle',
    invalid: 'error',
    unavailable: 'warning',
};

const titleKey = (id: SetupStepId): AdminSetupKey => `adminSetup.step.${id}`;
const whyKey = (id: SetupStepId): AdminSetupKey => `adminSetup.why.${id}`;
const stateKey = (state: ServiceState): AdminSetupKey => `adminSetup.state.${state}`;
const linkKey = (id: SetupLinkId): AdminSetupKey => `adminSetup.link.${id}`;

/** Billing's cost line is its own (the Blaze estimate); every other step has `adminSetup.cost.<id>`. */
function costKey(id: SetupStepId): AdminSetupKey {
    return id === 'billing' ? 'adminSetup.billing.cost' : `adminSetup.cost.${id}`;
}

const cardStyles = css`
    .card {
        box-sizing: border-box;
        border-radius: var(--md-sys-shape-corner-large);
        background: var(--md-sys-color-surface-container-low);
        color: var(--md-sys-color-on-surface);
    }

    :host([mode='summary']) .card {
        background: none;
    }

    :host([mode='summary'][open]) .card {
        background: var(--md-sys-color-secondary-container);
        color: var(--md-sys-color-on-secondary-container);
    }

    .body {
        padding: 0 16px 16px;
    }

    .links {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .links a {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        min-block-size: 48px;
        color: var(--md-sys-color-primary);

        --hcm-icon-size: 18px;
    }

    .recheck {
        justify-content: flex-end;
    }
`;

const headerStyles = css`
    .heading {
        margin: 0;
        font: inherit;
    }

    .header {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        align-items: center;
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 56px;
        margin: 0;
        padding: 8px 16px;
        border: none;
        border-radius: inherit;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
    }

    .letter {
        display: grid;
        place-items: center;
        inline-size: 32px;
        block-size: 32px;
        border-radius: var(--md-sys-shape-corner-full);
        background: var(--md-sys-color-primary-container);
        color: var(--md-sys-color-on-primary-container);
        font-weight: var(--md-sys-typescale-label-large-weight);
    }

    .title {
        flex: 1 1 12ch;
        min-inline-size: 0;
    }

    .optional {
        color: var(--md-sys-color-on-surface-variant);
    }

    .status {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        padding: 4px 12px 4px 8px;
        border: 1px solid var(--md-sys-color-outline-variant);
        border-radius: var(--md-sys-shape-corner-small);

        --hcm-icon-size: 18px;
    }

    .status[data-state='ok'] {
        border-color: transparent;
        background: var(--md-sys-color-primary-container);
        color: var(--md-sys-color-on-primary-container);
    }

    .status[data-state='invalid'] {
        border-color: transparent;
        background: var(--md-sys-color-error-container);
        color: var(--md-sys-color-on-error-container);
    }

    .status hcm-loading-indicator {
        inline-size: 18px;
        block-size: 18px;
    }
`;

export class HcmSetupStep extends LitElement {
    static override readonly properties = {
        step: { attribute: false },
        intents: { attribute: false },
        noteParams: { attribute: false },
        locale: { type: String },
        mode: { type: String, reflect: true },
        open: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        typeStyles,
        visuallyHidden,
        setupTextStyles,
        cardStyles,
        headerStyles,
    ];

    declare step: SetupStepView | null;
    declare intents: SetupIntentsPort | null;
    /** What the consent note names: the project, the budget (formatted) and the auth domain. */
    declare noteParams: ConsentNoteParams;
    declare locale: Locale;
    declare mode: SetupStepMode;
    declare open: boolean;

    constructor() {
        super();
        this.step = null;
        this.intents = null;
        this.noteParams = { projectId: '', amount: '', domain: '' };
        this.locale = DEFAULT_LOCALE;
        this.mode = 'inline';
        this.open = false;
    }

    override render(): TemplateResult {
        const step = this.step;
        if (step === null) {
            return EMPTY;
        }
        const expanded = this.mode === 'detail' || (this.mode === 'inline' && this.open);
        return html`<article class="card" part="card">${this.renderHeader(step)} ${expanded ? this.renderBody(step) : nothing}</article>`;
    }

    protected override updated(): void {
        const step = this.step;
        if (step === null) {
            return;
        }
        Object.assign(this.dataset, {
            step: step.id,
            state: step.state,
            inputs: String(step.used.inputs),
            consents: String(step.used.consents),
            inputBudget: String(step.budget.inputs),
            consentBudget: String(step.budget.consents),
        });
    }

    private t(key: AdminSetupKey, params?: Readonly<Record<string, string>>): string {
        return setupLabel(this.locale, key, params);
    }

    private renderHeader(step: SetupStepView): TemplateResult {
        const inner = html`<span class="letter" aria-hidden="true">${step.letter}</span>
            <span class="title title-medium">${this.t(titleKey(step.id))}</span>
            ${step.optional ? html`<span class="optional label-large">${this.t('adminSetup.optional')}</span>` : nothing}
            ${this.renderChip(step)}`;
        if (this.mode === 'detail') {
            return html`<h2 class="header">${inner}</h2>`;
        }
        return this.mode === 'inline' ? this.renderInlineHeader(step.id, inner) : this.renderSummaryHeader(step.id, inner);
    }

    /** The accordion's header: it expands the card, or collapses it when it is open. */
    private renderInlineHeader(id: SetupStepId, inner: TemplateResult): TemplateResult {
        const target = this.open ? null : id;
        return html`<h2 class="heading">
            <button
                class="header interactive"
                aria-expanded=${String(this.open)}
                aria-controls="body"
                @click=${() => {
                    this.intents?.open(target);
                }}
            >
                ${inner}
            </button>
        </h2>`;
    }

    /** A row of the list: it opens the step beside the list. */
    private renderSummaryHeader(id: SetupStepId, inner: TemplateResult): TemplateResult {
        return html`<h2 class="heading">
            <button
                class="header interactive"
                aria-current=${this.open ? 'step' : nothing}
                @click=${() => {
                    this.intents?.open(id);
                }}
            >
                ${inner}
            </button>
        </h2>`;
    }

    private renderChip(step: SetupStepView): TemplateResult {
        const icon = step.busy
            ? html`<hcm-loading-indicator label=${this.t('adminSetup.busy')}></hcm-loading-indicator>`
            : html`<hcm-icon name=${STATE_ICONS[step.state]}></hcm-icon>`;
        return html`<span class="status label-large" data-state=${step.state}>${icon}${this.t(stateKey(step.state))}</span>`;
    }

    private renderBody(step: SetupStepView): TemplateResult {
        return html`<div class="body" id="body">
            <p>${this.t(whyKey(step.id))}</p>
            <p class="note">${this.t(costKey(step.id))}</p>
            ${this.renderReasons(step)} ${step.needsContinue ? this.renderContinue(step) : nothing} ${this.renderLinks(step)}
            ${step.available ? this.renderActions(step) : nothing}
        </div>`;
    }

    /** Why the step waits, its recorded reason, and the last action's failure (the alert region is always there). */
    private renderReasons(step: SetupStepView): TemplateResult {
        return html`${this.renderWaiting(step)} ${this.renderDetail(step.detail)}
            <div role="alert">${this.renderError(step.error)}</div>`;
    }

    private renderWaiting(step: SetupStepView): TemplateResult {
        if (step.available) {
            return EMPTY;
        }
        return html`<p class="note waiting">${this.t(step.needsBackend ? 'adminSetup.needsServer' : 'adminSetup.locked')}</p>`;
    }

    private renderDetail(detail: SetupMessage | null): TemplateResult {
        return detail === null ? EMPTY : html`<p class="detail" data-detail=${detail.key}>${setupText(this.locale, detail)}</p>`;
    }

    private renderError(error: SetupMessage | null): TemplateResult {
        return error === null ? EMPTY : html`<p class="alert">${setupText(this.locale, error)}</p>`;
    }

    private renderActions(step: SetupStepView): TemplateResult {
        return html`${this.renderConsentNote(step)}<slot></slot>
            <div class="actions recheck">
                <hcm-button
                    variant="text"
                    icon="refresh"
                    ?disabled=${step.busy}
                    @click=${() => {
                        this.intents?.recheck(step.id);
                    }}
                    >${this.t('adminSetup.recheck')}</hcm-button
                >
            </div>`;
    }

    private renderContinue(step: SetupStepView): TemplateResult {
        return html`<div class="actions">
            <hcm-button
                variant="filled"
                @click=${() => {
                    this.intents?.continueGoogle(step.id);
                }}
                >${setupText(this.locale, { key: 'adminShell.session.continue' })}</hcm-button
            >
        </div>`;
    }

    private renderLinks(step: SetupStepView): TemplateResult {
        if (step.links.length === 0) {
            return EMPTY;
        }
        return html`<ul class="links">
            ${step.links.map(
                (link) =>
                    html`<li>
                        <a
                            href=${link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            @click=${() => {
                                this.intents?.followLink(step.id);
                            }}
                            >${this.t(linkKey(link.id))}<hcm-icon name="open_in_new"></hcm-icon
                            ><span class="visually-hidden">${this.t('adminSetup.newTab')}</span></a
                        >
                    </li>`,
            )}
        </ul>`;
    }

    /**
     * Before a Google popup: why, for how long, and Google's unverified-app screen (§2.4). Shown whenever the card's next
     * action opens one (`scope`), a done card's included: Check again on billing or provisioning asks Google again, and
     * the analytics card still offers the GA4 stream setting once the measurement id is found.
     */
    private renderConsentNote(step: SetupStepView): TemplateResult {
        if (step.scope === null) {
            return EMPTY;
        }
        const { projectId, amount, domain } = this.noteParams;
        return html`<hcm-consent-note
            .scope=${step.scope}
            .locale=${this.locale}
            .projectId=${projectId}
            .amount=${amount}
            .domain=${domain}
        ></hcm-consent-note>`;
    }
}

/** Registers `<hcm-setup-step>`, admin-shell's consent note and the kit elements it renders. */
export function defineHcmSetupStep(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineHcmLoadingIndicator(registry);
    defineHcmConsentNote(registry);
    defineOnce(registry, HCM_SETUP_STEP_TAG, HcmSetupStep);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-step': HcmSetupStep;
    }
}
