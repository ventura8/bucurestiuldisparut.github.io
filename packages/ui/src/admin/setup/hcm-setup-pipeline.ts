/**
 * The imagery pipeline card's body (step d3, `docs/research/M6-interfaces.md` §1.8, §4.1): the first install starts
 * with the server's (Install the server starts both). Its own button is Try again after a failure, and **Install the
 * pipeline** once the server is there but the pipeline is not (a server installed from GitHub Actions, or a pipeline
 * blocked at the server's click whose blocker has lifted: finding 3 of the M6 review). It shows the build's status
 * (`install-status.ts`), the cost line and, before the server's click, when it will start.
 */
import { html, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { visuallyHidden } from '../../components/styles.js';
import { EMPTY } from '../shell/empty.js';
import { blockerLine, costLine, installStatus, installStatusStyles, mayInstall, type InstallStatusInput } from './install-status.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';

const HCM_SETUP_PIPELINE_TAG = 'hcm-setup-pipeline';

/** The states whose button is Try again. */
const TRY_AGAIN: ReadonlySet<string> = new Set(['failed', 'unavailable']);

/**
 * The pipeline installs on its own click: looked at, not installed, and the server's click is no longer what starts it
 * (the server is in place or was installed some other way).
 */
function installsAlone(state: SetupViewState): boolean {
    const { server, pipeline } = state.install;
    return pipeline.state === 'notInstalled' && pipeline.checkedAt !== null && server.state !== 'notInstalled';
}

class HcmSetupPipeline extends SetupBody {
    static override readonly styles = [setupTextStyles, installStatusStyles, visuallyHidden];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const input: InstallStatusInput = {
            target: 'pipeline',
            slice: state.install,
            locale: this.locale,
            intents: this.intents,
            step: 'pipeline',
        };
        return html`<div class="body">
            <p>${this.t('adminSetup.install.pipeline.explain')}</p>
            ${costLine(input)} ${this.renderWaiting(state)} ${installStatus(input)} ${blockerLine(input, state.install.pipeline)}
            ${this.renderAction(state)}
        </div>`;
    }

    /** Before the server's click, when the pipeline starts. */
    private renderWaiting(state: SetupViewState): TemplateResult {
        const { server, pipeline } = state.install;
        return pipeline.state === 'notInstalled' && server.buildId === null && !installsAlone(state)
            ? html`<p class="note">${this.t('adminSetup.install.pipeline.waitsForServer')}</p>`
            : EMPTY;
    }

    /** Try again after a stopped build; Install the pipeline once the server is there without it; else nothing. */
    private renderAction(state: SetupViewState): TemplateResult {
        const view = state.install.pipeline;
        const tryAgain = TRY_AGAIN.has(view.state);
        if (!tryAgain && !installsAlone(state)) {
            return EMPTY;
        }
        return html`<div class="actions">
            <hcm-button
                variant="filled"
                icon=${tryAgain ? 'replay' : 'cloud'}
                ?disabled=${!mayInstall(view)}
                @click=${() => {
                    this.act((intents) => {
                        intents.install('pipeline');
                    });
                }}
                >${this.t(tryAgain ? 'adminSetup.install.tryAgain' : 'adminSetup.install.pipeline.action')}</hcm-button
            >
        </div>`;
    }
}

/** Registers `<hcm-setup-pipeline>` and what it renders. */
export function defineHcmSetupPipeline(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmIcon(registry);
    defineOnce(registry, HCM_SETUP_PIPELINE_TAG, HcmSetupPipeline);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-pipeline': HcmSetupPipeline;
    }
}
