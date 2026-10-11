import { resolveLocale, translate } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

export const HCM_HELLO_TAG = 'hcm-hello';

/**
 * Scaffolding element proving the Lit toolchain end to end (build, lint, browser-mode tests,
 * coverage). Reactive properties are declared with `static properties` + `declare` fields
 * because decorators are banned (docs/research/M0-handoff.md).
 */
export class HcmHello extends LitElement {
    static override readonly properties = {
        name: { type: String },
        locale: { type: String },
    };

    static override readonly styles = css`
        :host {
            display: block;
        }

        p {
            margin: 0;
        }
    `;

    declare name: string;
    declare locale: string;

    constructor() {
        super();
        this.name = 'București';
        this.locale = 'ro';
    }

    override render(): TemplateResult {
        return html`<p role="status">${translate(resolveLocale(this.locale), 'hello.greeting', { name: this.name })}</p>`;
    }
}

/** Registers `<hcm-hello>` once; calling it again (engine and admin both do) is a no-op. */
export function defineHcmHello(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_HELLO_TAG) === undefined) {
        registry.define(HCM_HELLO_TAG, HcmHello);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-hello': HcmHello;
    }
}
