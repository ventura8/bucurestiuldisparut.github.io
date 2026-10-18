import type { Browser, BrowserContext, Page } from '@playwright/test';
import { translateAdminShell } from '@hcm/shared';

import { installNetwork, Recorder } from '../../../support/network.js';
import { testIdOf } from '../../../support/test.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { FLOWS_CITY, flowText, seedPublicCity } from '../../support/flows.js';
import { signedInStorageState } from '../../support/session.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { ADMIN_ORIGIN } from '../../world.js';
import { seedCategories, seedPlace } from '../pois/places.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Two admins at once (behaviour A02; docs/research/M2c-interfaces.md §2.2, §9.1): an invited admin edits a place while the
 * owner, in another browser, removes their access. The removal asks first and names the admin; afterwards the admin is
 * listed no more, their claim is gone and their sessions are revoked; their Save is refused by the rules (an admin must
 * still have `admins/{uid}`), nothing is written, and the shell tells them the account is no longer an admin.
 */
test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The owner's own browser: a second context signed in as the owner, behind the same firewall as the test's page. */
async function ownersBrowser(
    browser: Browser,
    emulators: EmulatorWorld,
    network: { readonly api: Parameters<typeof installNetwork>[1]; readonly testId: string; readonly blocked: Recorder },
): Promise<BrowserContext> {
    const context = await browser.newContext({
        baseURL: ADMIN_ORIGIN,
        viewport: { width: 1440, height: 900 },
        storageState: signedInStorageState(await emulators.signIn('owner'), Date.now()) as never,
    });
    await installNetwork(context, network.api, network.testId, network.blocked, { upstream: true });
    return context;
}

/** The kit's open dialog (its actions are slotted content of the element). */
function dialog(page: Page) {
    return page.locator('hcm-dialog[open]');
}

test(
    'An admin whose access is removed while editing cannot save, and is told',
    { tag: ['@S-A02-BAD-REVOKE'] },
    async ({ page, lang, adminWorld, browser, mockApiRequest, consoleErrors }, testInfo) => {
        test.setTimeout(180_000);
        const { emulators, accounts } = adminWorld;
        await seedPublicCity(emulators, AT);
        await seedCategories(emulators, AT);
        await seedPlace(emulators, { id: 'gara', title: 'Gara Veche', at: [26.07, 44.446] }, AT, accounts.owner.uid);

        // The admin opens the place and changes its title: a draft, nothing written yet.
        await page.goto(adminPath(lang, 'pois/gara'));
        const title = page.getByRole('textbox', { name: flowText(lang, 'adminContent.pois.field.titleRo') });
        await expect(title).toHaveValue('Gara Veche');
        await title.fill('Gara de Nord');

        // Meanwhile the owner removes the admin's access, which asks first and names the admin.
        const blocked = new Recorder();
        const owners = await ownersBrowser(browser, emulators, { api: mockApiRequest, testId: testIdOf(testInfo), blocked });
        const owner = await owners.newPage();
        await owner.goto(adminPath(lang, `admins/${accounts.admin.uid}`));
        await owner.getByRole('button', { name: flowText(lang, 'adminContent.admins.remove') }).click();
        await expect(
            owner.getByRole('dialog', { name: flowText(lang, 'adminContent.admins.revokeConfirm', { name: 'admin@e2e.test' }) }),
        ).toBeVisible();
        await dialog(owner)
            .getByRole('button', { name: flowText(lang, 'adminContent.admins.remove') })
            .click();
        await expect.poll(() => emulators.document(`admins/${accounts.admin.uid}`)).toBeUndefined();
        await owner.goto(adminPath(lang, 'admins'));
        await expect(
            owner.getByRole('link', { name: new RegExp(translateAdminShell(lang, 'adminShell.admins.role.owner')) }),
        ).toBeVisible();
        await expect(owner.getByRole('link', { name: /admin@e2e\.test/ })).toHaveCount(0);
        const revoked = await emulators.account(accounts.admin.uid);
        expect(revoked.claims['admin']).toBeUndefined();
        expect(revoked.validSince).toBeGreaterThan(0);
        await owners.close();
        expect(blocked.take(), "the owner's browser reached only the loopback and mocked hosts").toEqual([]);

        // The admin's Save is refused by the rules (an admin must still have `admins/{uid}`) and writes nothing; the shell
        // asks admin.session again and says the account is no longer an admin. (Keeping the draft on screen meanwhile is
        // S-A20-BAD-REVOKED-WHILE-EDITING, still planned: today the page and its draft give way to that panel.)
        await page.getByRole('button', { name: flowText(lang, 'adminContent.common.save'), exact: true }).click();
        await expect(page.getByText(translateAdminShell(lang, 'adminShell.auth.notAdmin'))).toBeVisible();
        expect((await emulators.document(`cities/${FLOWS_CITY}/pois/gara`))?.['title']).toEqual({ ro: 'Gara Veche' });
        // The refused commit is an HTTP 403 from Firestore, which Chromium logs.
        await expect.poll(() => consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
    },
);
