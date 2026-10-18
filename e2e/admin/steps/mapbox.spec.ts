import { MAPBOX_TOKENS } from '@hcm/test-support/fakes';
import type { Locator, Page } from '@playwright/test';

import { projectCity } from '../support/content.js';
import { apiText, setupText } from '../support/i18n.js';
import { seedPhotosCity } from '../support/photos.js';
import { SetupPage } from '../support/setup-page.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { emulatorOrigin } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's Mapbox step (docs/research/M2b-interfaces.md §3.3 e; behaviours A05, A06) on a claimed map, its
 * owner signed in: the secret token pasted into the card goes once to `setup.saveMapbox`, which proves the account with
 * the fake Mapbox (the server's world of the fake upstreams) and mints the viewer's public token. Each Mapbox answer the
 * owner can meet is a token of `MAPBOX_TOKENS` or a failure of the fake: a paid account, one blocked on its billing
 * details, one without every scope, a revoked token, Mapbox down; a public token is explained before any call.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** When the claim created the city (a fixed time). */
const AT = new Date('2026-10-01T09:00:00.000Z');

/** The city as the claim created it: its name and bounds, no Mapbox yet. */
test.beforeEach(async ({ adminWorld, upstream }) => {
    await seedPhotosCity(projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid), AT);
    // The project was provisioned: the secrets the server keeps the token in exist.
    await upstream.scenario('google.provisioned', 'server');
});

/** The Mapbox card of Setup, open. */
async function mapboxCard(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    const setup = new SetupPage(page, lang);
    await setup.visit();
    return setup.show('mapbox');
}

/** The leading text of a catalogue text with a placeholder, as a pattern (a link's name ends with "opens in a new tab"). */
function startOf(text: string): RegExp {
    return new RegExp(`^${(text.split('{')[0] ?? '').replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** The requests of the page to the Functions emulator (the callables), by path. */
function callables(page: Page): string[] {
    const paths: string[] = [];
    page.on('request', (request) => {
        if (request.url().startsWith(emulatorOrigin('functions'))) {
            paths.push(new URL(request.url()).pathname);
        }
    });
    return paths;
}

test(
    'A paid account: the pasted secret token is saved at once, mints the public token and the step is green, in one input',
    { tag: ['@S-A05-HAPPY'] },
    async ({ page, lang, setupBudget, adminWorld }) => {
        const card = await mapboxCard(page, lang);
        const inputs = setupBudget.inputs('mapbox');
        // The paste is the whole step: no Save click.
        await inputs.paste(card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')), MAPBOX_TOKENS.bootstrap);

        const setup = new SetupPage(page, lang);
        await setup.expectState('mapbox', 'ok');
        // Setup moves on to the next step; the Mapbox card, opened again, names the account.
        const saved = await setup.show('mapbox');
        await expect(saved.getByText(setupText(lang, 'adminSetup.mapbox.saved', { user: 'e2e-mapbox' }))).toBeVisible();
        const city = await adminWorld.emulators.document('cities/bucharest');
        expect(city).toEqual(expect.objectContaining({ mapbox: expect.objectContaining({ publicToken: expect.stringMatching(/^pk\./) }) }));
        expect(JSON.stringify(city)).not.toContain(MAPBOX_TOKENS.bootstrap);
        expect(inputs.used).toBe(1);
    },
);

test(
    'An account blocked on its billing details: Mapbox refuses the public token, the card says why with the console link, nothing kept',
    { tag: ['@S-A05-BAD-MISSING-BILLING-ADDRESS'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        const card = await mapboxCard(page, lang);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.billingPending);
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();

        await expect(card.getByRole('alert')).toHaveText(apiText(lang, 'apiError.mapbox.mintRefused'));
        await expect(card.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.mapbox.console')) })).toHaveAttribute(
            'href',
            'https://console.mapbox.com/',
        );
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
        const secrets = await upstream.calls('server', 'secret-manager');
        expect(secrets.filter((call) => call.body.includes(Buffer.from(MAPBOX_TOKENS.billingPending).toString('base64')))).toEqual([]);
        expect(consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'A token without every scope: the card names the missing scopes and links the token page; nothing stored',
    { tag: ['@S-A06-BAD-MISSING-SCOPES'] },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        const card = await mapboxCard(page, lang);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.missingScopes);
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();

        await expect(card.getByRole('alert')).toHaveText(
            apiText(lang, 'apiError.mapbox.missingScopes', { scopes: 'tilesets:write, tokens:write' }),
        );
        await expect(card.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.mapbox.accessTokens')) })).toHaveAttribute(
            'href',
            'https://console.mapbox.com/account/access-tokens/',
        );
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
        expect(consoleErrors.takeMatching(/status of 4\d\d/).length).toBeGreaterThan(0);
    },
);

test(
    'A public token pasted by mistake is explained in the page before any call',
    { tag: ['@S-A06-BAD-PUBLIC-TOKEN-PASTED'] },
    async ({ page, lang }) => {
        const card = await mapboxCard(page, lang);
        const calls = callables(page);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.defaultPublic);

        await expect(card.getByRole('status').filter({ hasText: apiText(lang, 'apiError.mapbox.publicToken') })).toBeVisible();
        expect(calls.filter((path) => path.includes('setup-saveMapbox'))).toEqual([]);
    },
);

test(
    'A revoked token is reported and the Mapbox chip turns invalid',
    { tag: ['@S-A06-BAD-REVOKED'] },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        const card = await mapboxCard(page, lang);
        await card.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.revoked);
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();

        await expect(card.getByRole('alert')).toHaveText(apiText(lang, 'apiError.mapbox.tokenInvalid'));
        await new SetupPage(page, lang).expectState('mapbox', 'invalid');
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
        expect(consoleErrors.takeMatching(/status of 4\d\d/).length).toBeGreaterThan(0);
    },
);

test(
    'Mapbox down: the card says to try again and nothing is half-saved; once it answers, the same token typed and saved connects',
    { tag: ['@S-A06-BAD-MAPBOX-5XX'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        await upstream.fail('mapbox', 'unavailable', 'server');
        const card = await mapboxCard(page, lang);
        const box = card.getByLabel(setupText(lang, 'adminSetup.mapbox.token'));
        const save = card.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') });
        await box.fill(MAPBOX_TOKENS.bootstrap);
        await save.click();

        await expect(card.getByRole('alert')).toHaveText(apiText(lang, 'apiError.mapbox.unavailable'));
        await new SetupPage(page, lang).expectState('mapbox', 'unavailable');
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
        expect(consoleErrors.takeMatching(/status of 5\d\d/).length).toBeGreaterThan(0);

        await upstream.fail('mapbox', null, 'server');
        await box.fill(MAPBOX_TOKENS.bootstrap);
        await save.click();
        await new SetupPage(page, lang).expectState('mapbox', 'ok');
    },
);
