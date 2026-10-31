import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { UpstreamCall, UpstreamControl } from '../../support/upstream.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { ADMIN_ORIGIN } from '../../world.js';
import { AT, cityAddress, ownerCity } from '../assists/world.js';
import { failedItemId, failJob, inboxRow, notifyText } from './world.js';

// One admin test at a time: the owner's devices and settings, and the server's fake FCM, are the project's.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Push on this device (behaviour A47, docs/research/M4-interfaces.md §5.4): Notifications on this device asks the
 * browser's own permission; granted, the `e2e` build's registrar hands over a fixed registration of the test (no browser
 * test may reach FCM) and `notify.registerDevice` checks it with the fake FCM of the server's world before storing it.
 * A failed job is then pushed in the admin's language with its page's address; a kind turned off is not. A browser that
 * refuses keeps the inbox, which still counts what happens.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The test's registration, as the `e2e` build's registrar makes it from `?test=`. */
const TEST_ID = 'S-A47-HAPPY';
const REGISTRATION = `e2e-fcm-token:${TEST_ID}-browser-0001`;

/** The notifications FCM was asked to deliver (dry runs left out), as the server sent them. */
async function pushed(upstream: UpstreamControl): Promise<Record<string, unknown>[]> {
    const calls: UpstreamCall[] = await upstream.calls('server', 'fcm.send');
    return calls
        .map((call) => JSON.parse(call.body) as { validate_only?: boolean; message: Record<string, unknown> })
        .filter((body) => body.validate_only !== true)
        .map((body) => body.message);
}

function deviceSwitch(page: Page, lang: 'ro' | 'en') {
    return page.locator('hcm-inbox-page [data-push]').getByRole('switch', { name: notifyText(lang, 'adminContent.notify.push.turnOn') });
}

test(
    'Push is turned on with the browser’s own permission and sends the chosen kinds',
    { tag: '@S-A47-HAPPY' },
    async ({ page, lang, adminWorld, upstream, inputBudget }) => {
        const city = ownerCity(adminWorld);
        const owner = adminWorld.accounts.owner.uid;
        await page.context().grantPermissions(['notifications'], { origin: ADMIN_ORIGIN });
        await page.goto(cityAddress(lang, 'inbox', TEST_ID));

        // Notifications on this device (the browser's prompt is granted): the registration is checked, then stored.
        await inputBudget.flow('pushOn', contentFlowBudget('pushOn')).click(deviceSwitch(page, lang));
        await expect(page.locator('hcm-inbox-page')).toContainText(notifyText(lang, 'adminContent.notify.push.on'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const devices = Object.values(await adminWorld.emulators.collection(`admins/${owner}/pushDevices`));
        expect(devices).toEqual([expect.objectContaining({ token: REGISTRATION, lang })]);
        expect(await adminWorld.emulators.document(`admins/${owner}/notify/settings`)).toMatchObject({ push: true });
        await expectStateSound(page, adminVisit('notify.push-on', lang));

        // A failed job: the device gets it in the admin's language, with the job's page.
        await failJob(city, 'j-pushed', AT);
        await expect.poll(async () => (await pushed(upstream)).length, { timeout: FUNCTIONS_TIMEOUT_MS }).toBe(1);
        expect((await pushed(upstream))[0]).toMatchObject({
            fid: REGISTRATION,
            webpush: {
                notification: { body: notifyText(lang, 'adminContent.notify.event.job.failed', { label: 'usgs-import' }) },
                // M5 (docs/research/M5-interfaces.md §1.9): a city's event opens that city's page.
                fcm_options: { link: `https://demo-hcm.web.app/admin/#/c/${city.city}/jobs` },
            },
        });

        // Processing failed turned off: the next failure reaches the inbox, and no device.
        const kind = page.locator('hcm-inbox-page li[data-kind="job.failed"]').getByRole('switch');
        await kind.click();
        await expect
            .poll(async () => (await adminWorld.emulators.document(`admins/${owner}/notify/settings`))?.['pushKinds'])
            .not.toContain('job.failed');
        await failJob(city, 'j-quiet', AT);
        await expect(inboxRow(page, failedItemId(city, 'j-quiet'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect
            .poll(
                async () => (await adminWorld.emulators.document(`notificationEvents/${failedItemId(city, 'j-quiet')}`))?.['fannedOutAt'],
                {
                    timeout: FUNCTIONS_TIMEOUT_MS,
                },
            )
            .toBeDefined();
        expect(await pushed(upstream)).toHaveLength(1);
    },
);

test(
    'A browser that refuses notifications keeps the inbox',
    { tag: '@S-A47-BAD-PERMISSION-DENIED' },
    async ({ page, lang, adminWorld }) => {
        const city = ownerCity(adminWorld);
        const owner = adminWorld.accounts.owner.uid;
        // The browser's own answer: notifications blocked for the admin's origin (the prompt is the browser's, not ours).
        const browser = await page.context().newCDPSession(page);
        const { targetInfo } = await browser.send('Target.getTargetInfo');
        await browser.send('Browser.setPermission', {
            permission: { name: 'notifications' },
            setting: 'denied',
            origin: ADMIN_ORIGIN,
            ...(targetInfo.browserContextId === undefined ? {} : { browserContextId: targetInfo.browserContextId }),
        });
        await page.goto(cityAddress(lang, 'inbox'));

        await deviceSwitch(page, lang).click();
        await expect(page.locator('hcm-inbox-page [role="alert"]')).toContainText(notifyText(lang, 'adminContent.notify.push.denied'));
        expect(await adminWorld.emulators.collection(`admins/${owner}/pushDevices`)).toEqual({});
        await expectStateSound(page, adminVisit('notify.push-denied', lang));

        // The inbox still counts the next event.
        await failJob(city, 'j-inbox', AT);
        await expect(inboxRow(page, failedItemId(city, 'j-inbox'))).toHaveAttribute('data-unread', '', { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(page.locator('hcm-admin-nav [data-badge]').first()).toBeVisible();
    },
);
