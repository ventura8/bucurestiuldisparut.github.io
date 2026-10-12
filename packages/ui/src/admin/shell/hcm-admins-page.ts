/**
 * `<hcm-admins-page>`: `#/admins` (`docs/research/M2b-interfaces.md` §1.1; scenario A02). Lists the admins and the
 * pending invitations (`admins.list`), invites a Google address (`admins.invite`: only the address's hash is kept, and
 * the inviter sends the sign-in link themselves, so the page shows it with a copy button) and removes an admin or cancels
 * an invitation (`admins.revoke`; never the owner, never oneself: the server refuses, the page offers neither).
 */
import { inviteRequestSchema, type AdminsListResponse, type InviteResponse, type Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { AdminNoticeInputPort, AdminOutcomePort } from '../admin-port.js';
import { AdminPanel, issueTemplate } from '../auth/panel.js';
import { EMPTY } from './empty.js';
import { noticeOf, shellText } from './text.js';
import { adminsPageStyles } from './admins-styles.js';

export const HCM_ADMINS_PAGE_TAG = 'hcm-admins-page';

type Admin = AdminsListResponse['admins'][number];
type Invite = AdminsListResponse['invites'][number];

/** How an admin is named: the Google display name, else the address. */
function nameOf(locale: Locale, admin: Admin): string {
    return admin.displayName ?? admin.email ?? shellText(locale, 'adminShell.admins.unnamed');
}

function dateOf(locale: Locale, iso: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

export class HcmAdminsPage extends AdminPanel {
    static override readonly properties = {
        ...AdminPanel.properties,
        list: { state: true },
        issue: { state: true },
        invited: { state: true },
        status: { state: true },
    };

    static override readonly styles = adminsPageStyles;

    declare list: AdminsListResponse | null;
    declare issue: AdminNoticeInputPort | null;
    declare invited: InviteResponse | null;
    /** A polite confirmation (the link copied, an access removed). */
    declare status: AdminNoticeInputPort | null;
    #requested = false;

    constructor() {
        super();
        this.list = null;
        this.issue = null;
        this.invited = null;
        this.status = null;
    }

    protected override willUpdate(): void {
        if (this.app !== null && !this.#requested) {
            this.#requested = true;
            void this.refresh();
        }
    }

    /** Reads the admins and the invitations again. */
    async refresh(): Promise<void> {
        const outcome = await this.app?.intents.listAdmins();
        if (outcome === undefined) {
            return;
        }
        this.list = outcome.ok ? outcome.value : this.list;
        this.issue = outcome.ok ? null : outcome.error;
    }

    override render(): TemplateResult {
        const state = this.state;
        if (state === null) {
            return EMPTY;
        }
        const locale = state.locale;
        return html`<section class="page" aria-labelledby="title">
            <h1 id="title">${shellText(locale, 'adminShell.nav.admins')}</h1>
            ${issueTemplate(locale, this.issue)}
            <p class="status" role="status">${noticeOf(locale, this.status)}</p>
            ${this.#inviteForm(locale)} ${this.#admins(locale)} ${this.#invites(locale)}
        </section>`;
    }

    #inviteForm(locale: Locale): TemplateResult {
        const submit = (event: SubmitEvent): void => {
            event.preventDefault();
            const input = (event.currentTarget as HTMLFormElement).elements.namedItem('email') as HTMLInputElement;
            void this.#invite(input);
        };
        // The kit's button is not a native submit button: its click submits the form it sits in.
        const press = (event: Event): void => {
            (event.currentTarget as HTMLElement).closest('form')?.requestSubmit();
        };
        return html`<form class="invite" @submit=${submit} novalidate>
            <p>${shellText(locale, 'adminShell.admins.intro')}</p>
            <label for="email">${shellText(locale, 'adminShell.admins.email')}</label>
            <div class="row">
                <input id="email" name="email" type="email" autocomplete="off" spellcheck="false" maxlength="254" />
                <hcm-button variant="filled" icon="add" @click=${press}>${shellText(locale, 'adminShell.admins.invite')}</hcm-button>
            </div>
            ${this.#invitedLink(locale)}
        </form>`;
    }

    async #invite(input: HTMLInputElement): Promise<void> {
        const parsed = inviteRequestSchema.safeParse({ email: input.value.trim() });
        if (!parsed.success) {
            this.issue = { key: 'adminShell.admins.invalidEmail' };
            input.focus();
            return;
        }
        const outcome = await this.app?.intents.inviteAdmin(parsed.data.email);
        if (outcome !== undefined) {
            await this.#invited(outcome, input);
        }
    }

    async #invited(outcome: AdminOutcomePort<InviteResponse>, input: HTMLInputElement): Promise<void> {
        if (!outcome.ok) {
            this.issue = outcome.error;
            return;
        }
        input.value = '';
        this.invited = outcome.value;
        this.issue = null;
        await this.refresh();
    }

    #invitedLink(locale: Locale): TemplateResult {
        const invited = this.invited;
        if (invited === null) {
            return EMPTY;
        }
        const copy = (): void => {
            void this.#copy(invited.signInUrl);
        };
        return html`<div class="invited">
            <p>${shellText(locale, 'adminShell.admins.invited', { date: dateOf(locale, invited.expiresAt) })}</p>
            <label for="link">${shellText(locale, 'adminShell.admins.link')}</label>
            <div class="row">
                <input id="link" type="url" readonly .value=${invited.signInUrl} />
                <hcm-button variant="tonal" icon="content_copy" @click=${copy}>${shellText(locale, 'adminShell.admins.copy')}</hcm-button>
            </div>
        </div>`;
    }

    async #copy(url: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(url);
            this.status = { key: 'adminShell.admins.copied' };
        } catch {
            this.renderRoot.querySelector<HTMLInputElement>('#link')?.select();
        }
    }

    #admins(locale: Locale): TemplateResult {
        const admins = this.list?.admins ?? [];
        return admins.length === 0
            ? EMPTY
            : html`<h2>${shellText(locale, 'adminShell.nav.admins')}</h2>
                  <ul class="rows">
                      ${admins.map((admin) => this.#adminRow(locale, admin))}
                  </ul>`;
    }

    #adminRow(locale: Locale, admin: Admin): TemplateResult {
        const name = nameOf(locale, admin);
        return html`<li class="admin-row">
            <span class="who"><span class="name">${name}</span><span class="detail">${admin.email ?? ''}</span></span>
            <span class="chips">
                <span class="chip">${shellText(locale, `adminShell.admins.role.${admin.role}`)}</span>
                ${admin.self ? html`<span class="chip">${shellText(locale, 'adminShell.admins.you')}</span>` : EMPTY}
            </span>
            ${this.#removeButton(locale, admin, name)}
        </li>`;
    }

    /** Never on the owner's row nor one's own: the server would refuse both. */
    #removeButton(locale: Locale, admin: Admin, name: string): TemplateResult {
        if (admin.role === 'owner' || admin.self) {
            return EMPTY;
        }
        const remove = (): void => {
            void this.#revoke({ kind: 'admin', uid: admin.uid }, 'adminShell.admins.removed');
        };
        return html`<hcm-icon-button
            icon="close"
            .label=${shellText(locale, 'adminShell.admins.remove', { name })}
            @click=${remove}
        ></hcm-icon-button>`;
    }

    #invites(locale: Locale): TemplateResult {
        if (this.list === null) {
            return EMPTY;
        }
        return html`<h2>${shellText(locale, 'adminShell.admins.pending')}</h2>
            ${this.#inviteList(locale, this.list.invites)}`;
    }

    #inviteList(locale: Locale, invites: readonly Invite[]): TemplateResult {
        if (invites.length === 0) {
            return html`<p class="empty">${shellText(locale, 'adminShell.admins.none')}</p>`;
        }
        return html`<ul class="rows">
            ${invites.map((invite) => this.#inviteRow(locale, invite))}
        </ul>`;
    }

    #inviteRow(locale: Locale, invite: Invite): TemplateResult {
        const dates = { created: dateOf(locale, invite.createdAt), expires: dateOf(locale, invite.expiresAt) };
        const cancel = (): void => {
            void this.#revoke({ kind: 'invite', inviteId: invite.inviteId }, 'adminShell.admins.cancelled');
        };
        return html`<li class="admin-row">
            <span class="who">${shellText(locale, 'adminShell.admins.inviteRow', dates)}</span>
            <hcm-icon-button icon="close" .label=${shellText(locale, 'adminShell.admins.cancel', dates)} @click=${cancel}></hcm-icon-button>
        </li>`;
    }

    async #revoke(
        request: { readonly kind: 'admin'; readonly uid: string } | { readonly kind: 'invite'; readonly inviteId: string },
        done: 'adminShell.admins.removed' | 'adminShell.admins.cancelled',
    ): Promise<void> {
        const outcome = await this.app?.intents.revokeAdmin(request);
        if (outcome?.ok === false) {
            this.issue = outcome.error;
            return;
        }
        this.status = { key: done };
        await this.refresh();
    }
}

/** Registers `<hcm-admins-page>` once; calling it again is a no-op. */
export function defineHcmAdminsPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ADMINS_PAGE_TAG) === undefined) {
        registry.define(HCM_ADMINS_PAGE_TAG, HcmAdminsPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admins-page': HcmAdminsPage;
    }
}
