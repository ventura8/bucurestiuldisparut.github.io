import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import type { Locator, Page, Request } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import type { TestFixtures } from '../../support/test.js';
import type { SetupBudget } from '../support/budget.js';
import { capture } from '../support/capture.js';
import type { GoogleConsent } from '../support/consent.js';
import type { ServerDeployment } from '../support/deployment.js';
import type { EmulatorWorld } from '../support/emulators.js';
import { apiText, setupText, shellText } from '../support/i18n.js';
import { followDeepLink, SetupPage, standInProviderPages } from '../support/setup-page.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import type { UpstreamControl } from '../support/upstream.js';
import { ADMIN_WEB_CONFIG, emulatorOrigin, E2E_PROJECT_ID } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The owner's whole journey through the Setup Assistant (docs/research/M2b-interfaces.md §3), against the emulators and
 * the fake upstreams, from a Google Cloud project with no billing account and no server to a map with Mapbox, USGS,
 * analytics and the 45 legacy photos:
 *
 * 1. start-up mode: the server does not answer; the owner signs in with a read-only Google consent and Google proves
 *    the ownership;
 * 2. billing: no billing account yet (the deep link), the owner creates one on Google's page, the card links it by itself
 *    and creates the budget;
 * 3. provisioning: Secret Manager is down at first, so the secrets and what needs them wait; Retry what failed;
 * 4. the server's installation: the card watches the Cloud Functions list; once every function is there and the server
 *    answers, the claim runs without a click, the city is created and the start-up results are recorded;
 * 5. Mapbox: a demo account is refused, the owner adds a card on Mapbox's page and pastes the token again;
 * 6. USGS: the paste box opens before the token page, with the countdown; the M2M role waits for USGS's approval, which
 *    the server's six-hourly check (`ops.tick`) finds;
 * 7. analytics: detected once Google Analytics is linked to the project; the GA4 stream setting; the crash reports;
 * 8. the legacy import: one click, 45 photos through the photo pipeline, published and in the city's manifest.
 *
 * Every in-app input and every Google consent is counted against `SETUP_STEP_SPECS` (§3.5), each bad path with its
 * declared allowance; what the human does on the providers' pages is not counted.
 */

test.use({ persona: null, mapOwner: null });

/** The pages the deep links of this journey open (the human's work there is out of the app). */
const PROVIDER_ORIGINS = ['https://ers.cr.usgs.gov', 'https://console.firebase.google.com'];

/** The emulators' origins whose requests start-up mode must not make (the probe of `admin-session` aside). */
const BACKEND = [emulatorOrigin('firestore'), emulatorOrigin('storage'), emulatorOrigin('functions')];

/** Records the path of every request of the page to Firestore, Storage or a callable until `stop()`. */
function backendRequests(page: Page): { readonly paths: string[]; stop(): void } {
    const paths: string[] = [];
    const listener = (request: Request): void => {
        if (BACKEND.some((origin) => request.url().startsWith(origin))) {
            paths.push(new URL(request.url()).pathname);
        }
    };
    page.on('request', listener);
    return {
        paths,
        stop: () => {
            page.off('request', listener);
        },
    };
}

/** The navigation's destinations and its More button (the bar of a compact window keeps the rest behind it). */
function destinations(page: Page): Locator {
    const navigation = page.getByRole('navigation');
    return navigation.getByRole('link').or(navigation.getByRole('button'));
}

/** The leading text of a catalogue text with a placeholder, as a pattern (`Link billing and create the …`). */
function startOf(text: string): RegExp {
    return new RegExp(`^${(text.split('{')[0] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** What every step of the journey drives: the page, the Setup page object and the admin tier's fixtures. */
interface Journey {
    readonly page: Page;
    readonly lang: 'ro' | 'en';
    readonly setup: SetupPage;
    readonly consent: GoogleConsent;
    readonly setupBudget: SetupBudget;
    readonly upstream: UpstreamControl;
    readonly serverDeployment: ServerDeployment;
    readonly consoleErrors: TestFixtures['consoleErrors'];
    readonly emulators: EmulatorWorld;
    readonly notes: { readonly projectId: string; readonly domain: string };
}

/** 1. Start-up mode: one read-only consent proves the ownership. */
async function signInInStartUpMode({ page, lang, setup, consent, setupBudget, notes }: Journey): Promise<void> {
    await setup.expectConsentNote(page.locator('hcm-sign-in'), 'cloudReadOnly', notes);
    await capture(page, '01-sign-in');
    const signInButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') });
    const signIn = await consent.opened(page, () => setupBudget.inputs('signIn').click(signInButton));
    expect(await signIn.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudReadOnly]);
    await signIn.allow(setupBudget.consents('signIn'));
    await expect(page.getByText(shellText(lang, 'adminShell.bootstrap.banner'))).toBeVisible();
    await setup.expectState('signIn', 'ok');
    // Start-up mode offers the Setup destination only.
    await expect(destinations(page)).toHaveCount(1);
}

/** 2. Billing. The billing APIs are off on a new project, so this consent is cloud-platform (provisioning then needs none). */
async function linkBilling({ page, lang, setup, consent, setupBudget, upstream, notes }: Journey): Promise<void> {
    const billing = setup.open('billing');
    await setup.expectConsentNote(billing, 'cloudPlatform', notes);
    const link = billing.getByRole('button', { name: startOf(setupText(lang, 'adminSetup.billing.link')) });
    const billingConsent = await consent.opened(page, () => setupBudget.inputs('billing').click(link));
    expect(await billingConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudPlatform]);
    await billingConsent.allow(setupBudget.consents('billing'));
    await expect(billing.getByText(setupText(lang, 'adminSetup.billing.noAccount'))).toBeVisible();
    await expect(billing.getByText(setupText(lang, 'adminSetup.billing.cost'))).toBeVisible();
    await expect(billing.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.gcp.billingAccounts')) })).toHaveAttribute(
        'href',
        'https://console.cloud.google.com/billing',
    );
    await capture(page, '02-billing-no-account');
    await upstream.scenario('cloud-billing.accountOpen', 'browser');
    await page.clock.fastForward(10_000);
    await setup.expectState('billing', 'ok');
}

/** 3. Provisioning: Secret Manager answers 503, so the secrets and the roles that need them wait; the rest is created. */
async function provisionWithARetry({ page, lang, setup, setupBudget, upstream, consoleErrors }: Journey): Promise<void> {
    await upstream.fail('secret-manager', 'unavailable', 'browser');
    const provision = setup.open('provision');
    const provisionInputs = setupBudget.inputs('provision', 1);
    await provisionInputs.click(provision.getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') }));
    const retry = provision.getByRole('button', { name: setupText(lang, 'adminSetup.provision.retry') });
    // The client retries a 503 three times (after 1, 2 and 4 s of the page's clock) before it reports the item.
    await expect(async () => {
        await page.clock.fastForward(5_000);
        await expect(retry).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    expect(await setup.provisionItems()).toMatchObject({
        secrets: 'unavailable',
        iam: 'pending',
        apis: 'ok',
        buckets: 'ok',
        'api-key': 'ok',
    });
    expect(consoleErrors.takeMatching(/status of 503/).length).toBeGreaterThan(0);
    await capture(page, '03-provision-partial');
    await upstream.fail('secret-manager', null, 'browser');
    await provisionInputs.click(retry);
    await setup.expectState('provision', 'ok');
}

/** 4. The server's installation, then the claim without a click. */
async function installTheServer({ page, lang, setup, upstream, serverDeployment, emulators }: Journey, owner: string): Promise<void> {
    await expect(setup.open('deploy').getByText(setupText(lang, 'adminSetup.deploy.watching'))).toBeVisible();
    await capture(page, '04-deploy-waiting');
    await upstream.scenario('cloud-functions.deployed', 'browser');
    // The functions reach the server's world of the fake upstreams until CR-M2b-3 forwards the test's: it holds the
    // secrets the browser's provisioning created in the test's world.
    await upstream.scenario('secret-manager.provisioned', 'server');
    await serverDeployment.show();
    await page.clock.fastForward(30_000);
    await expect(page.getByText(shellText(lang, 'adminShell.bootstrap.banner'))).toBeHidden({ timeout: 60_000 });
    await setup.expectState('claim', 'ok');
    await expect(setup.open('mapbox')).toBeVisible();
    // Normal mode adds the server's pages (on a compact window behind More).
    await expect.poll(() => destinations(page).count()).toBeGreaterThan(1);
    await capture(page, '05-claimed-mapbox');
    expect(await emulators.document(`admins/${owner}`)).toEqual(expect.objectContaining({ role: 'owner' }));
    expect(await emulators.document('cities/bucharest')).toEqual(expect.objectContaining({ published: true, updatedBy: owner }));
    expect(await emulators.document('setup/status')).toEqual(
        expect.objectContaining({
            billing: expect.objectContaining({ state: 'ok', budgetAmount: 5, currency: 'USD' }),
            provision: expect.objectContaining({ state: 'ok' }),
        }),
    );
}

/** 5. Mapbox: a demo account cannot mint tokens; the owner adds a card on Mapbox's page and pastes the token again. */
async function connectMapbox({ page, lang, setup, setupBudget, upstream, consoleErrors, emulators }: Journey): Promise<void> {
    const mapbox = setup.open('mapbox');
    const tokenBox = mapbox.getByLabel(setupText(lang, 'adminSetup.mapbox.token'));
    const save = mapbox.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') });
    const mapboxInputs = setupBudget.inputs('mapbox', 2);
    await mapboxInputs.paste(tokenBox, MAPBOX_TOKENS.trial);
    await expect(mapbox.getByText(setupText(lang, 'adminSetup.mapbox.looksRight'))).toBeVisible();
    await mapboxInputs.click(save);
    await expect(mapbox.getByRole('alert').filter({ hasText: apiText(lang, 'apiError.mapbox.mintRefused') })).toBeVisible();
    await expect(mapbox.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.mapbox.console')) })).toBeVisible();
    await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBe(1);
    expect(await emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
    await capture(page, '06-mapbox-trial');
    await upstream.scenario('mapbox.upgraded', 'server');
    await mapboxInputs.paste(tokenBox, MAPBOX_TOKENS.trial);
    await mapboxInputs.click(save);
    await setup.expectState('mapbox', 'ok');
    const city = await emulators.document('cities/bucharest');
    expect(city).toEqual(
        expect.objectContaining({
            mapbox: expect.objectContaining({ publicToken: expect.stringMatching(/^pk\./) }),
        }),
    );
    // The secret token went to Secret Manager only.
    expect(JSON.stringify([city, await emulators.document('setup/status')])).not.toContain(MAPBOX_TOKENS.trial);
}

/** 6. USGS: the username, the token page (the paste box first, then the 60 s countdown), the paste saves at once. */
async function connectUsgs({ page, lang, setup, setupBudget, upstream, emulators }: Journey): Promise<void> {
    const usgs = setup.open('usgs');
    const usgsInputs = setupBudget.inputs('usgs');
    await usgsInputs.fill(usgs.getByLabel(setupText(lang, 'adminSetup.usgs.username')), USGS_CREDENTIALS.pending.username);
    const tokenPage = usgs.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.usgs.openTokenPage')) });
    await followDeepLink(page, () => usgsInputs.click(tokenPage));
    const usgsBox = usgs.getByLabel(setupText(lang, 'adminSetup.usgs.token'));
    await expect(usgsBox).toBeFocused();
    await expect(usgs.getByRole('timer')).toHaveText(setupText(lang, 'adminSetup.usgs.countdown', { seconds: '60' }));
    await page.clock.fastForward(5_000);
    await expect(usgs.getByRole('timer')).toHaveText(setupText(lang, 'adminSetup.usgs.countdown', { seconds: '55' }));
    await capture(page, '07-usgs-countdown');
    await usgsInputs.paste(usgsBox, USGS_CREDENTIALS.pending.applicationToken);
    await setup.expectState('usgs', 'pending');
    await expect(usgs.getByText(apiText(lang, 'apiError.usgs.accessPending'))).toBeVisible();
    await expect(usgs.getByText(startOf(setupText(lang, 'adminSetup.usgs.nextCheck')))).toBeVisible();
    await capture(page, '08-usgs-pending');
    // USGS approves. Six hours later the server's tick checks again: its clock cannot move, so the check's time does.
    await upstream.scenario('usgs.m2mApproved', 'server');
    await emulators.updateFields('setup/status', { usgs: { nextCheckAt: new Date('2026-01-01T00:00:00Z') } }, ['usgs.nextCheckAt']);
    await emulators.runOpsTick();
    await expect.poll(async () => (await emulators.document('setup/status'))?.['usgs'], { timeout: 30_000 }).toMatchObject({ state: 'ok' });
    await page.reload();
    await setup.expectState('usgs', 'ok', 60_000);
}

/** 7. Analytics: after the deep link the card watches every 15 s; then the GA4 stream setting (its own consent). */
async function enableAnalytics({
    page,
    lang,
    setup,
    consent,
    setupBudget,
    upstream,
    consoleErrors,
    emulators,
    notes,
}: Journey): Promise<void> {
    let analytics = await setup.show('analytics');
    // Google Analytics is not enabled yet: setup.analyticsConfig says so (a callable's 400).
    await expect(analytics.getByText(apiText(lang, 'apiError.analytics.notEnabled'))).toBeVisible();
    await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBe(1);
    await followDeepLink(page, () => analytics.getByRole('link', { name: /Firebase/ }).click());
    await expect(analytics.getByText(setupText(lang, 'adminSetup.analytics.watching'))).toBeVisible();
    // The owner enables Google Analytics on Google's page; the next check finds it.
    await upstream.scenario('firebase-management.analyticsLinked', 'both');
    await page.clock.fastForward(15_000);
    await setup.expectState('analytics', 'ok');
    analytics = await setup.show('analytics');
    await expect(analytics.getByText(setupText(lang, 'adminSetup.analytics.measurementId', { id: 'G-E2E0000000' }))).toBeVisible();
    await expect(analytics.locator('[data-group]')).toHaveCount(2);
    await setup.expectConsentNote(analytics, 'analyticsEdit', notes);
    const stream = analytics.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.streamSetting') });
    const analyticsConsent = await consent.opened(page, () => setupBudget.inputs('analytics').click(stream));
    expect(await analyticsConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.analyticsEdit]);
    await analyticsConsent.allow(setupBudget.consents('analytics'));
    await expect(analytics.getByText(setupText(lang, 'adminSetup.analytics.streamOff'))).toBeVisible();
    await capture(page, '09-analytics');
    expect(await emulators.document('cities/bucharest')).toEqual(
        expect.objectContaining({ analytics: expect.objectContaining({ measurementId: 'G-E2E0000000' }) }),
    );
}

/** 8. The legacy import: one click, 45 photos processed by photos.onUpload, published, then in the manifest. */
async function importLegacyPhotos({ page, lang, setup, setupBudget, emulators }: Journey): Promise<void> {
    const legacy = await setup.show('legacyImport');
    const importButton = legacy.getByRole('button', { name: setupText(lang, 'adminSetup.import.action', { count: '45' }) });
    await setupBudget.inputs('legacyImport').click(importButton);
    await expect(setup.card('legacyImport')).not.toHaveAttribute('data-state', /missing|pending/, { timeout: 180_000 });
    // A photo the import could not finish is listed on the card with its reason: none may be.
    await expect(page.locator('hcm-setup-step[data-step="legacyImport"] [data-photo]')).toHaveText([]);
    await setup.expectState('legacyImport', 'ok');
    await expect((await setup.show('legacyImport')).getByText(setupText(lang, 'adminSetup.import.done', { count: '45' }))).toBeVisible();
    await capture(page, '10-import-done');
    const photos = Object.values(await emulators.collection('cities/bucharest/photos'));
    expect(
        photos.filter((photo) => photo['published'] === true && photo['processing'] === 'done' && photo['rightsReview'] === true),
    ).toHaveLength(45);
    await expect
        .poll(async () => (await emulators.document('manifests/bucharest'))?.['counts'], { timeout: 120_000 })
        .toMatchObject({ photos: 45 });
}

test(
    'The owner sets up a new map from sign-in to the legacy import within the input budget',
    {
        tag: [
            '@S-A30-HAPPY',
            '@S-A25-HAPPY',
            '@S-A27-HAPPY-UNVERIFIED-NOTICE',
            '@S-A04-BAD-NOT-ENABLED',
            '@S-A04-BAD-PARTIAL-FAILURE',
            '@S-A26-HAPPY',
            '@S-A05-BAD-TRIAL',
            '@S-A06-HAPPY',
            '@S-A07-HAPPY-COUNTDOWN',
            '@S-A07-BAD-ROLE-PENDING',
            '@S-A22-HAPPY',
            '@S-A22-HAPPY-STREAM-SETTING',
            '@S-A28-HAPPY',
        ],
    },
    async ({ page, lang, consent, setupBudget, upstream, serverDeployment, consoleErrors, adminWorld }) => {
        // Eight steps, three polls and 45 photos through photos.onUpload on the emulators.
        test.setTimeout(300_000);
        const setup = new SetupPage(page, lang);
        const emulators = adminWorld.emulators;
        const notes = { projectId: E2E_PROJECT_ID, domain: ADMIN_WEB_CONFIG.authDomain };
        const journey: Journey = { page, lang, setup, consent, setupBudget, upstream, serverDeployment, consoleErrors, emulators, notes };
        await upstream.scenario('cloud-billing.noAccount', 'browser');
        await upstream.scenario('error-reporting.twoGroups', 'server');
        await standInProviderPages(page.context(), PROVIDER_ORIGINS);
        await serverDeployment.hide();
        // The polls run on the page's clock: time flows, and the spec jumps ahead to the next poll.
        await page.clock.install();
        await page.clock.resume();
        const startUp = backendRequests(page);
        await page.goto(adminPath(lang));

        await signInInStartUpMode(journey);
        await linkBilling(journey);
        await provisionWithARetry(journey);
        startUp.stop();
        // Start-up mode called nothing of the server but the probe (refused while the server is hidden).
        expect(new Set(startUp.paths)).toEqual(new Set([`/${E2E_PROJECT_ID}/us-central1/admin-session`]));
        serverDeployment.claimErrors();

        await installTheServer(journey, adminWorld.accounts.owner.uid);
        await connectMapbox(journey);
        await connectUsgs(journey);
        await enableAnalytics(journey);
        await importLegacyPhotos(journey);

        // The whole assistant: within its budget once the bad paths' declared allowances are taken off (§3.5).
        const used = setupBudget.used();
        expect(used.inputs - setupBudget.allowance()).toBeLessThanOrEqual(used.limit.inputs);
        expect(used.consents).toBeLessThanOrEqual(used.limit.consents);
    },
);
