/**
 * The Mapbox card's body (step e, `docs/research/M2b-interfaces.md` §3.3 e): the scopes the secret token needs, with a
 * copy button, and the paste box (`type=password`, `autocomplete=off`): what was pasted is classified in the page
 * before any call (a public `pk.` token is explained at once). A pasted secret is sent at once, once, to the controller
 * and the box cleared (one input, like the USGS paste); a typed one goes with Enter or Save. The token never leaves the
 * box otherwise: not in a property, the state or storage.
 */
import { classifyMapboxToken, type AdminSetupKey, type ApiErrorCode } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { copyStyles, fieldStyles, setupTextStyles } from './setup-styles.js';
import { setupText } from './setup-text.js';

const HCM_SETUP_MAPBOX_TAG = 'hcm-setup-mapbox';

type Verdict = 'empty' | 'secret' | 'public' | 'unknown';

const VERDICTS: Readonly<Record<Exclude<Verdict, 'empty'>, AdminSetupKey | ApiErrorCode>> = {
    secret: 'adminSetup.mapbox.looksRight',
    public: 'apiError.mapbox.publicToken',
    unknown: 'apiError.mapbox.tokenFormat',
};

export class HcmSetupMapbox extends SetupBody {
    static override readonly properties = { ...SetupBody.properties, verdict: { state: true } };

    static override readonly styles = [setupTextStyles, fieldStyles, copyStyles];

    /** What the paste box holds, never the value itself. */
    declare verdict: Verdict;

    /** The paste box, once something was typed or pasted into it. */
    private box: HTMLInputElement | null = null;

    constructor() {
        super();
        this.verdict = 'empty';
    }

    protected override renderBody(state: SetupViewState): TemplateResult {
        const step = this.step(state, 'mapbox');
        const scopes = state.mapbox.requiredScopes;
        return html`<div class="body">
            <p>${this.t('adminSetup.mapbox.scopes')}</p>
            <div class="copy-row">
                <code class="scopes">${scopes.join(' ')}</code>
                ${this.copyButton('scopes', this.t('adminSetup.mapbox.copyScopes'), scopes.join(' '))}
            </div>
            ${state.mapbox.user === null ? nothing : html`<p class="success">${this.t('adminSetup.mapbox.saved', { user: state.mapbox.user })}</p>`}
            <div class="field">
                <label for="token">${this.t('adminSetup.mapbox.token')}</label>
                <input
                    id="token"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    autocapitalize="off"
                    aria-describedby="verdict"
                    @input=${this.onInput}
                    @keydown=${this.onKey}
                />
                <p id="verdict" class="hint" role="status">${this.renderVerdict()}</p>
            </div>
            <div class="actions">
                <hcm-button variant="filled" ?disabled=${step.busy || this.verdict === 'empty'} @click=${this.onSave}
                    >${this.t('adminSetup.mapbox.save')}</hcm-button
                >
            </div>
        </div>`;
    }

    private renderVerdict(): string {
        return this.verdict === 'empty' ? '' : setupText(this.locale, { key: VERDICTS[this.verdict] });
    }

    /** Classifies the box; a pasted secret is saved at once, any other paste counts as the step's input. */
    private readonly onInput = (event: Event): void => {
        this.box = event.target as HTMLInputElement;
        const value = this.box.value.trim();
        this.verdict = value === '' ? 'empty' : classifyMapboxToken(value);
        if ((event as InputEvent).inputType !== 'insertFromPaste') {
            return;
        }
        if (this.verdict === 'secret') {
            this.onSave();
            return;
        }
        this.act((intents) => {
            intents.noteInput('mapbox');
        });
    };

    private readonly onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
            this.onSave();
        }
    };

    /** Sends the token once and clears the box (nothing is sent from an empty box). */
    private readonly onSave = (): void => {
        const box = this.box;
        if (box === null || box.value.trim() === '') {
            return;
        }
        const token = box.value;
        box.value = '';
        this.verdict = 'empty';
        this.act((intents) => {
            intents.saveMapbox(token);
        });
    };
}

/** Registers `<hcm-setup-mapbox>` and what it renders. */
export function defineHcmSetupMapbox(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineOnce(registry, HCM_SETUP_MAPBOX_TAG, HcmSetupMapbox);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-mapbox': HcmSetupMapbox;
    }
}
