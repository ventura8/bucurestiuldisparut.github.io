import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AdminsIntentsPort, AdminsViewState } from '../../../src/admin/admins/admins-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { adminsState, page } from './fixtures.js';

const INVITED = { inviteId: 'a'.repeat(64), expiresAt: '2026-10-24T10:00:00.000Z', signInUrl: 'https://demo-hcm.web.app/' };

function area(
    state: AdminsViewState,
    answers: Partial<Record<keyof AdminsIntentsPort, unknown>> = {},
): FakeArea<AdminsViewState, AdminsIntentsPort> {
    return new FakeArea<AdminsViewState, AdminsIntentsPort>(state, {
        invite: Promise.resolve({ ok: true, value: INVITED }),
        revoke: Promise.resolve({ ok: true, value: { revoked: true } }),
        refresh: Promise.resolve(),
        ...answers,
    });
}

async function openInvite(element: HTMLElement): Promise<HTMLInputElement> {
    deep(element, '.list-head hcm-button').click();
    await updated(element);
    return deep(element, '#email') as HTMLInputElement;
}

describe('<hcm-admins-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theAdminsAndInvitationsAsLinksToTheirDetail', async () => {
        const admins = area(adminsState());
        const { element } = await page('admins', admins);

        const rows = deepAll(element, 'a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual([
            '#/admins/owner-uid',
            '#/admins/admin-uid',
            '#/admins/quiet-uid',
            `#/admins/invite/${'a'.repeat(64)}`,
        ]);
        expect(rows[0]?.textContent).toContain('Owner · You');
        expect(rows[2]?.textContent).toContain('Google account without an address');
        expect(rows[3]?.textContent).toContain('Expires on Oct 24, 2026');
        expect(deepText(element)).toContain('Choose an admin or an invitation to see its details.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anAdminsDetailAndRemovingTheirAccessAfterTheQuestion', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }));
        const { element, app } = await page('admins', admins, { params: ['admin-uid'] });

        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('ana@e2e.test');
        expect(deepText(deep(element, '.facts'))).toContain('Invited by you');
        deep(element, '.pane > .actions hcm-button').click();
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; open: boolean };
        expect([dialog.open, dialog.headline]).toEqual([true, 'Remove access for ana@e2e.test?']);
        expect(await axeViolations(element)).toEqual([]);
        deep(dialog, '.confirm').click();
        await updated(element);

        expect(admins.named('revoke')).toEqual(['revoke {"kind":"admin","uid":"admin-uid"}']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"admins","params":[]}']);
    });

    it('badPath_aReadOnlyPageNeitherInvitesNorRemoves', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }));
        const { element } = await page('admins', admins, { params: ['admin-uid'], revoked: true });
        const off = (target: HTMLElement): boolean => (target as HTMLElement & { disabled: boolean }).disabled;

        expect(off(deep(element, '.pane > .actions hcm-button'))).toBe(true);
        // The list's Invite (the dialog's own Invite cannot open without it).
        const invite = deepAll(element, 'hcm-button').find((button) => button.textContent.includes('Invite'));
        expect(invite === undefined ? false : off(invite)).toBe(true);
    });

    it('badPath_cancellingTheQuestionKeepsTheAdmin', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }));
        const { element } = await page('admins', admins, { params: ['admin-uid'] });

        deep(element, '.pane > .actions hcm-button').click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.cancel').click();
        await updated(element);

        expect(admins.named('revoke')).toEqual([]);
    });

    it('badPath_theOwnerAndOneselfOfferNoRemovalAndSayWhy', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'owner-uid' } }));
        const { element, app } = await page('admins', admins, { params: ['owner-uid'] });
        expect(deepText(element)).toContain("The owner's access cannot be removed");
        expect(deepAll(element, '.pane > .actions hcm-button')).toHaveLength(0);

        admins.set({ selected: { kind: 'admin', uid: 'quiet-uid' } });
        app.set({ route: { id: 'admins', params: ['quiet-uid'] } });
        await updated(element);
        expect(deepText(deep(element, '.facts'))).toContain('Invited by another admin');

        admins.set({
            list: { admins: [{ uid: 'owner-uid', role: 'admin', createdAt: '2026-10-01T10:00:00.000Z', self: true }], invites: [] },
            selected: { kind: 'admin', uid: 'owner-uid' },
        });
        await updated(element);
        expect(deepText(element)).toContain('You cannot remove your own access');
    });

    it('badPath_aRefusedRemovalShowsTheServersReason', async () => {
        const admins = area(adminsState({ selected: { kind: 'admin', uid: 'admin-uid' } }), {
            revoke: Promise.resolve({ ok: false, error: { key: 'apiError.revoke.self' } }),
        });
        const { element, app } = await page('admins', admins, { params: ['admin-uid'] });

        deep(element, '.pane > .actions hcm-button').click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);

        expect(deep(element, '.pane [role="alert"]').textContent).toContain('You cannot remove yourself');
        expect(app.named('navigate')).toEqual([]);
    });
});

describe('<hcm-admins-page>: invitations and failures', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_anInvitationIsMadeItsLinkCopiedAtOnceAndAgainAndThenCancelled', async () => {
        const admins = area(adminsState());
        const { element, app } = await page('admins', admins);
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
        const input = await openInvite(element);
        input.value = 'new.admin@e2e.test';
        deep(element, 'hcm-dialog hcm-button[icon="person_add"]').click();
        await updated(element);

        expect(admins.named('invite')).toEqual(['invite "new.admin@e2e.test"']);
        expect(app.named('navigate')).toEqual([`navigate {"id":"admins","params":["invite","${'a'.repeat(64)}"]}`]);
        await vi.waitFor(() => {
            expect(writeText.mock.calls).toEqual([['https://demo-hcm.web.app/']]);
        });

        admins.set({ selected: { kind: 'invite', inviteId: 'a'.repeat(64) }, invited: INVITED });
        await updated(element);
        expect(deepAll(element, '[role="status"]').map((status) => status.textContent.trim())).toContain('The link was copied.');
        deepAll(element, '.pane .actions hcm-button')[0]?.click();
        await updated(element);
        expect(writeText).toHaveBeenCalledTimes(2);

        deepAll(element, '.pane .actions hcm-button')[1]?.click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);
        expect(admins.named('revoke')).toEqual([`revoke {"kind":"invite","inviteId":"${'a'.repeat(64)}"}`]);
    });

    it('badPath_anInvalidAddressIsShownAtTheFieldAndARefusalToo', async () => {
        const admins = area(adminsState(), { invite: Promise.resolve({ ok: false, error: { key: 'apiError.invite.alreadyAdmin' } }) });
        const { element } = await page('admins', admins);
        const input = await openInvite(element);

        input.value = 'not an address';
        input.closest('form')?.requestSubmit();
        await updated(element);
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(deep(element, '#email-error').textContent).toBe('Enter a valid e-mail address.');
        expect(admins.named('invite')).toEqual([]);

        input.value = 'ana@e2e.test';
        input.closest('form')?.requestSubmit();
        await updated(element);
        expect(deep(element, '#email-error').textContent).toBe('This person already administers the map.');
        deep(element, 'hcm-dialog hcm-button[variant="text"]').click();
        await updated(element);
        expect((deep(element, 'hcm-dialog') as HTMLElement & { open: boolean }).open).toBe(false);
    });

    it('badPath_aClipboardThatRefusesTheNewLinkLeavesItWithCopy', async () => {
        const admins = area(adminsState());
        const { element } = await page('admins', admins);
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        const input = await openInvite(element);
        input.value = 'new.admin@e2e.test';
        input.closest('form')?.requestSubmit();
        await updated(element);
        await vi.waitFor(() => {
            expect(writeText).toHaveBeenCalledTimes(1);
        });

        admins.set({ selected: { kind: 'invite', inviteId: 'a'.repeat(64) }, invited: INVITED });
        await updated(element);
        expect(deepAll(element, '[role="status"]').map((status) => status.textContent.trim())).not.toContain('The link was copied.');
        expect(deepAll(element, '.pane .actions hcm-button')).toHaveLength(2);
    });

    it('badPath_anOlderInvitationExplainsTheLinkAndAClipboardRefusalSelectsIt', async () => {
        const admins = area(adminsState({ selected: { kind: 'invite', inviteId: 'a'.repeat(64) } }));
        const { element } = await page('admins', admins, { params: ['invite', 'a'.repeat(64)] });
        expect(deepText(element)).toContain('opens the admin');

        admins.set({ invited: INVITED });
        await updated(element);
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        deepAll(element, '.pane .actions hcm-button')[0]?.click();
        await updated(element);
        const link = deep(element, '#link') as HTMLInputElement;

        expect([link.selectionStart, link.selectionEnd]).toEqual([0, 'https://demo-hcm.web.app/'.length]);
    });

    it('badPath_withoutAStoreThePageIsEmptyAndAnInvitationWithoutAnAnswerKeepsTheDialog', async () => {
        const { element } = await page('admins', null);
        expect(element.shadowRoot?.childElementCount).toBe(0);
        cleanup();

        const silent = new FakeArea<AdminsViewState, AdminsIntentsPort>(adminsState());
        const second = await page('admins', silent);
        const input = await openInvite(second.element);
        input.value = 'new.admin@e2e.test';
        input.closest('form')?.requestSubmit();
        await updated(second.element);

        expect(silent.named('invite')).toEqual(['invite "new.admin@e2e.test"']);
        expect((deep(second.element, 'hcm-dialog') as HTMLElement & { open: boolean }).open).toBe(true);
    });

    it('badPath_loadingAFailedListWithTryAgainAndAnUnknownAddress', async () => {
        const admins = area(adminsState({ status: 'loading', list: null, selected: { kind: 'admin', uid: 'x' } }));
        const { element } = await page('admins', admins, { params: ['x'] });
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(2);

        admins.set({ status: 'error', failure: { key: 'apiError.unavailable' } });
        await updated(element);
        deep(element, '.pane .actions hcm-button').click();
        expect(admins.named('refresh')).toEqual(['refresh']);
        expect(deepAll(element, '[role="alert"]')).toHaveLength(1);

        admins.set({ status: 'ready', list: { admins: [], invites: [] }, failure: null });
        await updated(element);
        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('This admin or invitation no longer exists.');
        expect(deepText(element)).toContain('No pending invitations.');
    });
});
