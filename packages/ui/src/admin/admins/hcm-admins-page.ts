/**
 * `<hcm-admins-page>`: `#/admins`, `#/admins/<uid>` and `#/admins/invite/<inviteId>` (`docs/research/M2c-interfaces.md`
 * §9.1; behaviour A02), in the list and detail layout. The list holds the admins (role, "you") and the pending
 * invitations (expiry); the detail shows an admin (address, role, since when, who invited them) with **Remove access**,
 * or an invitation (created, expiry, the sign-in link when it was made in this visit, copied at once and with Copy) with
 * **Cancel invitation**; both ask first. **Invite** opens a dialog for the Google account's address (checked in the page first).
 * The owner and oneself are never removable: the page offers neither and says why (the server refuses both anyway).
 */
import { inviteRequestSchema, type AdminsListResponse, type InviteResponse, type Locale, type RevokeRequest } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { AdminNoticeInputPort, AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { current, formatDay, loadingTemplate, whoText } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf, shellText } from '../shell/text.js';
import type { AdminsIntentsPort, AdminsViewState } from './admins-port.js';
import { adminsStyles, inviteDialog } from './invite-dialog.js';

export const HCM_ADMINS_PAGE_TAG = 'hcm-admins-page';

type Admin = AdminsListResponse['admins'][number];
type Invite = AdminsListResponse['invites'][number];

/** A removal or a cancellation being asked about. */
interface Pending {
    readonly request: RevokeRequest;
    readonly name: string;
}

/** How an admin is named: the Google display name, else the address. */
function nameOf(locale: Locale, admin: Admin): string {
    return admin.displayName ?? admin.email ?? shellText(locale, 'adminShell.admins.unnamed');
}

/** The open item's key (`detailKey`): an admin's uid or an invitation's id. */
function keyOf(selected: AdminsViewState['selected']): string {
    if (selected === null) {
        return '';
    }
    return selected.kind === 'admin' ? selected.uid : selected.inviteId;
}

/** What the question before a removal or a cancellation says. */
function questionOf(
    locale: Locale,
    pending: Pending | null,
): { readonly headline: string; readonly body: string; readonly confirm: string; readonly cancel: string } {
    if (pending?.request.kind === 'admin') {
        return {
            headline: contentText(locale, 'adminContent.admins.revokeConfirm', { name: pending.name }),
            body: contentText(locale, 'adminContent.admins.revokeBody'),
            confirm: contentText(locale, 'adminContent.admins.remove'),
            cancel: contentText(locale, 'adminContent.admins.keep'),
        };
    }
    return {
        headline: contentText(locale, 'adminContent.admins.cancelConfirm'),
        body: contentText(locale, 'adminContent.admins.cancelBody'),
        confirm: contentText(locale, 'adminContent.admins.cancelInvite'),
        cancel: contentText(locale, 'adminContent.admins.keepInvite'),
    };
}

/** The admin or the invitation the selection names, if the list holds it. */
function selectedItem(list: AdminsListResponse, selected: NonNullable<AdminsViewState['selected']>): Admin | Invite | undefined {
    if (selected.kind === 'admin') {
        return list.admins.find((candidate) => candidate.uid === selected.uid);
    }
    return list.invites.find((candidate) => candidate.inviteId === selected.inviteId);
}

function isAdmin(item: Admin | Invite): item is Admin {
    return 'uid' in item;
}

function namesOf(list: AdminsListResponse | null): Readonly<Record<string, string>> {
    return Object.fromEntries((list?.admins ?? []).map((admin) => [admin.uid, admin.displayName ?? admin.email ?? admin.uid]));
}

export class HcmAdminsPage extends AreaPage<AdminsViewState, AdminsIntentsPort> {
    static override readonly properties = {
        ...AreaPage.properties,
        inviting: { state: true },
        inviteIssue: { state: true },
        pending: { state: true },
        issue: { state: true },
        copied: { state: true },
    };

    static override readonly styles = [...editingStyles, adminsStyles];

    protected readonly route: AdminRouteIdPort = 'admins';
    /** The invitation dialog is open. */
    declare inviting: boolean;
    /** The dialog's message (an invalid address, a refusal). */
    declare inviteIssue: AdminNoticeInputPort | null;
    declare pending: Pending | null;
    /** A refused removal, shown in the detail. */
    declare issue: AdminNoticeInputPort | null;
    declare copied: boolean;

    constructor() {
        super();
        this.inviting = false;
        this.inviteIssue = null;
        this.pending = null;
        this.issue = null;
        this.copied = false;
    }

    protected storeOf(content: ContentPort): AreaPort<AdminsViewState, AdminsIntentsPort> | null {
        return content.admins;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const back = (): void => {
            this.go([]);
        };
        const dialog = {
            ...{ locale, open: this.inviting, busy: view.busy, issue: this.inviteIssue },
            submit: (email: string) => this.#sendInvite(email),
            close: () => {
                this.#closeInvite();
            },
        };
        return html`<hcm-list-detail
                ?detail=${view.selected !== null}
                .detailKey=${keyOf(view.selected)}
                .listLabel=${contentText(locale, 'adminContent.admins.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.admins.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${back}
            >
                <div slot="list">${this.#list(locale, view)}</div>
                <div slot="detail">${this.#detail(locale, view)}</div>
            </hcm-list-detail>
            ${inviteDialog(dialog)} ${this.#confirm(locale)}`;
    }

    #list(locale: Locale, view: AdminsViewState): TemplateResult {
        const invite = (): void => {
            this.inviteIssue = null;
            this.inviting = true;
        };
        const head = html`<div class="list-head">
            <p class="note">${shellText(locale, 'adminShell.admins.intro')}</p>
            <div class="actions">
                <hcm-button variant="filled" icon="person_add" @click=${invite}
                    >${shellText(locale, 'adminShell.admins.invite')}</hcm-button
                >
            </div>
        </div>`;
        return html`${head}${this.#listBody(locale, view)}`;
    }

    #listBody(locale: Locale, view: AdminsViewState): TemplateResult {
        if (view.list === null) {
            return view.status === 'error' ? this.#loadFailed(locale, view) : loadingTemplate(locale);
        }
        const selected = view.selected;
        return html`<div class="pane">
            <h2>${shellText(locale, 'adminShell.nav.admins')}</h2>
            <ul class="rows flush">
                ${view.list.admins.map((admin) => this.#adminRow(locale, admin, selected?.kind === 'admin' && selected.uid === admin.uid))}
            </ul>
            <h2>${shellText(locale, 'adminShell.admins.pending')}</h2>
            ${
                view.list.invites.length === 0
                    ? html`<p class="note">${shellText(locale, 'adminShell.admins.none')}</p>`
                    : html`<ul class="rows flush">
                          ${view.list.invites.map((invite) => this.#inviteRow(locale, invite, selected?.kind === 'invite' && selected.inviteId === invite.inviteId))}
                      </ul>`
            }
        </div>`;
    }

    #loadFailed(locale: Locale, view: AdminsViewState): TemplateResult {
        const retry = (): void => {
            void this.intents?.refresh();
        };
        return html`<div class="pane">
            <p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, view.failure)}</span></p>
            <div class="actions">
                <hcm-button variant="tonal" icon="refresh" @click=${retry}>${contentText(locale, 'adminContent.common.retry')}</hcm-button>
            </div>
        </div>`;
    }

    #adminRow(locale: Locale, admin: Admin, selected: boolean): TemplateResult {
        const role = shellText(locale, `adminShell.admins.role.${admin.role}`);
        const detail = admin.self ? `${role} · ${shellText(locale, 'adminShell.admins.you')}` : role;
        return html`<li>
            <a class="row" href=${this.href([admin.uid])} aria-current=${current(selected)}>
                <span class="row-title">${nameOf(locale, admin)}</span>
                <span class="row-detail">${detail}</span>
            </a>
        </li>`;
    }

    #inviteRow(locale: Locale, invite: Invite, selected: boolean): TemplateResult {
        return html`<li>
            <a class="row" href=${this.href(['invite', invite.inviteId])} aria-current=${current(selected)}>
                <span class="row-title"
                    >${contentText(locale, 'adminContent.admins.inviteTitle', { date: formatDay(locale, invite.createdAt) })}</span
                >
                <span class="row-detail"
                    >${contentText(locale, 'adminContent.admins.expires', { date: formatDay(locale, invite.expiresAt) })}</span
                >
            </a>
        </li>`;
    }

    #detail(locale: Locale, view: AdminsViewState): TemplateResult {
        const selected = view.selected;
        if (selected === null) {
            return html`<hcm-empty-state icon="group" .text=${contentText(locale, 'adminContent.admins.choose')}></hcm-empty-state>`;
        }
        if (view.list === null) {
            return view.status === 'error' ? EMPTY : loadingTemplate(locale);
        }
        return this.#item(locale, view, selectedItem(view.list, selected));
    }

    #item(locale: Locale, view: AdminsViewState, item: Admin | Invite | undefined): TemplateResult {
        if (item === undefined) {
            return this.#notFound(locale);
        }
        return isAdmin(item) ? this.#admin(locale, view, item) : this.#inviteDetail(locale, view, item);
    }

    #notFound(locale: Locale): TemplateResult {
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.admins.notFound')}</h2>
            <p><a href=${this.href([])}>${contentText(locale, 'adminContent.admins.backToList')}</a></p>
        </div>`;
    }

    #invitedBy(locale: Locale, view: AdminsViewState, invitedBy: string | undefined): TemplateResult {
        if (invitedBy === undefined) {
            return EMPTY;
        }
        return html`<dt>${contentText(locale, 'adminContent.admins.invitedBy')}</dt>
            <dd>${whoText(locale, invitedBy, this.#self(), namesOf(view.list))}</dd>`;
    }

    #self(): string | null {
        return this.state?.user?.uid ?? null;
    }

    #admin(locale: Locale, view: AdminsViewState, admin: Admin): TemplateResult {
        const name = nameOf(locale, admin);
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${name}</h2>
            ${this.#issue(locale)}
            <dl class="facts">
                <dt>${contentText(locale, 'adminContent.admins.address')}</dt>
                <dd>${admin.email ?? shellText(locale, 'adminShell.admins.unnamed')}</dd>
                <dt>${contentText(locale, 'adminContent.admins.role')}</dt>
                <dd>${shellText(locale, `adminShell.admins.role.${admin.role}`)}</dd>
                <dt>${contentText(locale, 'adminContent.admins.since')}</dt>
                <dd>${formatDay(locale, admin.createdAt)}</dd>
                ${this.#invitedBy(locale, view, admin.invitedBy)}
            </dl>
            ${this.#removeAccess(locale, view, admin, name)}
        </div>`;
    }

    /** Remove access, unless the admin is the owner or oneself (then why not). */
    #removeAccess(locale: Locale, view: AdminsViewState, admin: Admin, name: string): TemplateResult {
        if (admin.role === 'owner' || admin.self) {
            return html`<p class="note">
                ${contentText(locale, admin.role === 'owner' ? 'adminContent.admins.ownerNote' : 'adminContent.admins.selfNote')}
            </p>`;
        }
        const ask = (): void => {
            this.issue = null;
            this.pending = { request: { kind: 'admin', uid: admin.uid }, name };
        };
        return html`<div class="actions">
            <hcm-button variant="outlined" icon="person_remove" ?disabled=${view.busy} @click=${ask}
                >${contentText(locale, 'adminContent.admins.remove')}</hcm-button
            >
        </div>`;
    }

    #inviteDetail(locale: Locale, view: AdminsViewState, invite: Invite): TemplateResult {
        const created = formatDay(locale, invite.createdAt);
        const ask = (): void => {
            this.issue = null;
            this.pending = { request: { kind: 'invite', inviteId: invite.inviteId }, name: created };
        };
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.admins.inviteTitle', { date: created })}</h2>
            ${this.#issue(locale)}
            <dl class="facts">
                <dt>${contentText(locale, 'adminContent.admins.expiresLabel')}</dt>
                <dd>${formatDay(locale, invite.expiresAt)}</dd>
                <dt>${contentText(locale, 'adminContent.admins.invitedBy')}</dt>
                <dd>${whoText(locale, invite.invitedBy, this.#self(), namesOf(view.list))}</dd>
            </dl>
            ${this.#link(locale, view.invited, invite)}
            <div class="actions">
                <hcm-button variant="outlined" icon="cancel" ?disabled=${view.busy} @click=${ask}
                    >${contentText(locale, 'adminContent.admins.cancelInvite')}</hcm-button
                >
            </div>
        </div>`;
    }

    /** The sign-in link of the invitation made in this visit, with Copy; for an older one, how to send it. */
    #link(locale: Locale, invited: InviteResponse | null, invite: Invite): TemplateResult {
        if (invited?.inviteId !== invite.inviteId) {
            return html`<p class="note">${contentText(locale, 'adminContent.admins.linkLater')}</p>`;
        }
        const copy = (): void => {
            void this.#copy(invited.signInUrl);
        };
        return html`<p>${shellText(locale, 'adminShell.admins.invited', { date: formatDay(locale, invited.expiresAt) })}</p>
            <div class="field">
                <label for="link">${shellText(locale, 'adminShell.admins.link')}</label>
                <input id="link" type="url" readonly .value=${invited.signInUrl} />
            </div>
            <div class="actions">
                <hcm-button variant="tonal" icon="content_copy" @click=${copy}>${shellText(locale, 'adminShell.admins.copy')}</hcm-button>
            </div>
            <p class="note status" role="status">${this.copied ? shellText(locale, 'adminShell.admins.copied') : ''}</p>`;
    }

    #issue(locale: Locale): TemplateResult {
        return this.issue === null
            ? EMPTY
            : html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, this.issue)}</span></p>`;
    }

    async #copy(url: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(url);
            this.copied = true;
        } catch {
            this.renderRoot.querySelector<HTMLInputElement>('#link')?.select();
        }
    }

    async #sendInvite(email: string): Promise<void> {
        const parsed = inviteRequestSchema.safeParse({ email: email.trim() });
        if (!parsed.success) {
            this.inviteIssue = { key: 'adminShell.admins.invalidEmail' };
            return;
        }
        const outcome = await this.intents?.invite(parsed.data.email);
        if (outcome === undefined) {
            return;
        }
        if (!outcome.ok) {
            this.inviteIssue = outcome.error;
            return;
        }
        this.inviting = false;
        this.copied = false;
        this.go(['invite', outcome.value.inviteId]);
        void this.#copyAtOnce(outcome.value.signInUrl);
    }

    /**
     * The new invitation's link goes to the clipboard at once, from the click that made it (one input less: the owner
     * pastes it into a message next). A browser that refuses leaves the link with its Copy button, as for any copy.
     */
    async #copyAtOnce(url: string): Promise<void> {
        this.copied = await navigator.clipboard.writeText(url).then(
            () => true,
            () => false,
        );
    }

    #closeInvite(): void {
        this.inviting = false;
        this.inviteIssue = null;
    }

    #confirm(locale: Locale): TemplateResult {
        const pending = this.pending;
        const question = questionOf(locale, pending);
        const confirm = (): void => {
            this.pending = null;
            if (pending !== null) {
                void this.#revoke(pending.request);
            }
        };
        const dismiss = (): void => {
            this.pending = null;
        };
        return html`<hcm-confirm-dialog
            destructive
            .open=${pending !== null}
            .headline=${question.headline}
            .body=${question.body}
            .confirmLabel=${question.confirm}
            .cancelLabel=${question.cancel}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-confirm=${confirm}
            @hcm-cancel=${dismiss}
        ></hcm-confirm-dialog>`;
    }

    async #revoke(request: RevokeRequest): Promise<void> {
        const outcome = await this.intents?.revoke(request);
        if (outcome?.ok === false) {
            this.issue = outcome.error;
            return;
        }
        this.go([]);
    }
}

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
