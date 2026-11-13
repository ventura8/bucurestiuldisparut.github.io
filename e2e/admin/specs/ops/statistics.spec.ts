import type { Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../../packages/admin/src/google/scopes.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { projectCity } from '../../support/content.js';
import { contentText } from '../../support/ops.js';
import { seedPhotosCity } from '../../support/photos.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Statistics view's numbers (behaviour A153, DECISIONS-for-review.md §203): the owner of a provisioned map whose
 * Google Analytics is linked opens Crashes → Where people get stuck and presses Show the numbers here. Google's consent is
 * the mock APIs' stand-in (the read-only Analytics scope only); the measurement id comes from `setup.analyticsConfig`
 * (the server's world), the property from the Analytics Admin API and the numbers from the Data API (the browser's world);
 * Error Reporting's groups are `telemetry.listGroups`.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const AT = new Date('2026-10-01T09:00:00.000Z');

test.beforeEach(async ({ adminWorld, upstream }) => {
    await seedPhotosCity(projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid), AT);
    await upstream.scenario('google.provisioned', 'both');
    await upstream.scenario('firebase-management.analyticsLinked', 'both');
    await upstream.scenario('analytics-data.registered', 'browser');
});

async function openStatistics(page: Page, lang: 'ro' | 'en') {
    await page.goto(adminPath(lang, 'crashes/statistics'));
    const numbers = page.locator('[data-statistics-numbers]');
    await expect(numbers.getByRole('heading', { name: contentText(lang, 'adminContent.statistics.numbers.title') })).toBeVisible();
    return { numbers, show: numbers.getByRole('button', { name: contentText(lang, 'adminContent.statistics.numbers.show') }) };
}

test(
    'Show the numbers here: one read-only consent, then the overview, the apps and the new city funnel; a period read once',
    { tag: ['@S-A153-HAPPY-NUMBERS'] },
    async ({ page, lang, consent, inputBudget, upstream, consoleErrors }) => {
        await upstream.scenario('analytics-data.sample', 'browser');
        await upstream.scenario('error-reporting.twoGroups', 'server');
        const { numbers, show } = await openStatistics(page, lang);
        await expect(numbers.locator('hcm-consent-note')).toHaveAttribute('scope', 'analyticsRead');

        const popup = await consent.opened(page, () => show.click());
        expect(await popup.requestedScopes()).toEqual([GOOGLE_SCOPES.analyticsRead]);
        await popup.allow(inputBudget.flow('statistics-consent', 1));

        await expect(numbers.locator('[data-statistics-visitors]')).toHaveText('120');
        await expect(numbers.getByText(contentText(lang, 'adminContent.statistics.numbers.notMeasured'))).toBeVisible();
        await expect(numbers.locator('[data-funnel="new_city"]')).toContainText('3 (30 %)');
        await expect(page.locator('[data-statistics-crashes] a.external')).toHaveCount(2);
        await expectStateSound(page, adminVisit('crashes.statistics-numbers', lang));

        const periods = numbers.getByRole('radio', { name: contentText(lang, 'adminContent.statistics.numbers.days.7') });
        await periods.click();
        await expect(numbers.locator('[data-statistics-visitors]')).toHaveText('30');
        await numbers.getByRole('radio', { name: contentText(lang, 'adminContent.statistics.numbers.days.28') }).click();
        await expect(numbers.locator('[data-statistics-visitors]')).toHaveText('120');
        expect(await upstream.calls('browser', 'analytics-data')).toHaveLength(6);
        expect(await consent.requests()).toHaveLength(1);

        // Refresh lists the period's error groups again: Error Reporting off is said with the way to Setup.
        await upstream.fail('error-reporting', 'apiDisabled', 'server');
        await numbers.getByRole('button', { name: contentText(lang, 'adminContent.statistics.numbers.refresh') }).click();
        await expect(
            page.locator('[data-statistics-crashes]').getByText(contentText(lang, 'adminContent.crashes.apiDisabled')),
        ).toBeVisible();
        await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'A refused Analytics consent reads nothing and says to tick the permission next time',
    { tag: ['@S-A153-BAD-CONSENT-REFUSED'] },
    async ({ page, lang, consent, inputBudget, upstream }) => {
        const { numbers, show } = await openStatistics(page, lang);

        const popup = await consent.opened(page, () => show.click());
        await popup.cancel(inputBudget.flow('statistics-consent', 1));

        await expect(numbers.getByRole('alert')).toContainText(contentText(lang, 'adminContent.statistics.problem.consent'));
        await expect(show).toBeEnabled();
        expect(await upstream.calls('browser', 'analytics-data')).toEqual([]);
    },
);

test(
    'The Data API off: the view says so and leads to Setup and to the API in the Google Cloud console',
    { tag: ['@S-A153-BAD-API-DISABLED'] },
    async ({ page, lang, consent, inputBudget, upstream, consoleErrors }) => {
        await upstream.fail('analytics-data', 'apiDisabled', 'browser');
        const { numbers, show } = await openStatistics(page, lang);

        const popup = await consent.opened(page, () => show.click());
        await popup.allow(inputBudget.flow('statistics-consent', 1));

        await expect(numbers.getByRole('alert')).toContainText(contentText(lang, 'adminContent.statistics.problem.apiDisabled'));
        await expect(numbers.getByRole('link', { name: contentText(lang, 'adminContent.statistics.problem.openSetup') })).toHaveAttribute(
            'href',
            '#/setup',
        );
        await expect(
            numbers.getByRole('link', { name: new RegExp(contentText(lang, 'adminContent.statistics.problem.openConsole').slice(0, 20)) }),
        ).toHaveAttribute('href', /^https:\/\/console\.cloud\.google\.com\/apis\/library\/analyticsdata\.googleapis\.com\?project=/);
        await expectStateSound(page, adminVisit('crashes.statistics-problem', lang));
        expect(consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
    },
);
