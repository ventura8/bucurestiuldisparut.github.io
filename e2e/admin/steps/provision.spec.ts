import type { Locator, Page, Route } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { setupText, shellText } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { openStep, seedClaimedCity, STEPS_AT, withConsent } from '../support/steps.js';
import type { UpstreamCall, UpstreamControl } from '../support/upstream.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { ADMIN_PROJECT } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's provisioning step (docs/research/M2b-interfaces.md §3.3 c, §3.4; behaviours A04, A30) on a
 * claimed map with billing done, its owner signed in (normal mode): "Prepare the project" (one click, one cloud-platform
 * consent) runs the provisioner against the owner's Google world of the fake upstreams, which starts as a new project on
 * Blaze with the app's budget; the doctor shows each item as it settles, and the result is recorded in `setup/status`.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

test.beforeEach(async ({ adminWorld, upstream }) => {
    const owner = adminWorld.accounts.owner.uid;
    await seedClaimedCity(adminWorld.emulators, owner);
    await adminWorld.emulators.setDocument('setup/status', {
        billing: { state: 'ok', checkedAt: STEPS_AT },
        updatedBy: owner,
        updatedAt: STEPS_AT,
    });
    await upstream.scenario('cloud-billing.enabled', 'browser');
    await upstream.scenario('billing-budgets.appBudget', 'browser');
});

/** Every item done but the scheduler, which the first deploy creates. */
const PROVISIONED = {
    apis: 'ok',
    'service-accounts': 'ok',
    iam: 'ok',
    buckets: 'ok',
    'bucket-cors': 'ok',
    'bucket-lifecycle': 'ok',
    secrets: 'ok',
    'task-queues': 'ok',
    scheduler: 'pending',
    'workload-identity': 'ok',
    'app-check': 'ok',
    'budget-alerts': 'ok',
    'org-policies': 'ok',
    'crash-alerts': 'ok',
    'api-key': 'ok',
};

/** A Google call that changes something (the rest read: GET, and the POSTs that read an IAM policy or test permissions). */
function isWrite(call: UpstreamCall): boolean {
    return call.method !== 'GET' && !/(getIamPolicy|testIamPermissions|tokeninfo)$/.test(call.operation);
}

async function writes(upstream: UpstreamControl): Promise<UpstreamCall[]> {
    return (await upstream.calls('browser')).filter(isWrite);
}

interface ProvisionCard {
    readonly card: Locator;
    readonly run: Locator;
    readonly retry: Locator;
}

async function provisionCard(page: Page, lang: 'ro' | 'en'): Promise<ProvisionCard> {
    const card = await openStep(page, lang, 'provision', 'provision');
    return {
        card,
        run: card.getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') }),
        retry: card.getByRole('button', { name: setupText(lang, 'adminSetup.provision.retry') }),
    };
}

test(
    'Prepare the project creates every item once, in order, with the numeric ids of the project file; a second run writes nothing',
    { tag: ['@S-A04-HAPPY-PROVISION'] },
    async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
        test.setTimeout(150_000);
        const { card, run } = await provisionCard(page, lang);
        const inputs = setupBudget.inputs('provision', 1);
        const scopes = await withConsent(page, consent, run, inputs, setupBudget.consents('provision'));

        expect(scopes).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        const setup = new SetupPage(page, lang);
        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);
        const first = await writes(upstream);
        const keys = first.map((call) => `${call.operation} ${call.url} ${call.body}`);
        expect(new Set(keys).size).toBe(keys.length);
        // The doctor's order: the APIs first, the service accounts before their roles, the buckets before their settings.
        const position = (operation: string): number => first.findIndex((call) => call.operation === operation);
        expect(position('service-usage.batchEnable')).toBeLessThan(position('iam.serviceAccounts.create'));
        expect(position('iam.serviceAccounts.create')).toBeLessThan(position('resource-manager.setIamPolicy'));
        expect(position('cloud-storage.buckets.insert')).toBeLessThan(position('cloud-storage.buckets.patch'));
        const provider = first.find((call) => call.operation === 'iam.workloadIdentityPools.providers.create');
        expect(provider?.body).toContain(`assertion.repository_owner_id=='${String(ADMIN_PROJECT.github.ownerId)}'`);
        expect(provider?.body).toContain(`assertion.repository_id=='${String(ADMIN_PROJECT.github.repoId)}'`);
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['provision'])
            .toMatchObject({
                state: 'ok',
                items: expect.arrayContaining([expect.objectContaining({ id: 'scheduler', state: 'pending' })]),
            });

        // Check again: the doctor reads every item and writes nothing (the token is still live: no consent).
        await inputs.click(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }));
        await expect.poll(async () => (await upstream.calls('browser')).length).toBeGreaterThan(first.length);
        await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })).toBeEnabled();
        expect(await setup.provisionItems()).toEqual(PROVISIONED);
        expect(await writes(upstream)).toHaveLength(first.length);
    },
);

test(
    "An organisation policy that forbids public access marks the public bucket's access with the policy; everything else is provisioned",
    { tag: ['@S-A04-BAD-ORG-POLICY'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        await upstream.scenario('org-policy.publicAccessPrevented', 'browser');
        const { card, run, retry } = await provisionCard(page, lang);
        await withConsent(page, consent, run, setupBudget.inputs('provision'), setupBudget.consents('provision'));

        await expect(retry).toBeEnabled({ timeout: 60_000 });
        const items = await new SetupPage(page, lang).provisionItems();
        // The public read is the one part the policy refuses: the item says which policy; what needs the buckets waits.
        expect(items).toMatchObject({ buckets: 'invalid', apis: 'ok', 'service-accounts': 'ok', secrets: 'ok', 'org-policies': 'ok' });
        await expect(card.locator('[data-item="buckets"]')).toContainText(
            setupText(lang, 'adminSetup.provision.orgPolicy', { constraint: 'storage.publicAccessPrevention' }),
        );
        consoleErrors.takeMatching(/status of 412/);
    },
);

test(
    'A failed item costs one more input: Retry runs only what is not done, with no second consent',
    { tag: ['@S-A30-BAD-RETRY-COSTS-ONE'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        await page.clock.install();
        await page.clock.resume();
        await upstream.fail('secret-manager', 'unavailable', 'browser');
        const { run, retry } = await provisionCard(page, lang);
        const inputs = setupBudget.inputs('provision', 1);
        const consents = setupBudget.consents('provision');
        await withConsent(page, consent, run, inputs, consents);
        // The client retries a 503 three times (after 1, 2 and 4 s of the page's clock) before it reports the item.
        await expect(async () => {
            await page.clock.fastForward(5_000);
            await expect(retry).toBeEnabled({ timeout: 1_000 });
        }).toPass({ timeout: 60_000 });
        const setup = new SetupPage(page, lang);
        expect(await setup.provisionItems()).toMatchObject({ secrets: 'unavailable', apis: 'ok', 'service-accounts': 'ok', buckets: 'ok' });
        const before = (await upstream.calls('browser')).length;
        expect(consoleErrors.takeMatching(/status of 503/).length).toBeGreaterThan(0);

        await upstream.fail('secret-manager', null, 'browser');
        await inputs.click(retry);
        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);
        const again = (await upstream.calls('browser'))
            .slice(before)
            .filter(isWrite)
            .map((call) => call.operation);
        expect(again).not.toContain('service-usage.batchEnable');
        expect(again).not.toContain('iam.serviceAccounts.create');
        expect(again).not.toContain('cloud-storage.buckets.insert');
        expect(inputs.used).toBe(2);
        expect(consents.used).toBe(1);
    },
);

test(
    'A Google token that expires during the run stops it with the rest pending; Continue, one click and one consent, finishes it',
    { tag: ['@S-A04-BAD-TOKEN-EXPIRED-MID-RUN'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        // The owner's first token expires when the run reaches Secret Manager: Google answers 401 to it from then on.
        let expired: string | null = null;
        await page.route('https://*.googleapis.com/**', async (route: Route) => {
            const token = (await route.request().headerValue('authorization')) ?? '';
            if (expired === null && route.request().url().startsWith('https://secretmanager.googleapis.com/')) {
                expired = token;
            }
            if (expired !== null && token === expired) {
                await route.fulfill({
                    status: 401,
                    json: { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } },
                });
                return;
            }
            await route.fallback();
        });
        const { card, run } = await provisionCard(page, lang);
        await withConsent(page, consent, run, setupBudget.inputs('provision', 1), setupBudget.consents('provision', 1));

        const proceed = card.getByRole('button', { name: shellText(lang, 'adminShell.session.continue') });
        await expect(proceed).toBeVisible({ timeout: 60_000 });
        const setup = new SetupPage(page, lang);
        const stopped = await setup.provisionItems();
        expect(stopped).toMatchObject({ apis: 'ok', 'service-accounts': 'ok', buckets: 'ok' });
        expect(stopped['secrets']).not.toBe('ok');
        const before = (await upstream.calls('browser')).length;
        consoleErrors.takeMatching(/status of 401/);

        const renewed = await withConsent(page, consent, proceed, setupBudget.inputs('provision', 1), setupBudget.consents('provision', 1));
        expect(renewed).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);
        const again = (await upstream.calls('browser'))
            .slice(before)
            .filter(isWrite)
            .map((call) => call.operation);
        expect(again).not.toContain('iam.serviceAccounts.create');
        expect(again).not.toContain('cloud-storage.buckets.insert');
    },
);
