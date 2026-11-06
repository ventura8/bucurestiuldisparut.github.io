import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { DATE, EAST, F039, WEST, dateRow, joinButton, openDates, planRows, seedFrame, seedTwoFrames } from './join-world.js';
import { detail, FREE_1968, imageryText, readyImagery, sceneLink } from './world.js';

// One admin test at a time: the search runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Whole-city dates and target years on Find (behaviour A66; `docs/research/M8-join-interfaces.md` §2, §5, §6): the rows are the
 * plan the page's own search wrote from the frames join-world.ts seeds, as the harvest leaves them. Joining them is join.spec.ts.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

test(
    'Whole-city dates list a summer date above a winter one; a frame that must be ordered is named, never joined',
    { tag: ['@S-A66-HAPPY', '@S-A66-BAD-PAID-FRAME'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        const [winter, paid] = ['1972-02-02', '1974-06-01'];
        await seedTwoFrames(imagery);
        await seedFrame(imagery, { entityId: 'D3C1201-200101F011', bounds: WEST, date: winter });
        await seedFrame(imagery, { entityId: 'D3C1201-200101F012', bounds: EAST, date: winter });
        await seedFrame(imagery, { entityId: 'D3C1205-200122F021', bounds: WEST, date: paid });
        await seedFrame(imagery, { entityId: 'D3C1205-200122F022', bounds: EAST, date: paid, free: false });
        await openDates(page, lang, paid);

        const rows = page.locator('[data-join-dates] [data-date]');
        await expect
            .poll(() => rows.evaluateAll((listed) => listed.map((row) => row.getAttribute('data-date'))))
            .toEqual([DATE, winter, paid]);
        await expect(joinButton(dateRow(page), lang)).toBeVisible();
        await expect(dateRow(page, winter).locator('[data-state="join-winter"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.join.winter'),
        );
        const order = dateRow(page, paid).locator('[data-state="join-paid"]');
        await expect(order).toHaveText(imageryText(lang, 'adminContent.imagery.join.paidFrameOne'));
        // The figure is the frame that can be had; the note says the other must be ordered.
        await expect(dateRow(page, paid).locator('.row-detail')).toHaveText(
            imageryText(lang, 'adminContent.imagery.join.rowCoverageOne', { percent: '54' }),
        );
        await expect(order).toHaveAttribute('href', /\/imagery\/scene\/D3C1205-200122F022$/);
        await expect(joinButton(dateRow(page, paid), lang)).toBeHidden();
        await expectStateSound(page, adminVisit('imagery.date-rows', lang));
    },
);

test(
    'Add {year} saves the year and searches, and the frames of that year rank as wanted',
    { tag: '@S-A66-HAPPY-ADD-YEAR' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        const date = '1968-12-10';
        await seedFrame(imagery, { entityId: 'DS1105-1071DF087', bounds: WEST, date });
        await seedFrame(imagery, { entityId: 'DS1105-1071DF088', bounds: EAST, date });
        await openDates(page, lang, date);
        const wanted = imageryText(lang, 'adminContent.imagery.reason.targetYear', { year: '1968' });
        await expect(sceneLink(page, lang, FREE_1968)).not.toContainText(wanted);

        const add = imageryText(lang, 'adminContent.imagery.join.addYear', { year: '1968' });
        await dateRow(page, date).getByRole('button', { name: add }).click();
        await expect(dateRow(page, date).getByRole('button', { name: add })).toBeHidden({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect
            .poll(
                async () =>
                    ((await imagery.cityWorld.emulators.document(`cities/${imagery.city}`))?.['imagery'] as { targetYears: number[] })
                        .targetYears,
            )
            .toContain(1968);
        await expect(sceneLink(page, lang, FREE_1968)).toContainText(wanted, { timeout: FUNCTIONS_TIMEOUT_MS });
    },
);

test(
    'A frame with no neighbour of its date has no row and no offer',
    { tag: '@S-A66-BAD-NO-NEIGHBOUR' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedFrame(imagery, { entityId: F039, bounds: WEST });
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneLink(page, lang, F039)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect.poll(() => planRows(imagery), { timeout: FUNCTIONS_TIMEOUT_MS }).toEqual([]);
        await expect(page.locator('[data-join-dates]')).toBeHidden();
        await sceneLink(page, lang, F039).click();
        await expect(cardImportOnScene(page, lang)).toBeVisible();
        await expect(detail(page).locator('[data-join-offer]')).toBeHidden();
    },
);

/** The open scene's Import. */
function cardImportOnScene(page: Page, lang: 'ro' | 'en') {
    return detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') });
}
