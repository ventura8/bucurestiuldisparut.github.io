import type { Calibration } from '@hcm/shared';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { detail, importFromList, imageryText, readyImagery, versionState } from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * What a version's page says of how the frame was found (behaviour A67, docs/research/M9-calibration.md §8) and why it waits
 * (behaviour A17, §11): the stand-in writes what `locate` and `export` write, per attempt (e2e/admin/support/imagery-run.ts); the
 * real search is the pipeline's (behaviour P06).
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';
const PROVED: Calibration = {
    how: 'votes',
    votes: { agreed: 22, tiles: 196 },
    tiles: { agreed: 712, tried: 946 },
    crossValidatedM: 16.3,
    coveredPct: 95,
    measuredPct: 88.2,
};

test(
    'A frame found with no landmark says how, what agrees, its error and the city it covers',
    { tag: '@S-A67-HAPPY-CALIBRATION' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await imagery.script({ attempts: [{ outcome: 'over', calibration: PROVED, coveragePct: 96 }] });

        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const block = detail(page).locator('[data-calibration="votes"]');
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.calibration.how.votes'));
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.calibration.tiles', { agreed: '712', tried: '946' }));
        await expect(block).toContainText(
            imageryText(lang, 'adminContent.imagery.calibration.error', { metres: (16.3).toLocaleString(lang) }),
        );
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.join.coverageMeasured', { percent: '96' }));
        await expect(detail(page).locator('[data-waits]')).toHaveCount(0);
        await expectStateSound(page, adminVisit('imagery.version-calibrated', lang));
    },
);

test(
    'A frame nothing found asks for a few rough points',
    { tag: '@S-A67-BAD-NOT-FOUND' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await imagery.script({ attempts: [{ outcome: 'no-match', calibration: { how: 'none', refusal: 'no-votes' } }] });

        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).locator('[data-calibration="none"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.calibration.notFound'),
        );
        await expect(detail(page).getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-not-found', lang));
    },
);

test(
    'A frame under the threshold holding part of the city waits, and says why',
    { tag: '@S-A17-BAD-PART-OF-CITY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        await imagery.script({ attempts: [{ outcome: 'under', calibration: PROVED, coveragePct: 62 }] });

        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-waits="coverage"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.calibration.waits.coverage'),
        );
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })).toBeEnabled();
        await expectStateSound(page, adminVisit('imagery.version-coverage', lang));
        expect((await imagery.version(versionId))?.['approval']).toBeUndefined();
        expect(await upstream.calls('server', 'mapbox.tilesets')).toEqual([]);
    },
);

test(
    'A frame the proof refused waits for one click, however low its figure',
    { tag: '@S-A17-BAD-NOT-PROVED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        await imagery.script({ attempts: [{ outcome: 'under', calibration: { how: 'none', refusal: 'gross' }, coveragePct: 96 }] });

        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-waits="not-proved"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.calibration.waits.notProved'),
        );
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })).toBeEnabled();
        await expectStateSound(page, adminVisit('imagery.version-not-proved', lang));
        expect((await imagery.version(versionId))?.['approval']).toBeUndefined();
        expect(await upstream.calls('server', 'mapbox.tilesets')).toEqual([]);
    },
);

test(
    'A proved frame with a check dropped as gross waits for one click',
    { tag: '@S-A17-BAD-CHECKS-DROPPED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        const calibration: Calibration = { ...PROVED, measuredPct: 85, checksDropped: 2 };
        await imagery.script({ attempts: [{ outcome: 'under', calibration, coveragePct: 96 }] });

        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-waits="not-proved"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.calibration.waits.notProved'),
        );
        expect((await imagery.version(versionId))?.['approval']).toBeUndefined();
    },
);
