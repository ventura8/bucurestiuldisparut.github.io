/**
 * The admins area (`docs/research/M2c-interfaces.md` §9.1; behaviour A02): the admins and the pending invitations
 * (`admins.list`), an invitation (`admins.invite`: the server keeps only the address's hash and answers the sign-in
 * link, which the inviter sends), and removing an admin or cancelling an invitation (`admins.revoke`). The owner and
 * oneself are never removable (the server refuses both, `revoke.owner` and `revoke.self`, so a map always keeps an admin;
 * the page offers neither). `#/admins/<uid>` selects an admin, `#/admins/invite/<inviteId>` an invitation.
 */
import { inviteRequestSchema, type AdminsListResponse, type InviteResponse, type RevokeRequest } from '@hcm/shared';

import { outcomeOf, type Outcome } from '../app/services.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import type { LoadStatus } from '../content/list.js';
import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { Store } from '../state/store.js';

export type AdminSelection =
    { readonly kind: 'admin'; readonly uid: string } | { readonly kind: 'invite'; readonly inviteId: string } | null;

export interface AdminsState {
    readonly status: LoadStatus;
    readonly list: AdminsListResponse | null;
    /** Why the list could not be read (shown with Try again). */
    readonly failure: NoticeInput | null;
    /** From the route; the page shows "not found" when the list has no such admin or invitation. */
    readonly selected: AdminSelection;
    /** The invitation made in this visit, with its sign-in link (shown with Copy). */
    readonly invited: InviteResponse | null;
    /** An invitation or a removal is running. */
    readonly busy: boolean;
}

export interface AdminsIntents {
    refresh(): Promise<void>;
    /** Invites an address (validated first: `apiError.invalidRequest` without a call). */
    invite(email: string): Promise<Outcome<InviteResponse>>;
    revoke(request: RevokeRequest): Promise<Outcome<{ readonly revoked: true }>>;
    /** Forgets the link shown after an invitation. */
    dismissInvited(): void;
}

const INITIAL: AdminsState = { status: 'loading', list: null, failure: null, selected: null, invited: null, busy: false };

/** The selection an address names: `[uid]` or `['invite', inviteId]`. */
export function selectionOf(params: readonly string[]): AdminSelection {
    const [first, second] = params;
    if (first === undefined) {
        return null;
    }
    return first === 'invite' && second !== undefined ? { kind: 'invite', inviteId: second } : { kind: 'admin', uid: first };
}

class AdminsStore implements AreaStore<AdminsState, AdminsIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<AdminsState>;
    #loaded = false;
    readonly intents: AdminsIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<AdminsState>(INITIAL, services.log);
        this.intents = {
            refresh: () => this.#refresh(),
            invite: (email) => this.#invite(email),
            revoke: (request) => this.#revoke(request),
            dismissInvited: () => {
                this.#cell.update({ invited: null });
            },
        };
    }

    get state(): AdminsState {
        return this.#cell.state;
    }

    subscribe(listener: (state: AdminsState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        this.#cell.update({ selected: selectionOf(params) });
        if (!this.#loaded) {
            this.#loaded = true;
            void this.#refresh();
        }
    }

    close(): void {
        this.#loaded = false;
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
        this.#cell.update(INITIAL);
    }

    async #refresh(): Promise<void> {
        this.#cell.update({ status: this.#cell.state.list === null ? 'loading' : 'ready' });
        const outcome = await outcomeOf(() => this.#services.callables.call('admins.list', {}));
        if (outcome.ok) {
            this.#cell.update({ status: 'ready', list: outcome.value, failure: null });
            return;
        }
        this.#cell.update({ status: this.#cell.state.list === null ? 'error' : 'ready', failure: outcome.error });
    }

    async #invite(email: string): Promise<Outcome<InviteResponse>> {
        const parsed = inviteRequestSchema.safeParse({ email: email.trim() });
        if (!parsed.success) {
            return { ok: false, error: { key: 'adminShell.admins.invalidEmail' } };
        }
        this.#cell.update({ busy: true });
        const outcome = await outcomeOf(() => this.#services.callables.call('admins.invite', parsed.data));
        this.#cell.update({ busy: false, invited: outcome.ok ? outcome.value : this.#cell.state.invited });
        if (outcome.ok) {
            this.#services.notify({ key: 'adminContent.admins.invitedNotice' });
            await this.#refresh();
        }
        return outcome;
    }

    async #revoke(request: RevokeRequest): Promise<Outcome<{ readonly revoked: true }>> {
        this.#cell.update({ busy: true });
        const outcome = await outcomeOf(() => this.#services.callables.call('admins.revoke', request));
        this.#cell.update({ busy: false });
        if (outcome.ok) {
            this.#services.notify({ key: request.kind === 'admin' ? 'adminShell.admins.removed' : 'adminShell.admins.cancelled' });
            await this.#refresh();
        }
        return outcome;
    }
}

export const ADMINS_MODULE: AreaModule<AdminsState, AdminsIntents> = {
    area: 'admins',
    create: (services) => new AdminsStore(services),
};
