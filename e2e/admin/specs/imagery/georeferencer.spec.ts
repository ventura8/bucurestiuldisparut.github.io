import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import {
    addPair,
    errorsLine,
    georeferencerReady,
    georefText,
    landmark,
    openGeoreferencer,
    pairRows,
    removePair,
    scanPane,
    transformRadio,
} from './georef.js';
import { detail, errorText, imageryText, importFromList, readyImagery, versionState } from './world.js';

// One admin test at a time: the import that needs points runs in the server's world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The georeferencer (behaviours A12, A16; docs/research/M3-interfaces.md §6, §10.4): a frame whose automatic matching
 * found too few pairs waits for points with its four corner pairs; the admin pairs landmarks of the synthetic world (a
 * click on the scan, a click on the map, or the keyboard's crosshairs), and every change refits live (`fitTransform` of
 * `@hcm/shared`): the residual table, the errors, the transforms each pair count allows, and pairs that span no area are
 * refused (the page's own check, `adminContent.georef.degenerate`; the server's is `apiError.imagery.degenerateGcps`).
 * Save hands the points to `imagery.saveGcps` and the same job continues from georeferencing.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** A message with its `{param}` holes as a pattern (`.+` for each, the given ones literally). */
function pattern(text: string): RegExp {
    return new RegExp(text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+'));
}

test(
    'GCP editing updates residuals, transform and preview, and saving queues a job',
    { tag: ['@S-A16-HAPPY', '@S-A12-BAD-AUTOGCP-FAILS'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // The matcher finds too few pairs; once the admin's points are saved, the same job measures 28.4 m.
        await imagery.script({ attempts: [{ outcome: 'no-match' }, { outcome: 'over' }] });
        const versionId = await importFromList(page, lang, 'DS1035-1057DA023');

        // The job waits for points, says why, and offers the georeferencer (S-A12-BAD-AUTOGCP-FAILS).
        await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(pattern(errorText(lang, 'apiError.imagery.noMatch')))).toBeVisible();
        await detail(page)
            .getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })
            .click();
        await georeferencerReady(page, lang);
        await expect(pairRows(page, lang)).toHaveCount(4);
        await expect(page.getByRole('switch', { name: georefText(lang, 'adminContent.georef.preview') })).toBeChecked();

        // Two landmarks paired: six pairs allow the second-order polynomial; two more for the checks below.
        await expect(transformRadio(page, lang, 'poly2')).toBeDisabled();
        await addPair(page, lang, landmark(0));
        await expect(pairRows(page, lang)).toHaveCount(5);
        await expect(pairRows(page, lang).last()).toContainText(georefText(lang, 'adminContent.georef.origin.manual'));
        await addPair(page, lang, landmark(1));
        await expect(transformRadio(page, lang, 'poly2')).toBeEnabled();
        await transformRadio(page, lang, 'poly2').check();
        await addPair(page, lang, landmark(2));
        await addPair(page, lang, landmark(3));
        await expect(pairRows(page, lang)).toHaveCount(8);

        // A pair left out of the fit becomes the checkpoint; another one deleted: seven pairs still fit the polynomial.
        await pairRows(page, lang).first().getByRole('checkbox').uncheck();
        await expect(errorsLine(page)).toContainText(pattern(georefText(lang, 'adminContent.georef.checkpoint', { count: '1' })));
        await removePair(page, lang, 8);
        await expect(pairRows(page, lang)).toHaveCount(7);

        // Save: the waiting job goes on from georeferencing, on the admin's points.
        await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') }).click();
        await expect(page).toHaveURL(new RegExp(`#/imagery/version/${versionId}$`), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const georef = (await imagery.version(versionId))?.['georef'] as {
            method: string;
            transform: string;
            gcps: { enabled: boolean }[];
        };
        expect([georef.method, georef.transform, georef.gcps.length, georef.gcps.filter((gcp) => !gcp.enabled).length]).toEqual([
            'gcps',
            'poly2',
            7,
            1,
        ]);
        expect((await imagery.runs()).map((run) => [run.jobId, run.attempt])).toEqual([
            [versionId, 1],
            [versionId, 2],
        ]);

        // Over the threshold, the admin's points still need Approve: one click sends the version to the publisher.
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })
            .click();
        await expect
            .poll(async () => (await imagery.version(versionId))?.['approval'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ auto: false });
    },
);

test(
    'Too few GCPs disable the transform',
    { tag: '@S-A16-BAD-TOO-FEW-GCPS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);
        await expect(pairRows(page, lang)).toHaveCount(4);

        // Two of the four corner pairs deleted: two left, one short of an affine fit.
        for (const number of [4, 3]) {
            await removePair(page, lang, number);
        }
        await expect(pairRows(page, lang)).toHaveCount(2);
        await expect(
            page.getByRole('alert').filter({ hasText: georefText(lang, 'adminContent.georef.tooFew.one', { missing: '1' }) }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeDisabled();
        await expect(transformRadio(page, lang, 'poly2')).toBeDisabled();
        await expect(transformRadio(page, lang, 'tps')).toBeDisabled();
        await expectStateSound(page, adminVisit('georef.too-few', lang));
    },
);

test(
    'An RMSE over the threshold shows a warning',
    { tag: '@S-A16-BAD-RMSE-OVER-THRESHOLD' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);

        // A landmark paired 800 m off its place: the checks disagree by far more than the city's 15 m.
        await addPair(page, lang, landmark(0), 800);
        const warning = page
            .getByRole('alert')
            .filter({ hasText: pattern(georefText(lang, 'adminContent.georef.rmseOver', { threshold: '15' })) });
        await expect(warning).toBeVisible();
        await expect(warning).toContainText('15');
        await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeEnabled();
        await expectStateSound(page, adminVisit('georef.rmse-over', lang));
    },
);

test(
    'Pairs can be placed without a pointer, one after another',
    { tag: '@S-A16-HAPPY-KEYBOARD' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);
        await expect(pairRows(page, lang)).toHaveCount(4);

        // Add at the centres: a pair at both crosshairs, from the keyboard; it is not chosen, so the arrows pan the scan
        // to the next place (CR-M3-47), where a second pair goes the same way.
        const centres = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.addAtCentres') });
        await centres.focus();
        await centres.press('Enter');
        await expect(pairRows(page, lang)).toHaveCount(5);
        await scanPane(page, lang).focus();
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowUp');
        await centres.focus();
        await centres.press('Enter');
        await expect(pairRows(page, lang)).toHaveCount(6);
        await expect(pairRows(page, lang).getByRole('button', { pressed: true })).toHaveCount(0);
        await expectStateSound(page, adminVisit('georef.pairs', lang));

        // A pair chosen in the table moves with the arrows (ten preview pixels with Shift), which refits.
        const sixth = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.pairName', { number: '6' }), exact: true });
        await sixth.focus();
        await sixth.press('Enter');
        await expect(sixth).toHaveAttribute('aria-pressed', 'true');
        // Its error in metres: the column every window shows (a narrow table leaves the pixel and the place out).
        const residual = pairRows(page, lang).last().getByRole('cell').filter({ hasText: / m$/ });
        const before = await residual.innerText();
        await scanPane(page, lang).focus();
        await page.keyboard.press('Shift+ArrowRight');
        await expect(residual).not.toHaveText(before);

        // Esc lets it go: the arrows pan again and the pair stays where it is.
        await page.keyboard.press('Escape');
        await expect(sixth).toHaveAttribute('aria-pressed', 'false');
        const moved = await residual.innerText();
        await page.keyboard.press('ArrowRight');
        await expect(residual).toHaveText(moved);

        // Chosen again, Delete removes it.
        await sixth.focus();
        await sixth.press('Enter');
        await scanPane(page, lang).focus();
        await page.keyboard.press('Delete');
        await expect(pairRows(page, lang)).toHaveCount(5);
    },
);

/** Three places on one diagonal of the city, far apart: pairs that span a line, not an area. */
const IN_A_LINE = [
    { lat: 44.36, lng: 25.98 },
    { lat: 44.45, lng: 26.1 },
    { lat: 44.54, lng: 26.22 },
] as const;

test('Pairs in a line are refused', { tag: '@S-A16-BAD-DEGENERATE' }, async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
    test.setTimeout(150_000);
    const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
    await imagery.script({ attempts: [{ outcome: 'no-match' }] });
    await openGeoreferencer(page, lang);

    // Three pairs along one diagonal, then the four corner pairs deleted: three pairs, enough in number, on a line.
    for (const place of IN_A_LINE) {
        await addPair(page, lang, place);
    }
    await expect(pairRows(page, lang)).toHaveCount(7);
    for (const number of [4, 3, 2, 1]) {
        await removePair(page, lang, number);
    }
    await expect(pairRows(page, lang)).toHaveCount(3);
    await expect(page.getByRole('alert').filter({ hasText: georefText(lang, 'adminContent.georef.degenerate') })).toBeVisible();
    await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeDisabled();
    await expectStateSound(page, adminVisit('georef.degenerate', lang));
});
