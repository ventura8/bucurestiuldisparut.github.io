import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AdminPageElement } from '../../../src/admin/admin-port.js';
import type { HcmAdminsPage } from '../../../src/admin/shell/hcm-admins-page.js';
import type { HcmPageOutlet } from '../../../src/admin/shell/hcm-page-outlet.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from './fake-app.js';

class TestPage extends HTMLElement implements AdminPageElement {
    app: AdminPageElement['app'] = null;
    state: AdminPageElement['state'] = null;
}

describe('<hcm-page-outlet>', () => {
    beforeAll(() => {
        defineAll();
        customElements.define('hcm-test-page', TestPage);
    });
    afterEach(cleanup);

    it('happyPath_theRoutesPageIsCreatedAndFollowsTheState', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'admins', params: [] } }));
        app.pages = { admins: 'hcm-test-page' };
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .app=${app} .state=${app.state}></hcm-page-outlet>`);
        await updated(outlet);

        const page = deep(outlet, 'hcm-test-page') as TestPage;
        expect(page.app).toBe(app);
        outlet.state = adminState({ route: { id: 'admins', params: ['x'] }, locale: 'ro' });
        await updated(outlet);

        expect(page.state?.locale).toBe('ro');
        expect(app.named('loadPage')).toEqual(['loadPage admins']);
    });

    it('badPath_aRouteWithoutAPageSaysSoAndAnotherRouteLoadsAgain', async () => {
        const app = new FakeAdminApp(adminState());
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .app=${app} .state=${app.state}></hcm-page-outlet>`);
        await updated(outlet);

        expect(deep(outlet, '[role="status"]').textContent).toBe('This page is not available yet.');
        app.pages = { photos: 'hcm-test-page' };
        outlet.state = adminState({ route: { id: 'photos', params: [] } });
        await updated(outlet);

        expect(deepAll(outlet, 'hcm-test-page')).toHaveLength(1);
        expect(await axeViolations(outlet)).toEqual([]);
    });

    it('badPath_aSlowerEarlierLoadNeverReplacesALaterOne', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'photos', params: [] } }));
        const pending: { release?: (tag: string) => void } = {};
        vi.spyOn(app, 'loadPage').mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    pending.release = resolve;
                }),
        );
        app.pages = { admins: 'hcm-test-page' };
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .app=${app} .state=${app.state}></hcm-page-outlet>`);
        expect(deep(outlet, '[role="status"]').textContent).toBe('Loading…');

        outlet.state = adminState({ route: { id: 'admins', params: [] } });
        await updated(outlet);
        pending.release?.('hcm-test-page');
        await updated(outlet);

        expect((deep(outlet, 'hcm-test-page') as TestPage).state?.route.id).toBe('admins');
    });

    it('badPath_withoutAnAppOrStateNothingLoads', async () => {
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .state=${adminState()}></hcm-page-outlet>`);
        const blank = await mount<HcmPageOutlet>(html`<hcm-page-outlet></hcm-page-outlet>`);

        expect(deep(outlet, '[role="status"]').textContent).toBe('Loading…');
        expect(deep(blank, '[role="status"]').textContent).toBe('');
    });
});

describe('<hcm-admins-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    async function page(app: FakeAdminApp): Promise<HcmAdminsPage> {
        const element = await mount<HcmAdminsPage>(html`<hcm-admins-page .app=${app} .state=${app.state}></hcm-admins-page>`);
        await updated(element);
        return element;
    }

    function input(root: Element, id: string): HTMLInputElement {
        return deep(root, `#${id}`) as HTMLInputElement;
    }

    it('happyPath_listsAdminsAndInvitationsWithoutTheOwnersOrOnesOwnRemove', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'admins', params: [] } }));
        const element = await page(app);

        const text = deepText(element);
        expect(text).toContain('Owner');
        expect(text).toContain('ana@e2e.test');
        expect(text).toContain('Google account without an address');
        expect(text).toContain('Invitation of');
        const removes = deepAll(element, 'hcm-icon-button').map(
            (button) => button.getAttribute('label') ?? (button as unknown as { label: string }).label,
        );
        expect(removes).toEqual([
            'Remove access for ana@e2e.test',
            'Remove access for Google account without an address',
            expect.stringContaining('Cancel the invitation of'),
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anInviteShowsTheLinkToSendAndCopiesIt', async () => {
        const app = new FakeAdminApp(adminState());
        const element = await page(app);
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

        input(element, 'email').value = '  ana.new@e2e.test ';
        deepAll(element, 'hcm-button')[0]?.click();
        await updated(element);
        deepAll(element, 'hcm-button')[1]?.click();
        await updated(element);

        expect(app.named('inviteAdmin')).toEqual(['inviteAdmin ana.new@e2e.test']);
        expect(input(element, 'link').value).toBe('https://demo-hcm.web.app/');
        expect(input(element, 'email').value).toBe('');
        expect(writeText).toHaveBeenCalledWith('https://demo-hcm.web.app/');
        expect(deep(element, '.status').textContent).toBe('The link was copied.');
        expect(app.named('listAdmins')).toHaveLength(2);
    });

    it('badPath_aClipboardRefusalSelectsTheLinkInstead', async () => {
        const app = new FakeAdminApp(adminState());
        const element = await page(app);
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        input(element, 'email').value = 'ana.new@e2e.test';
        deepAll(element, 'hcm-button')[0]?.click();
        await updated(element);

        deepAll(element, 'hcm-button')[1]?.click();
        await updated(element);

        expect(deep(element, '.status').textContent).toBe('');
    });

    it('badPath_anInvalidAddressIsRejectedBeforeAnyCall', async () => {
        const app = new FakeAdminApp(adminState());
        const element = await page(app);

        input(element, 'email').value = 'not an address';
        deepAll(element, 'hcm-button')[0]?.click();
        await updated(element);

        expect(app.named('inviteAdmin')).toEqual([]);
        expect(deep(element, '[role="alert"]').textContent).toContain('Enter a valid e-mail address.');
    });

    it('badPath_anAlreadyAdminInviteAndAFailedListShowTheirMessages', async () => {
        const app = new FakeAdminApp(adminState({ locale: 'ro' }));
        app.invite = { ok: false, error: { key: 'apiError.invite.alreadyAdmin' } };
        app.list = { ok: false, error: { key: 'apiError.unavailable' } };
        const element = await page(app);
        expect(deepAll(element, '[role="alert"]')).toHaveLength(1);

        input(element, 'email').value = 'owner@e2e.test';
        deepAll(element, 'hcm-button')[0]?.click();
        await updated(element);

        expect(deepAll(element, '.admin-row')).toEqual([]);
        expect(deep(element, '[role="alert"]').textContent.trim()).not.toBe('');
    });

    it('happyPath_removingAnAdminAndCancellingAnInvitationConfirm', async () => {
        const app = new FakeAdminApp(adminState());
        const element = await page(app);

        deepAll(element, 'hcm-icon-button')[0]?.click();
        await updated(element);
        expect(deep(element, '.status').textContent).toBe('Access was removed.');
        deepAll(element, 'hcm-icon-button').at(-1)?.click();
        await updated(element);

        expect(app.named('revokeAdmin')).toEqual([
            `revokeAdmin {"kind":"admin","uid":"admin-uid"}`,
            `revokeAdmin {"kind":"invite","inviteId":"${'a'.repeat(64)}"}`,
        ]);
        expect(deep(element, '.status').textContent).toBe('The invitation was cancelled.');
    });

    it('badPath_aRefusedRemovalShowsWhy', async () => {
        const app = new FakeAdminApp(adminState());
        app.revoke = { ok: false, error: { key: 'apiError.revoke.owner' } };
        const element = await page(app);

        deepAll(element, 'hcm-icon-button')[0]?.click();
        await updated(element);

        expect(deepAll(element, '[role="alert"]')).toHaveLength(1);
        expect(app.named('listAdmins')).toHaveLength(1);
    });

    it('badPath_noInvitationsSaysSoAndNoStateOrAppRendersNothing', async () => {
        const app = new FakeAdminApp(adminState());
        app.list = { ok: true, value: { admins: [], invites: [] } };
        const element = await page(app);
        const orphan = await mount<HcmAdminsPage>(html`<hcm-admins-page .state=${adminState()}></hcm-admins-page>`);
        const blank = await mount<HcmAdminsPage>(html`<hcm-admins-page></hcm-admins-page>`);
        await orphan.refresh();
        input(orphan, 'email').value = 'ana@e2e.test';
        deepAll(orphan, 'hcm-button')[0]?.click();
        await updated(orphan);

        expect(deepText(element)).toContain('No pending invitations.');
        expect(deepText(blank)).toBe('');
        expect(orphan.list).toBeNull();
    });
});
