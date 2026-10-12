/**
 * `<hcm-sign-in>`: the `signedOut` screen (`docs/research/M2b-interfaces.md` §1.3, §3.3 a). One button opens Google's
 * popup; when the server did not answer (start-up mode) the popup asks for the read-only Cloud scope, so the consent
 * note explains it first. After a reload in start-up mode the Google token is gone: the panel asks to confirm again.
 * When Resource Manager is disabled in the project, the button enables it first ("Enable with Google").
 */
import { css, html, type TemplateResult } from 'lit';

import type { AdminStatePort } from '../admin-port.js';
import { adminBase, panelStyles } from '../shell/admin-styles.js';
import { EMPTY } from '../shell/empty.js';
import { shellText } from '../shell/text.js';
import { AdminPanel, issueTemplate } from './panel.js';

export const HCM_SIGN_IN_TAG = 'hcm-sign-in';

function introOf(state: AdminStatePort): string {
    if (state.gate.reconsent) {
        return shellText(state.locale, 'adminShell.auth.reconsent');
    }
    return state.mode === 'normal'
        ? shellText(state.locale, 'adminShell.auth.signInIntro')
        : shellText(state.locale, 'adminShell.auth.setupIntro', { projectId: state.projectId });
}

export class HcmSignIn extends AdminPanel {
    static override readonly styles = [
        adminBase,
        panelStyles,
        css`
            hcm-consent-note {
                margin-block-end: 8px;
            }
        `,
    ];

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return EMPTY;
        }
        const locale = state.locale;
        const signIn = (): void => {
            void this.app?.intents.signIn();
        };
        const enable = (): void => {
            void this.app?.intents.enableApi();
        };
        const action =
            state.gate.enableApi === null
                ? html`<hcm-button variant="filled" icon="account_circle" @click=${signIn}
                      >${shellText(locale, 'adminShell.auth.signIn')}</hcm-button
                  >`
                : html`<hcm-button variant="filled" icon="key" @click=${enable}
                      >${shellText(locale, 'adminShell.auth.enableApi')}</hcm-button
                  >`;
        return html`<section class="panel" aria-labelledby="title">
            <h1 id="title">${shellText(locale, 'adminShell.appName')}</h1>
            <p>${introOf(state)}</p>
            ${this.#note(state)} ${issueTemplate(locale, state.gate.issue)}
            <div class="actions">${action} ${state.user === null ? EMPTY : this.otherAccount(locale)}</div>
        </section>`;
    }

    /** The read-only Cloud scope is asked only when the server did not answer (start-up mode). */
    #note(state: AdminStatePort): TemplateResult {
        const scope = state.gate.enableApi === null ? 'cloudReadOnly' : 'cloudPlatform';
        return state.mode === 'normal'
            ? EMPTY
            : html`<hcm-consent-note
                  .locale=${state.locale}
                  .scope=${scope}
                  .projectId=${state.projectId}
                  .domain=${state.authDomain}
              ></hcm-consent-note>`;
    }
}

/** Registers `<hcm-sign-in>` once; calling it again is a no-op. */
export function defineHcmSignIn(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_SIGN_IN_TAG) === undefined) {
        registry.define(HCM_SIGN_IN_TAG, HcmSignIn);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-sign-in': HcmSignIn;
    }
}
