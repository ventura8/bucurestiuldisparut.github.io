import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { recordLiveRegions } from '../../../support/live-regions.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { shellText } from '../../support/i18n.js';
import { projectCity, PROJECT_CITY } from '../../support/content.js';
import { contentText, seedCity, seedJob, seedPlace } from '../../support/ops.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The operations screens that read the project's singletons (docs/research/M2c-interfaces.md §9; behaviours A02, A22,
 * A40): the owner of a map whose server answers opens the admins, the crash reports (the server's world of the fake
 * upstreams) and the dashboard (`setup/status`); the jobs and History, which read a city only, are
 * e2e/tour/admin-jobs.tour.ts. Each page follows the
 * canonical list and detail layout of its window (§1.2: both panes from 840 px of page, one pane with Back below, and on
 * a phone the open item as a full-screen editor without the navigation bar), and every screen and dialog on the way runs
 * the generic layout and accessibility checkers (the ops section of e2e/tour/states.ts).
 */
test.use({ persona: 'owner', mapOwner: 'owner', admins: ['admin'] });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The page area of the window, as the list and detail layout measures it (the rail takes the rest). */
function layoutOf(page: Page): { readonly split: boolean; readonly phone: boolean } {
    const width = page.viewportSize()?.width ?? 0;
    return { split: width >= 1200, phone: width < 600 };
}

/**
 * From an open item back to its list where one pane shows at a time: Back below 1200 px of window, Close on a phone
 * (its full-screen editor). Both panes show side by side from 1200 px, where nothing needs to go back.
 */
async function backToList(page: Page, lang: 'ro' | 'en'): Promise<void> {
    const { split, phone } = layoutOf(page);
    if (split) {
        return;
    }
    const name = contentText(lang, phone ? 'adminContent.common.close' : 'adminContent.common.back');
    await page.getByRole('button', { name, exact: true }).click();
}

/**
 * The open dialog (the page behind it is inert). Its content is slotted into the kit's `hcm-dialog` (light DOM), not a
 * descendant of the native `<dialog>` in its shadow root, so the element is the scope.
 */
function dialog(page: Page) {
    return page.locator('hcm-dialog[open]');
}

test(
    'Admins: an invitation is made, its link copied and cancelled; nobody removes the owner',
    {
        tag: [
            '@S-A02-HAPPY-INVITE-AND-CANCEL',
            '@S-A02-BAD-REVOKE-CANCELLED',
            '@S-A02-BAD-OWNER-NOT-REVOCABLE',
            '@S-A02-BAD-INVALID-EMAIL',
        ],
    },
    async ({ page, lang, adminWorld, inputBudget }) => {
        const { emulators, accounts } = adminWorld;
        await page.context().addInitScript(recordLiveRegions);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto(adminPath(lang, 'admins'));
        await expect(page.getByRole('link', { name: /admin@e2e\.test/ })).toBeVisible();
        await expectStateSound(page, adminVisit('admins.list', lang));

        // The owner (oneself here) has no Remove access: the page says why.
        await page.getByRole('link', { name: new RegExp(shellText(lang, 'adminShell.admins.role.owner')) }).click();
        await expect(page.getByText(contentText(lang, 'adminContent.admins.ownerNote'))).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.admins.remove') })).toHaveCount(0);

        // Another admin: Remove access asks first; Keep access keeps them.
        await backToList(page, lang);
        await page.getByRole('link', { name: /admin@e2e\.test/ }).click();
        await expect(page.getByRole('heading', { level: 2, name: 'admin@e2e.test' })).toBeVisible();
        await expectStateSound(page, adminVisit('admins.detail', lang));
        await page.getByRole('button', { name: contentText(lang, 'adminContent.admins.remove') }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectStateSound(page, adminVisit('admins.revoke-confirm', lang));
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.admins.keep') })
            .click();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.admins.remove') })).toBeFocused();
        expect(await emulators.document(`admins/${accounts.admin.uid}`)).toBeDefined();

        // Invite: an address refused at the field (not counted: the bad path's own inputs), then the invitation in three
        // inputs (Invite, the address, Enter), its link already copied; then cancelled.
        await backToList(page, lang);
        const flow = inputBudget.flow('inviteAdmin', contentFlowBudget('inviteAdmin'));
        await flow.click(page.getByRole('button', { name: shellText(lang, 'adminShell.admins.invite') }).first());
        const address = dialog(page).getByLabel(shellText(lang, 'adminShell.admins.email'));
        await address.fill('not an address');
        await address.press('Enter');
        await expect(address).toHaveAttribute('aria-invalid', 'true');
        await expectStateSound(page, adminVisit('admins.invite', lang));
        await flow.fill(address, 'new.admin@e2e.test');
        await flow.press(address, 'Enter');
        const link = page.getByLabel(shellText(lang, 'adminShell.admins.link'));
        await expect(link).toHaveValue(/^https:\/\//);
        await expect(page.getByText(new RegExp(shellText(lang, 'adminShell.admins.invited', { date: '.+' })))).toBeVisible();
        await expect(page.getByText(shellText(lang, 'adminShell.admins.copied'))).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());
        expect(flow.used).toBe(3);
        await expectStateSound(page, adminVisit('admins.invite-link', lang));
        expect(Object.keys(await emulators.collection('invites'))).toHaveLength(1);
        await page.getByRole('button', { name: contentText(lang, 'adminContent.admins.cancelInvite') }).click();
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.admins.cancelInvite') })
            .click();
        await expect.poll(async () => Object.keys(await emulators.collection('invites')).length).toBe(0);
    },
);

test.describe('signed in as an admin who is not the owner', () => {
    test.use({ persona: 'admin' });

    test('Admins: an admin cannot remove their own access', { tag: ['@S-A02-BAD-LAST-ADMIN'] }, async ({ page, lang, adminWorld }) => {
        await page.goto(adminPath(lang, `admins/${adminWorld.accounts.admin.uid}`));
        await expect(page.getByRole('heading', { level: 2, name: 'admin@e2e.test' })).toBeVisible();
        await expect(page.getByText(contentText(lang, 'adminContent.admins.selfNote'))).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.admins.remove') })).toHaveCount(0);
    });
});

test(
    'Crash groups are browsed by period with their details, and a disabled Error Reporting is explained',
    { tag: ['@S-A22-HAPPY-CRASH-DETAIL', '@S-A22-BAD-CRASHES-API-DISABLED'] },
    async ({ page, lang, upstream, consoleErrors }) => {
        await page.context().addInitScript(recordLiveRegions);
        await page.goto(adminPath(lang, 'crashes'));
        await expect(page.getByText(contentText(lang, 'adminContent.crashes.empty'))).toBeVisible();
        await expectStateSound(page, adminVisit('crashes.empty', lang));

        await upstream.scenario('error-reporting.twoGroups', 'server');
        await page.getByRole('radio', { name: contentText(lang, 'adminContent.crashes.period.720') }).click();
        const group = page.getByRole('button', { name: /TypeError: Cannot read properties of undefined/ });
        await expect(group).toBeVisible();
        await expectStateSound(page, adminVisit('crashes.list', lang));
        await group.click();
        // The detail's facts are slotted into the layout's pane (light DOM), so they are found from the page.
        await expect(page.getByRole('term')).toHaveText(
            (['count', 'firstSeen', 'lastSeen', 'service', 'state'] as const).map((key) =>
                contentText(lang, `adminContent.crashes.${key}`),
            ),
        );
        await expect(page.getByRole('definition').first()).toHaveText('12');
        await expect(page.getByRole('link', { name: contentText(lang, 'adminContent.crashes.openConsole') })).toHaveAttribute(
            'href',
            /^https:\/\/console\.cloud\.google\.com\/errors\/detail\/[^/?]+\?project=/,
        );
        await expectStateSound(page, adminVisit('crashes.detail', lang));

        await upstream.fail('error-reporting', 'apiDisabled', 'server');
        await backToList(page, lang);
        await page.getByRole('radio', { name: contentText(lang, 'adminContent.crashes.period.24') }).click();
        await expect(page.getByRole('link', { name: contentText(lang, 'adminContent.crashes.openSetup') })).toHaveAttribute(
            'href',
            '#/setup/analytics',
        );
        await expect(page.getByText(contentText(lang, 'adminContent.crashes.apiDisabled'))).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.common.retry') })).toBeVisible();
        // The callable's refusal (failed-precondition) is an HTTP 400, which Chromium logs.
        await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBe(1);
        await expectStateSound(page, adminVisit('crashes.error', lang));
    },
);

test(
    "The dashboard counts the city, says what waits, and shows each service's state",
    { tag: ['@S-A40-HAPPY', '@S-A40-BAD-SERVICE-NEEDS-ATTENTION'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        const city = projectCity(emulators, adminWorld.accounts.owner.uid);
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(city, AT);
        await emulators.setDocument('setup/status', {
            billing: { state: 'ok' },
            provision: { state: 'ok' },
            mapbox: { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' },
            updatedBy: 'system:setup',
            updatedAt: AT,
        });
        await emulators.setDocument(`manifests/${PROJECT_CITY}`, {
            requestedVersion: 2,
            builtVersion: 2,
            status: 'idle',
            builtAt: AT,
            updatedBy: 'system:publish',
            updatedAt: AT,
        });
        await seedJob(city, 'scan-1', { type: 'usgs-import', status: 'running', createdBy: city.uid }, AT);
        await seedPlace(city, 'gara', 'Gara de Nord', AT);
        await page.goto(adminPath(lang, 'home'));

        const jobs = page.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.activeJobs')}`) });
        await expect(jobs).toBeVisible();
        await expect(page.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.pois')}`) })).toBeVisible();
        await expect(page.getByText(new RegExp(`Mapbox: ${shellText(lang, 'adminShell.home.state.invalid')}`))).toBeVisible();
        await expect(page.getByRole('link', { name: shellText(lang, 'adminShell.home.openSetup'), exact: true })).toHaveAttribute(
            'href',
            '#/setup',
        );
        await expectStateSound(page, adminVisit('home.dashboard', lang));
        await jobs.click();
        await expect(page).toHaveURL(/#\/jobs$/);
    },
);

/** The navigation (a bar on a phone, a rail on a wider window). */
function navigation(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('navigation', { name: shellText(lang, 'adminShell.nav.label') });
}

/** `setup/status` with billing, provisioning and Mapbox done, and USGS as given. */
async function seedStatus(emulators: Parameters<typeof projectCity>[0], usgs: 'ok' | 'pending'): Promise<void> {
    await emulators.setDocument('setup/status', {
        billing: { state: 'ok' },
        provision: { state: 'ok' },
        mapbox: { state: 'ok' },
        usgs: { state: usgs },
        updatedBy: 'system:setup',
        updatedAt: AT,
    });
}

test(
    "Once Setup is complete an empty address opens the dashboard, which takes Setup's place on a phone's bar",
    { tag: ['@S-A40-HAPPY-FIRST-SCREEN'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await seedCity(projectCity(emulators, adminWorld.accounts.owner.uid), AT);
        await seedStatus(emulators, 'ok');

        await page.goto(adminPath(lang));

        const home = navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.home'), exact: true });
        await expect(home).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('hcm-home-page')).toBeVisible();
        // A phone's bar: Home, Photos, Places, Layers, with Setup under More; a rail lists them all.
        await expect(home).toBeVisible();
        await expect(navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.setup'), exact: true })).toBeVisible({
            visible: !layoutOf(page).phone,
        });
        // This browser remembers it: the next empty address opens the dashboard at once.
        await page.reload();
        await expect(home).toHaveAttribute('aria-current', 'page');
    },
);

test(
    'While Setup is not complete an empty address still opens Setup, which keeps its place on the bar',
    { tag: ['@S-A40-BAD-SETUP-INCOMPLETE'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await seedCity(projectCity(emulators, adminWorld.accounts.owner.uid), AT);
        await seedStatus(emulators, 'pending');

        await page.goto(adminPath(lang));

        const setup = navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.setup'), exact: true });
        await expect(setup).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('hcm-setup-page')).toBeVisible();
        // A phone's bar keeps Setup, with Home under More; a rail lists them all.
        await expect(setup).toBeVisible();
        await expect(navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.home'), exact: true })).toBeVisible({
            visible: !layoutOf(page).phone,
        });
    },
);

/** A second city of the project, owned by the map's owner too (a reset removes it: not a content world's). */
const SECOND_CITY = 'iasi';

/** The map's owner as an owner of the project's city and of `SECOND_CITY`. */
async function ownTwoCities(emulators: Parameters<typeof projectCity>[0], uid: string): Promise<void> {
    await seedCity(projectCity(emulators, uid), AT);
    await seedCity({ emulators, city: SECOND_CITY, uid }, AT);
    await emulators.updateFields(`admins/${uid}`, { cities: { [PROJECT_CITY]: 'owner', [SECOND_CITY]: 'owner' } }, ['cities']);
}

test(
    "An admin of two cities: once Setup is complete an empty address opens their city's dashboard, its address naming the city",
    { tag: ['@S-A49-HAPPY-FIRST-SCREEN'] },
    async ({ page, lang, adminWorld }) => {
        // docs/LESSONS.md 257: the empty address became #/setup before Setup's readiness was known, and stayed on Setup.
        const { emulators } = adminWorld;
        await ownTwoCities(emulators, adminWorld.accounts.owner.uid);
        await seedStatus(emulators, 'ok');

        await page.goto(adminPath(lang));

        await expect(page.locator('hcm-home-page')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#/c/${PROJECT_CITY}/home$`));
    },
);

test(
    'An admin of two cities: while Setup is not complete an empty address opens Setup and stays empty',
    { tag: ['@S-A49-BAD-FIRST-SCREEN-INCOMPLETE'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await ownTwoCities(emulators, adminWorld.accounts.owner.uid);
        await seedStatus(emulators, 'pending');

        await page.goto(adminPath(lang));

        await expect(page.locator('hcm-setup-page')).toBeVisible();
        await expect(
            navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.setup'), exact: true }),
        ).toHaveAttribute('aria-current', 'page');
        expect(new URL(page.url()).hash).toBe('');
    },
);
