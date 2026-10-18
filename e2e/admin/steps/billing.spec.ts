import type { Locator, Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { setupText, apiText } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { openStep, seedClaimedCity, withConsent } from '../support/steps.js';
import type { UpstreamCall, UpstreamControl } from '../support/upstream.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's billing step (docs/research/M2b-interfaces.md §3.3 b, §5; behaviour A04) on a claimed map, its
 * owner signed in (normal mode, so the consent is cloud-platform and the result is recorded with `setup.recordCloud`):
 * one click and one consent link the project to the open billing account of the owner's Google world of the fake
 * upstreams and create the $5 budget; the billing fakes' scenarios and failures give every answer Google may give.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

test.beforeEach(async ({ adminWorld }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
});

interface BillingCard {
    readonly card: Locator;
    readonly link: Locator;
}

async function billingCard(page: Page, lang: 'ro' | 'en'): Promise<BillingCard> {
    const card = await openStep(page, lang, 'billing');
    const text = setupText(lang, 'adminSetup.billing.link').split('{')[0] ?? '';
    return { card, link: card.getByRole('button', { name: new RegExp(`^${text}`) }) };
}

/** The owner's own calls of `operation` (a prefix: `billing-budgets`, `cloud-billing.updateBillingInfo`). */
async function calls(upstream: UpstreamControl, operation: string, method?: string): Promise<UpstreamCall[]> {
    const all = await upstream.calls('browser', operation);
    return method === undefined ? all : all.filter((call) => call.method === method);
}

test(
    'One open account: one click and one consent link billing and create the $5 budget with its alerts; the card is green and recorded',
    { tag: ['@S-A04-HAPPY'] },
    async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
        const { link } = await billingCard(page, lang);
        const scopes = await withConsent(page, consent, link, setupBudget.inputs('billing'), setupBudget.consents('billing'));

        expect(scopes).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await new SetupPage(page, lang).expectState('billing', 'ok');
        expect(await calls(upstream, 'cloud-billing.updateBillingInfo')).toHaveLength(1);
        const [created] = await calls(upstream, 'billing-budgets', 'POST');
        const budget = JSON.parse(created?.body ?? '{}') as {
            amount?: unknown;
            thresholdRules?: { thresholdPercent: number; spendBasis?: string }[];
        };
        expect(budget.amount).toMatchObject({ specifiedAmount: { currencyCode: 'USD', units: '5' } });
        expect(budget.thresholdRules?.map((rule) => [rule.thresholdPercent, rule.spendBasis ?? 'CURRENT_SPEND'])).toEqual(
            expect.arrayContaining([
                [0.5, 'CURRENT_SPEND'],
                [0.9, 'CURRENT_SPEND'],
                [1, 'CURRENT_SPEND'],
                [1, 'FORECASTED_SPEND'],
            ]),
        );
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['billing'])
            .toMatchObject({ state: 'ok', budgetAmount: 5, currency: 'USD', budgetId: expect.stringMatching(/^billingAccounts\//) });
    },
);

test(
    'Several open accounts are a choice with the first preselected: one more input links it and the budget goes on it',
    { tag: ['@S-A04-BAD-SEVERAL-ACCOUNTS'] },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        await upstream.scenario('cloud-billing.severalAccounts', 'browser');
        const { card, link } = await billingCard(page, lang);
        const inputs = setupBudget.inputs('billing', 1);
        await withConsent(page, consent, link, inputs, setupBudget.consents('billing'));

        const choice = card.getByRole('group', { name: setupText(lang, 'adminSetup.billing.chooseAccount') });
        await expect(choice.getByRole('radio')).toHaveCount(2);
        await expect(choice.getByRole('radio').first()).toBeChecked();
        await inputs.click(card.getByRole('button', { name: setupText(lang, 'adminSetup.billing.useAccount') }));

        await new SetupPage(page, lang).expectState('billing', 'ok');
        const [linked] = await calls(upstream, 'cloud-billing.updateBillingInfo');
        expect(JSON.parse(linked?.body ?? '{}')).toMatchObject({ billingAccountName: 'billingAccounts/0E2E00-0E2E00-0E2E01' });
        expect((await calls(upstream, 'billing-budgets', 'POST')).map((call) => call.url)).toEqual([
            expect.stringContaining('/billingAccounts/0E2E00-0E2E00-0E2E01/budgets'),
        ]);
    },
);

test(
    'A billing account at its project quota is explained; billing stays as it was and the same button retries',
    { tag: ['@S-A04-BAD-BILLING-QUOTA'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        await upstream.scenario('cloud-billing.quotaExceeded', 'browser');
        const { card, link } = await billingCard(page, lang);
        await withConsent(page, consent, link, setupBudget.inputs('billing'), setupBudget.consents('billing'));

        await expect(card.getByRole('alert')).toHaveText(setupText(lang, 'adminSetup.billing.quota'));
        await expect(link).toBeEnabled();
        expect(await calls(upstream, 'billing-budgets', 'POST')).toEqual([]);
        await new SetupPage(page, lang).expectState('billing', 'missing');
        expect(consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'A missing role for the budget names it; billing stays linked and Retry creates only the budget',
    { tag: ['@S-A04-BAD-BUDGET-PERMISSION'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        await upstream.fail('billing-budgets', 'forbidden', 'browser');
        const { card, link } = await billingCard(page, lang);
        const inputs = setupBudget.inputs('billing', 1);
        await withConsent(page, consent, link, inputs, setupBudget.consents('billing'));

        await expect(card.getByRole('alert')).toHaveText(
            apiText(lang, 'apiError.cloud.permission', { role: 'roles/billing.costsManager' }),
        );
        expect(await calls(upstream, 'cloud-billing.updateBillingInfo')).toHaveLength(1);
        expect(consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);

        // The role granted: Retry (the token is still live: no consent) links nothing again and creates the budget.
        await upstream.fail('billing-budgets', null, 'browser');
        await inputs.click(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }));
        await new SetupPage(page, lang).expectState('billing', 'ok');
        expect(await calls(upstream, 'cloud-billing.updateBillingInfo')).toHaveLength(1);
        expect(await calls(upstream, 'billing-budgets', 'POST')).toHaveLength(1);
    },
);

test(
    "The app's budget, found from an earlier setup, is patched to the spec instead of duplicated",
    { tag: ['@S-A04-BAD-BUDGET-EXISTS'] },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        await upstream.scenario('billing-budgets.staleBudget', 'browser');
        const { link } = await billingCard(page, lang);
        await withConsent(page, consent, link, setupBudget.inputs('billing'), setupBudget.consents('billing'));

        await new SetupPage(page, lang).expectState('billing', 'ok');
        expect(await calls(upstream, 'billing-budgets', 'POST')).toEqual([]);
        const [patched] = await calls(upstream, 'billing-budgets', 'PATCH');
        expect(new URL(patched?.url ?? 'https://x/').searchParams.get('updateMask')?.split(',')).toEqual(
            expect.arrayContaining(['amount', 'thresholdRules']),
        );
        expect(JSON.parse(patched?.body ?? '{}')).toMatchObject({ amount: { specifiedAmount: { currencyCode: 'USD', units: '5' } } });
    },
);

test(
    "A 403 from a Google API names the role the owner's account lacks",
    { tag: ['@S-A04-BAD-API-PERMISSION'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        await upstream.fail('cloud-billing', 'forbidden', 'browser');
        const { card, link } = await billingCard(page, lang);
        await withConsent(page, consent, link, setupBudget.inputs('billing'), setupBudget.consents('billing'));

        await expect(card.getByRole('alert')).toHaveText(apiText(lang, 'apiError.cloud.permission', { role: 'roles/billing.viewer' }));
        expect(await calls(upstream, 'cloud-billing.updateBillingInfo')).toEqual([]);
        expect(consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
    },
);
