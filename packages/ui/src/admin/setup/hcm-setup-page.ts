/**
 * The Setup Assistant page (`docs/research/M2b-interfaces.md` §1.2, §3): the progress ring with "n of 9 steps done",
 * Check again for the whole page, and one card per step of the controller's state. On compact and medium windows the
 * steps are one column of accordion cards, the open step expanded in place; from expanded (840 px) the list sits
 * beside the open step (list and detail, the detail at most 840 px wide). The page opens at the controller's
 * `openStep`: the first incomplete step, or the one the address named. After Check again, the self-test's checks are
 * listed under the header, each failing one with its reason and a link to its step (`self-test.ts`).
 */
import type { Locale } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { baseStyles, typeStyles } from '../../components/styles.js';
import { observeWindowSize } from '../../layout/window-class.js';
import { EMPTY } from '../shell/empty.js';
import type { WindowClass } from '../../theme/tokens.js';
import { defineHcmCrashGroups } from './hcm-crash-groups.js';
import { defineHcmSetupAnalytics } from './hcm-setup-analytics.js';
import { defineHcmSetupBilling } from './hcm-setup-billing.js';
import { defineHcmSetupDeploy } from './hcm-setup-deploy.js';
import { defineHcmSetupImport } from './hcm-setup-import.js';
import { defineHcmSetupMapbox } from './hcm-setup-mapbox.js';
import { defineHcmSetupProvision } from './hcm-setup-provision.js';
import { defineHcmSetupStep, type ConsentNoteParams } from './hcm-setup-step.js';
import { defineHcmSetupUsgs } from './hcm-setup-usgs.js';
import { selfTestList, selfTestStyles } from './self-test.js';
import { SetupPortHost } from './setup-host.js';
import type { SetupIntentsPort, SetupStepId, SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';
import { formatMoney, setupLabel, setupText } from './setup-text.js';

export const HCM_SETUP_PAGE_TAG = 'hcm-setup-page';

/** From this window class the page shows the list beside the open step. */
const SPLIT_CLASSES: ReadonlySet<WindowClass> = new Set<WindowClass>(['expanded', 'large', 'extra-large']);

interface BodyInput {
    readonly view: SetupViewState;
    readonly intents: SetupIntentsPort | null;
    readonly locale: Locale;
}

/** The card body of each step that has one (sign-in and the claim are text only). */
const BODIES: Partial<Record<SetupStepId, (input: BodyInput) => TemplateResult>> = {
    billing: (input) => html`<hcm-setup-billing .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-billing>`,
    provision: (input) =>
        html`<hcm-setup-provision .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-provision>`,
    deploy: (input) => html`<hcm-setup-deploy .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-deploy>`,
    mapbox: (input) => html`<hcm-setup-mapbox .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-mapbox>`,
    usgs: (input) => html`<hcm-setup-usgs .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-usgs>`,
    analytics: (input) =>
        html`<hcm-setup-analytics .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-analytics>`,
    legacyImport: (input) =>
        html`<hcm-setup-import .view=${input.view} .intents=${input.intents} .locale=${input.locale}></hcm-setup-import>`,
};

export class HcmSetupPage extends SetupPortHost {
    static override readonly properties = {
        ...SetupPortHost.properties,
        windowClass: { type: String, reflect: true, attribute: 'window-class' },
    };

    static override readonly styles = [baseStyles, typeStyles, setupTextStyles, selfTestStyles, pageStyles()];

    /**
     * The page's width class. Only the width is followed (the page's height follows its content), and a change is
     * applied on the next frame: re-laying out inside the observer's callback would resize the page it observes
     * ("ResizeObserver loop completed with undelivered notifications").
     */
    declare windowClass: WindowClass;

    private stopObserving: (() => void) | null = null;

    constructor() {
        super();
        this.windowClass = 'compact';
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.stopObserving = observeWindowSize(this, (size) => {
            requestAnimationFrame(() => {
                this.windowClass = size.widthClass;
            });
        });
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.stopObserving?.();
        this.stopObserving = null;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const split = SPLIT_CLASSES.has(this.windowClass);
        return html`<section class="page" aria-labelledby="setup-title">
            ${this.renderHeader(view)}
            <div role="alert">${view.error === null ? nothing : html`<p class="alert">${setupText(this.language, view.error)}</p>`}</div>
            ${selfTestList(this.language, view)} ${split ? this.renderSplit(view) : this.renderColumn(view)}
        </section>`;
    }

    /** The whole assistant's counted inputs and consents, for the e2e input budget (S-A30-HAPPY). */
    protected override updated(): void {
        if (this.view !== null) {
            this.dataset['inputs'] = String(this.view.used.inputs);
            this.dataset['consents'] = String(this.view.used.consents);
        }
    }

    private renderHeader(view: SetupViewState): TemplateResult {
        const progress = setupLabel(this.language, 'adminSetup.progress', { done: String(view.done), total: String(view.total) });
        return html`<header class="header">
            <div class="ring">
                <hcm-progress kind="circular" .value=${view.done / view.total} label=${progress}></hcm-progress>
                <span class="count label-large" aria-hidden="true">${view.done}/${view.total}</span>
            </div>
            <div class="heading-text">
                <h1 id="setup-title" class="headline-small">${setupLabel(this.language, 'adminSetup.title')}</h1>
                <p class="note" role="status">${view.checking ? setupLabel(this.language, 'adminSetup.checking') : progress}</p>
                ${view.ready ? html`<p class="success ready">${setupLabel(this.language, 'adminSetup.ready')}</p>` : nothing}
            </div>
            <hcm-button
                variant="tonal"
                icon="refresh"
                ?disabled=${view.checking}
                @click=${() => {
                    this.intents?.recheck();
                }}
                >${setupLabel(this.language, 'adminSetup.recheck')}</hcm-button
            >
        </header>`;
    }

    private noteParams(view: SetupViewState): ConsentNoteParams {
        return {
            projectId: view.projectId,
            domain: view.authDomain,
            amount: formatMoney(this.language, view.billing.amount, view.billing.currency),
        };
    }

    private renderBody(view: SetupViewState, id: SetupStepId): TemplateResult {
        const body = BODIES[id];
        return body === undefined ? EMPTY : body({ view, intents: this.intents, locale: this.language });
    }

    private renderColumn(view: SetupViewState): TemplateResult {
        const noteParams = this.noteParams(view);
        return html`<ol class="steps" aria-label=${setupLabel(this.language, 'adminSetup.steps')}>
            ${view.order.map((id) => {
                const open = view.openStep === id;
                return html`<li>
                    <hcm-setup-step
                        mode="inline"
                        .step=${view.steps[id]}
                        .intents=${this.intents}
                        .noteParams=${noteParams}
                        .locale=${this.language}
                        ?open=${open}
                        >${open ? this.renderBody(view, id) : nothing}</hcm-setup-step
                    >
                </li>`;
            })}
        </ol>`;
    }

    private renderSplit(view: SetupViewState): TemplateResult {
        const open = view.openStep;
        return html`<div class="split">
            <ol class="steps list" aria-label=${setupLabel(this.language, 'adminSetup.steps')}>
                ${view.order.map(
                    (id) =>
                        html`<li>
                            <hcm-setup-step
                                mode="summary"
                                .step=${view.steps[id]}
                                .intents=${this.intents}
                                .locale=${this.language}
                                ?open=${open === id}
                            ></hcm-setup-step>
                        </li>`,
                )}
            </ol>
            <div class="detail">
                ${
                    open === null
                        ? nothing
                        : html`<hcm-setup-step
                              mode="detail"
                              .step=${view.steps[open]}
                              .intents=${this.intents}
                              .noteParams=${this.noteParams(view)}
                              .locale=${this.language}
                              open
                              >${this.renderBody(view, open)}</hcm-setup-step
                          >`
                }
            </div>
        </div>`;
    }
}

function pageStyles(): ReturnType<typeof css> {
    return css`
        :host {
            display: block;
            container-type: inline-size;
        }

        /* The list (360 px at most) and the detail (840 px at most) stay together, centred on a wide window. */
        .page {
            display: flex;
            flex-direction: column;
            gap: 16px;
            box-sizing: border-box;
            inline-size: 100%;
            max-inline-size: 1256px;
            margin-inline: auto;
            padding: 16px;
        }

        .header {
            display: flex;
            flex-wrap: wrap;
            gap: 12px 16px;
            align-items: center;
        }

        .ring {
            position: relative;
            display: grid;
            place-items: center;
        }

        .count {
            position: absolute;
        }

        .heading-text {
            flex: 1 1 16ch;
            min-inline-size: 0;
        }

        h1 {
            margin: 0;
        }

        .steps {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .split {
            display: grid;
            grid-template-columns: minmax(240px, 360px) minmax(0, 840px);
            gap: 24px;
            align-items: start;
        }

        .list {
            gap: 4px;
        }
    `;
}

/** Registers `<hcm-setup-page>`, every card and body, and the kit elements they render. */
export function defineHcmSetupPage(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineHcmProgress(registry);
    defineHcmSetupStep(registry);
    defineHcmSetupBilling(registry);
    defineHcmSetupProvision(registry);
    defineHcmSetupDeploy(registry);
    defineHcmSetupMapbox(registry);
    defineHcmSetupUsgs(registry);
    defineHcmSetupAnalytics(registry);
    defineHcmSetupImport(registry);
    defineHcmCrashGroups(registry);
    defineOnce(registry, HCM_SETUP_PAGE_TAG, HcmSetupPage);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-page': HcmSetupPage;
    }
}
