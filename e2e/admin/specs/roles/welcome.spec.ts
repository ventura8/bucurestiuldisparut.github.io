import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { PROJECT_CITY } from '../../support/content.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { ADMIN_PATH, PERSONAS } from '../../world.js';
import { AT, cityText, shellText } from '../cities/world.js';

// One admin test at a time: the emulators are one Firebase project.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Contribute page's welcome (docs/research/M13-roles.md §3; behaviour A92): a public visitor who follows the map's
 * Contribute link while signed out is welcomed as a contributor in the map's language, never shown the admin's sign-in,
 * and goes back to the map in one click; once signed in, an account of no role lands on the Contribute page. An admin's
 * address still shows the admin's sign-in.
 */
test.use({ persona: null, mapOwner: 'owner' });

const NAMES = { ro: 'București', en: 'Bucharest' } as const;
const ADMIN_COPY = [/Map administration/, /administers the map/, /Administrarea hărții/, /administrează harta/];

/**
 * Opens the welcome as the map's link does (its language, the city's name in it); the way back is the project's first city's
 * map at the Hosting root (M6 §2.4), a stand-in page here. Returns that address.
 */
async function openWelcome(page: Page, lang: 'ro' | 'en'): Promise<string> {
    await page.goto(adminPath(lang));
    const map = new URL('/', page.url()).href;
    await page.route(map, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Map</title>' }));
    await page.goto(`${ADMIN_PATH}?${new URLSearchParams({ lang, name: NAMES[lang] }).toString()}#/contribute/${PROJECT_CITY}`);
    await expect(page.getByRole('heading', { name: shellText(lang, 'adminShell.welcome.title', { city: NAMES[lang] }) })).toBeVisible();
    return map;
}

test(
    'A visitor from the map is welcomed as a contributor in its language and goes back to the map',
    { tag: ['@S-A92-HAPPY-WELCOME', '@S-A92-BAD-NO-ADMIN-SIGN-IN'] },
    async ({ page, lang }) => {
        const map = await openWelcome(page, lang);

        await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.welcome.signIn') })).toBeVisible();
        await expect(page.getByText(shellText(lang, 'adminShell.welcome.signInNote'))).toBeVisible();
        await expect(page).toHaveTitle(`${shellText(lang, 'adminShell.welcome.tabTitle')} · ${NAMES[lang]}`);
        for (const copy of ADMIN_COPY) {
            await expect(page.getByText(copy)).toHaveCount(0);
        }
        await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn'), exact: true })).toHaveCount(0);
        await expectStateSound(page, adminVisit('roles.contribute-welcome', lang));

        await page.getByRole('link', { name: shellText(lang, 'adminShell.welcome.back') }).click();
        await expect(page).toHaveURL(map);
    },
);

test(
    'Signing in from the welcome lands an account of no role on the Contribute page, never on the admin',
    { tag: '@S-A92-HAPPY-WELCOME-SIGN-IN' },
    async ({ page, lang, adminWorld, consent, inputBudget }) => {
        await adminWorld.emulators.setDocument(`cities/${PROJECT_CITY}`, {
            name: NAMES,
            bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
            published: true,
            updatedBy: 'system:photos',
            updatedAt: AT,
        });
        await openWelcome(page, lang);

        const flow = inputBudget.flow('contributeSignIn', 1);
        const popup = await consent.opened(page, () =>
            flow.click(page.getByRole('button', { name: shellText(lang, 'adminShell.welcome.signIn') })),
        );
        await popup.chooseAccount(PERSONAS.stranger.email);
        await popup.allow(inputBudget.flow('contributeSignInConsent', 1));

        await expect(page.getByLabel(cityText(lang, 'adminContent.contribute.reason'))).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#/contribute/${PROJECT_CITY}$`));
        await expect(page.getByRole('navigation')).toHaveCount(0);
        expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.stranger.uid}`)).toBeUndefined();
    },
);

test('An admin address signed out still shows the admin sign-in', { tag: '@S-A92-BAD-ADMIN-ROUTE' }, async ({ page, lang }) => {
    await page.goto(adminPath(lang, 'photos'));

    await expect(page.getByRole('heading', { name: shellText(lang, 'adminShell.appName') })).toBeVisible();
    await expect(page.getByText(shellText(lang, 'adminShell.auth.signInIntro'))).toBeVisible();
    await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn'), exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: shellText(lang, 'adminShell.welcome.back') })).toHaveCount(0);
    await expect(page).toHaveTitle(shellText(lang, 'adminShell.appName'));
});
