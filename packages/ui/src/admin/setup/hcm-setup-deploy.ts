/**
 * The server card's body (step d, `docs/research/M6-interfaces.md` §1.8): why and what the install creates, its cost
 * against Cloud Build's free minutes, **Install the server** (one click; the same click starts the imagery pipeline),
 * the install's status (`install-status.ts`), the functions installed against the registry (once: finding 7 of
 * 2026-10-25), and, collapsed, the GitHub repository variables for an owner who prefers GitHub Actions (each with a
 * copy button). The card turns green by itself once every function answers; no Setup text names a command.
 */
import { html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { visuallyHidden } from '../../components/styles.js';
import {
    blockerLine,
    costLine,
    INSTALLABLE_STATES,
    installStatus,
    installStatusStyles,
    mayInstall,
    type InstallStatusInput,
} from './install-status.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { copyStyles, setupTextStyles } from './setup-styles.js';

const HCM_SETUP_DEPLOY_TAG = 'hcm-setup-deploy';

/** The functions' count shows once the deployment's watch has looked, and not beside a Done chip. */
function countShown(state: SetupViewState): boolean {
    const step = state.steps.deploy;
    return step.state !== 'ok' && step.checkedAt !== null;
}

/** The card's own button: an installable state the card has seen (a done step offers nothing before a look). */
function offersInstall(state: SetupViewState): boolean {
    const view = state.install.server;
    const looked = state.steps.deploy.state !== 'ok' || view.checkedAt !== null;
    return looked && INSTALLABLE_STATES.has(view.state);
}

export class HcmSetupDeploy extends SetupBody {
    static override readonly styles = [setupTextStyles, copyStyles, installStatusStyles, visuallyHidden];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const input: InstallStatusInput = {
            target: 'server',
            slice: state.install,
            locale: this.locale,
            intents: this.intents,
            step: 'deploy',
        };
        return html`<div class="body">
            <p>${this.t('adminSetup.install.server.explain')}</p>
            ${costLine(input)} ${this.renderProgress(state)} ${installStatus(input)} ${this.renderAction(state, input)}
            ${this.renderGithub(state)}
        </div>`;
    }

    /**
     * The functions installed so far, said once (the progress bar's label is the same sentence); nothing before the first
     * look nor once the step is done, where "0 of 69" beside a Done chip would only mislead (finding 9 of the M6 review).
     */
    private renderProgress(state: SetupViewState): TemplateResult {
        const status = state.deploy.watching ? this.t('adminSetup.deploy.watching') : nothing;
        const watching = html`<p class="note watching" role="status">${status}</p>`;
        if (!countShown(state)) {
            return watching;
        }
        const { ready, total } = state.deploy;
        const progress = this.t('adminSetup.deploy.progress', { ready: String(ready), total: String(total) });
        return html`<hcm-progress .value=${total === 0 ? 0 : ready / total} label=${progress}></hcm-progress>
            <p class="note" aria-hidden="true">${progress}</p>
            ${watching}`;
    }

    /**
     * Install the server while nothing (or a failed build) is in place, Try again after a stopped build; off with the reason
     * when something is missing. The install's own state decides, not the step's chip: an admin session's step (d) is done
     * while an update may have stopped (finding 1 of the M6 review). Before any look a done step offers nothing.
     */
    private renderAction(state: SetupViewState, input: InstallStatusInput): TemplateResult {
        const view = state.install.server;
        if (!offersInstall(state)) {
            return blockerLine(input, view);
        }
        const tryAgain = view.state === 'failed';
        return html`${blockerLine(input, view)}
            <div class="actions">${this.renderButton(tryAgain, !mayInstall(view) || state.steps.deploy.busy)}</div>
            ${tryAgain ? nothing : this.renderAlsoPipeline()}`;
    }

    /** The first install's click also starts the imagery pipeline (d3). */
    private renderAlsoPipeline(): TemplateResult {
        return html`<p class="note">${this.t('adminSetup.install.server.alsoPipeline')}</p>`;
    }

    private renderButton(tryAgain: boolean, disabled: boolean): TemplateResult {
        return html`<hcm-button
            variant="filled"
            icon=${tryAgain ? 'replay' : 'cloud'}
            ?disabled=${disabled}
            @click=${() => {
                this.act((intents) => {
                    intents.installServer();
                });
            }}
            >${this.t(tryAgain ? 'adminSetup.install.tryAgain' : 'adminSetup.install.server.action')}</hcm-button
        >`;
    }

    /** The optional GitHub Actions path: the repository variables its deploy job reads, collapsed. */
    private renderGithub(state: SetupViewState): TemplateResult {
        return html`<details class="github">
            <summary>${this.t('adminSetup.install.github')}</summary>
            <p>${this.t('adminSetup.install.githubExplain')}</p>
            <ul class="copy-list">
                ${state.deploy.variables.map(
                    (variable) =>
                        html`<li class="copy-row">
                            <span><code>${variable.name}</code><code class="note">${variable.value}</code></span>
                            ${this.copyButton(variable.name, this.t('adminSetup.copy', { name: variable.name }), variable.value)}
                        </li>`,
                )}
            </ul>
        </details>`;
    }
}

/** Registers `<hcm-setup-deploy>` and what it renders. */
export function defineHcmSetupDeploy(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineHcmProgress(registry);
    defineOnce(registry, HCM_SETUP_DEPLOY_TAG, HcmSetupDeploy);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-deploy': HcmSetupDeploy;
    }
}
