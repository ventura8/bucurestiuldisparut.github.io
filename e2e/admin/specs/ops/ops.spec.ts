import type { Page } from '@playwright/test';

import { recordLiveRegions } from '../../../support/live-regions.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { apiText, shellText } from '../../support/i18n.js';
import { contentText, expectEntries, OPS_CITY, seedCity, seedJob, seedLogLine, seedPlace } from '../../support/ops.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The operations screens (docs/research/M2c-interfaces.md §9; behaviours A02, A18, A22, A23, A40): the owner of a map
 * whose server answers opens the jobs, History, the admins, the crash reports and the dashboard. Each page follows the
 * canonical list and detail layout of its window (§1.2: both panes from 840 px of page, one pane with Back below, and on
 * a phone the open item as a full-screen editor without the navigation bar), and every screen and dialog on the way runs
 * the generic layout and accessibility checkers (the ops section of e2e/tour/states.ts).
 */
test.use({ persona: 'owner', mapOwner: 'owner', admins: ['admin'] });

const AT = new Date('2026-10-17T09:00:00.000Z');
const LATER = new Date('2026-10-24T09:00:00.000Z');

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
    'Jobs show live progress and logs, and a running job can be cancelled',
    { tag: ['@S-A18-HAPPY', '@S-A18-HAPPY-WAITING-JOB', '@S-A18-BAD-CANCEL-FINISHED', '@S-A29-HAPPY-LIST-DETAIL'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        const owner = adminWorld.accounts.owner.uid;
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(emulators, AT);
        await page.goto(adminPath(lang, 'jobs'));

        // No job yet; jobs then arrive live, as the pipeline queues and runs them.
        await expect(page.getByText(contentText(lang, 'adminContent.jobs.empty'))).toBeVisible();
        await expectStateSound(page, adminVisit('jobs.empty', lang));
        await seedJob(
            emulators,
            'scan-1',
            {
                type: 'usgs-import',
                status: 'running',
                createdBy: owner,
                progress: 0.4,
                step: 'fetch',
                steps: { fetch: { status: 'running' } },
            },
            AT,
        );
        await seedJob(emulators, 'old', { type: 'republish', status: 'succeeded', createdBy: owner, progress: 1 }, AT);
        await seedJob(
            emulators,
            'ld',
            { type: 'layer-delete', status: 'queued', createdBy: owner, params: { layerId: 'corona-1968' }, dispatchAt: LATER },
            AT,
        );
        await seedLogLine(emulators, 'scan-1', 1, 'Fetching the scene <DS1>', AT);
        const running = page.getByRole('link', { name: new RegExp(contentText(lang, 'adminContent.jobs.type.usgsImport')) });
        await expect(running).toBeVisible();
        await expectStateSound(page, adminVisit('jobs.list', lang));

        // The running job: progress, steps and log; a new log line shows at once.
        await running.click();
        const heading = page.getByRole('heading', { level: 2, name: contentText(lang, 'adminContent.jobs.type.usgsImport') });
        await expect(heading).toBeFocused();
        await expect(
            page.getByRole('progressbar', { name: contentText(lang, 'adminContent.jobs.progress', { percent: '40' }) }),
        ).toBeVisible();
        await expect(page.getByText('Fetching the scene <DS1>')).toBeVisible();
        await seedLogLine(emulators, 'scan-1', 2, 'Downloading 812 MB', AT);
        await expect(page.getByText('Downloading 812 MB')).toBeVisible();
        const { split, phone } = layoutOf(page);
        await expect(page.getByRole('region', { name: contentText(lang, 'adminContent.jobs.listLabel'), exact: true })).toBeVisible({
            visible: split,
        });
        await expect(page.getByRole('navigation', { name: shellText(lang, 'adminShell.nav.label') })).toBeVisible({ visible: !phone });
        await expectStateSound(page, adminVisit('jobs.detail', lang));

        // Esc closes the item: the list shows again with the focus back on the job it opened.
        await page.keyboard.press('Escape');
        await expect(running).toBeFocused();
        await running.click();
        await expect(heading).toBeFocused();

        // Cancel asks first, then asks the job to stop.
        await page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.cancel') }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(dialog(page).getByRole('button', { name: contentText(lang, 'adminContent.jobs.keepRunning') })).toBeFocused();
        await expectStateSound(page, adminVisit('jobs.cancel-confirm', lang));
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.jobs.cancel') })
            .click();
        await expect.poll(async () => (await emulators.document(`cities/${OPS_CITY}/jobs/scan-1`))?.['cancelRequested']).toBe(true);
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.stopping') })).toBeDisabled();

        // A finished job offers no Cancel; a job waiting for its date says when it may run.
        await page.goto(adminPath(lang, 'jobs/old'));
        await expect(page.getByRole('heading', { level: 2, name: contentText(lang, 'adminContent.jobs.type.republish') })).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.cancel') })).toHaveCount(0);
        await page.goto(adminPath(lang, 'jobs/ld'));
        await expect(page.getByText(new RegExp(contentText(lang, 'adminContent.jobs.waiting', { date: '.+' })))).toBeVisible();
    },
);

test(
    'Every edit of a place is recorded, a deleted place comes back, and a refused revert says why',
    { tag: ['@S-A23-HAPPY', '@S-A23-HAPPY-RESTORE-DELETED', '@S-A23-BAD-REFUSED-SHOWN'] },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        test.setTimeout(240_000);
        const { emulators } = adminWorld;
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(emulators, AT);
        await page.goto(adminPath(lang, 'history'));

        // A place created then renamed, another created then deleted: the history triggers record each change.
        await seedPlace(emulators, 'gara', 'Gara Veche', AT);
        await expectEntries(emulators, 'gara', 1);
        await emulators.updateFields(`cities/${OPS_CITY}/pois/gara`, { title: { ro: 'Gara de Nord' }, updatedAt: LATER }, [
            'title',
            'updatedAt',
        ]);
        await seedPlace(emulators, 'tram', 'Depoul de tramvaie', AT);
        await expectEntries(emulators, 'tram', 1);
        await emulators.deleteDocument(`cities/${OPS_CITY}/pois/tram`);
        await expectEntries(emulators, 'gara', 2);
        await expectEntries(emulators, 'tram', 2);
        // An entry names the place as it was before its change.
        await expect(page.getByRole('link', { name: /Gara Veche/ })).toBeVisible();
        await expectStateSound(page, adminVisit('history.recent', lang));

        // The Deleted filter; Restore asks first, then brings the place back.
        await page.getByLabel(contentText(lang, 'adminContent.history.actionLabel'), { exact: true }).selectOption('delete');
        const restore = page
            .getByRole('listitem')
            .filter({ hasText: 'Depoul de tramvaie' })
            .getByRole('button', { name: contentText(lang, 'adminContent.history.restore') });
        await expect(restore).toBeVisible();
        await expectStateSound(page, adminVisit('history.deleted', lang));
        await restore.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectStateSound(page, adminVisit('history.revert-confirm', lang));
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.history.restore') })
            .click();
        await expect
            .poll(async () => (await emulators.document(`cities/${OPS_CITY}/pois/tram`))?.['title'])
            .toEqual({ ro: 'Depoul de tramvaie' });

        // The renamed place's versions; reverting the rename brings the old title back.
        await page.goto(adminPath(lang, 'history/poi/gara'));
        await expect(
            page.getByRole('heading', { level: 2, name: contentText(lang, 'adminContent.history.of', { name: 'Gara de Nord' }) }),
        ).toBeVisible();
        await page.getByRole('button', { name: new RegExp(contentText(lang, 'adminContent.history.fields', { fields: 'title' })) }).click();
        await expect(page.getByText(/Gara Veche/).first()).toBeVisible();
        await expectStateSound(page, adminVisit('history.document', lang));
        await page.getByRole('button', { name: contentText(lang, 'adminContent.history.revert') }).click();
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.history.revert') })
            .click();
        await expect.poll(async () => (await emulators.document(`cities/${OPS_CITY}/pois/gara`))?.['title']).toEqual({ ro: 'Gara Veche' });

        // A version today's schema refuses (an old entry): the revert is refused, said as an alert, and nothing changes.
        await emulators.setDocument(`cities/${OPS_CITY}/pois/gara/history/0946684800000-old`, {
            entity: 'poi',
            entityId: 'gara',
            action: 'update',
            previous: { title: 7 },
            changedFields: ['title'],
            updatedBy: 'system:history',
            updatedAt: new Date('2000-01-01T00:00:00.000Z'),
        });
        await backToList(page, lang);
        const old = page.getByRole('button', { name: /2000/ });
        await old.click();
        await page.getByRole('button', { name: contentText(lang, 'adminContent.history.revert') }).click();
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.history.revert') })
            .click();
        await expect(
            page.getByRole('alert').filter({ hasText: apiText(lang, 'apiError.history.invalidSnapshot', { count: '1' }).slice(0, 40) }),
        ).toBeVisible();
        // The callable's refusal (failed-precondition) is an HTTP 400, which Chromium logs.
        await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBe(1);
        await expectStateSound(page, adminVisit('history.revert-refused', lang));
        expect((await emulators.document(`cities/${OPS_CITY}/pois/gara`))?.['title']).toEqual({ ro: 'Gara Veche' });
    },
);

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
    async ({ page, lang, adminWorld }) => {
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

        // Invite: an address refused at the field, then the invitation with its link, copied, then cancelled.
        await backToList(page, lang);
        await page
            .getByRole('button', { name: shellText(lang, 'adminShell.admins.invite') })
            .first()
            .click();
        const address = dialog(page).getByLabel(shellText(lang, 'adminShell.admins.email'));
        await address.fill('not an address');
        await address.press('Enter');
        await expect(address).toHaveAttribute('aria-invalid', 'true');
        await expectStateSound(page, adminVisit('admins.invite', lang));
        await address.fill('new.admin@e2e.test');
        await address.press('Enter');
        const link = page.getByLabel(shellText(lang, 'adminShell.admins.link'));
        await expect(link).toHaveValue(/^https:\/\//);
        await expect(page.getByText(new RegExp(shellText(lang, 'adminShell.admins.invited', { date: '.+' })))).toBeVisible();
        await page.getByRole('button', { name: shellText(lang, 'adminShell.admins.copy') }).click();
        await expect(page.getByText(shellText(lang, 'adminShell.admins.copied'))).toBeVisible();
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
            /^https:\/\/console\.cloud\.google\.com\/errors\?project=/,
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
        const owner = adminWorld.accounts.owner.uid;
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(emulators, AT);
        await emulators.setDocument('setup/status', {
            billing: { state: 'ok' },
            provision: { state: 'ok' },
            mapbox: { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' },
            updatedBy: 'system:setup',
            updatedAt: AT,
        });
        await emulators.setDocument(`manifests/${OPS_CITY}`, {
            requestedVersion: 2,
            builtVersion: 2,
            status: 'idle',
            builtAt: AT,
            updatedBy: 'system:publish',
            updatedAt: AT,
        });
        await seedJob(emulators, 'scan-1', { type: 'usgs-import', status: 'running', createdBy: owner }, AT);
        await seedPlace(emulators, 'gara', 'Gara de Nord', AT);
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
