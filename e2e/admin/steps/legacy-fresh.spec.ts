import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Page, Response } from '@playwright/test';

import { LEGACY_FOLDER } from '../../../scripts/site/src/admin/legacy.js';
import { importCard } from '../support/legacy-import.js';
import { seedClaimedCity, seedSetupStatus } from '../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { ADMIN_PATH, E2E_HOSTING_DIR } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK. This spec also rewrites the e2e
// Hosting tree's bundle, which no other admin test reads meanwhile, and puts it back after each test.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A new release's legacy bundle is always the one read (behaviour A28; the live finding of 2026-11-08): Hosting
 * answered `legacy/<city>/photos.json` with a day's `max-age`, so after the release grew the bundle from 45 to 57
 * records the owner's browser kept the 45 for a day; step h said every photo was on the map and its first run imported
 * against the stale list. The bundle is now asked of Hosting again on every read (`cache: 'no-cache'`), and Hosting
 * answers its JSON `no-cache`. Here the e2e Hosting tree's own file is rewritten between two reads by one browser (its
 * HTTP cache shared by its tabs; no route, which would turn the cache off): the release before, then the new one.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const BUNDLE = resolve(join(E2E_HOSTING_DIR, ADMIN_PATH, LEGACY_FOLDER, 'photos.json'));
let original = '';

test.beforeEach(async ({ adminWorld }) => {
    original = await readFile(BUNDLE, 'utf8');
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
});

test.afterEach(async () => {
    await writeFile(BUNDLE, original);
});

/** Hosting's bundle as a release ships it: its first `count` records. */
async function release(count: number): Promise<void> {
    await writeFile(BUNDLE, JSON.stringify((JSON.parse(original) as unknown[]).slice(0, count)));
}

/** The next answer to the page's read of the bundle's records. */
function bundleRead(page: Page): Promise<Response> {
    return page.waitForResponse((response) => response.url().endsWith(`${LEGACY_FOLDER}/photos.json`));
}

test(
    "A tab opened after a release counts the new bundle's photos, not the copy the browser read before",
    { tag: ['@S-A28-HAPPY-BUNDLE-FRESH'] },
    async ({ page, lang }) => {
        await release(3);
        const before = bundleRead(page);
        await expect((await importCard(page, lang, 3)).action).toBeVisible();
        expect((await before).headers()['cache-control']).toBe('no-cache');

        await release(5);
        const later = await page.context().newPage();
        const read = bundleRead(later);
        await expect((await importCard(later, lang, 5)).action).toBeVisible();
        expect((await (await read).json()) as unknown[]).toHaveLength(5);
    },
);

test(
    'The tab that read the earlier bundle never counts its cached copy when Setup opens again',
    { tag: ['@S-A28-BAD-STALE-BUNDLE-REFUSED'] },
    async ({ page, lang }) => {
        await release(3);
        await expect((await importCard(page, lang, 3)).action).toBeVisible();

        await release(5);
        await page.goto('about:blank');
        const { action } = await importCard(page, lang, 5);
        await expect(action).toBeVisible();
        await expect(action).toHaveAccessibleName(/\(5\)$/);
    },
);
