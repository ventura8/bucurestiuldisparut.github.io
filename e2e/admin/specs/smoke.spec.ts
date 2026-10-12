import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { setupText, shellText } from '../support/i18n.js';
import { adminPath, expect, test } from '../support/test.js';
import { E2E_PROJECT_ID, PERSONAS } from '../world.js';

/**
 * The admin's smoke (docs/research/M2b-interfaces.md §1.3, §2.1, §3.3 d2): with the server answering (normal mode),
 * the project's owner signs in with Google, confirms the ownership with one read-only consent, and lands on the Setup
 * Assistant at its next step, billing; a stranger who signs in once the map has an owner is told the account does not
 * administer the map. Everything owned runs for real on the emulators; only Google's consent page is the stand-in.
 */

test(
    'The project owner claims the map with Google and reaches the dashboard',
    { tag: '@S-A01-HAPPY' },
    async ({ page, lang, consent, setupBudget, adminWorld }) => {
        await page.goto(adminPath(lang));

        // The daily sign-in asks Google for nothing beyond the account (§2.1).
        const signInButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') });
        const signIn = await consent.opened(page, () => setupBudget.inputs('signIn').click(signInButton));
        expect(await signIn.requestedScopes()).toEqual([]);
        await signIn.allow(setupBudget.consents('signIn'));

        // admin.session says the map has no owner: the claim costs one click and one read-only consent.
        await expect(page.getByText(shellText(lang, 'adminShell.auth.claimTitle', { projectId: E2E_PROJECT_ID }))).toBeVisible();
        const claimButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.claimAction') });
        const claim = await consent.opened(page, () => setupBudget.inputs('claim', 1).click(claimButton));
        expect(await claim.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudReadOnly]);
        await claim.allow(setupBudget.consents('claim', 1));

        // The dashboard of a map not set up yet is the Setup Assistant, open at its next step.
        await expect(page.getByRole('heading', { name: setupText(lang, 'adminSetup.step.billing') })).toBeVisible();
        const owner = adminWorld.accounts.owner.uid;
        await expect
            .poll(() => adminWorld.emulators.document(`admins/${owner}`))
            .toEqual(expect.objectContaining({ role: 'owner', email: PERSONAS.owner.email }));
        expect(await adminWorld.emulators.document('setup/owner')).toEqual(expect.objectContaining({ uid: owner }));
    },
);

test.describe('a stranger, once the map has an owner', () => {
    test.use({ persona: 'stranger', mapOwner: 'owner' });

    test('A non-admin without an invitation is told and signed out', { tag: '@S-A01-BAD-STRANGER' }, async ({ page, lang, adminWorld }) => {
        await page.goto(adminPath(lang));

        await expect(page.getByText(shellText(lang, 'adminShell.auth.notAdmin'))).toBeVisible();
        await page.getByRole('button', { name: shellText(lang, 'adminShell.auth.otherAccount') }).click();

        await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })).toBeVisible();
        expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.stranger.uid}`)).toBeUndefined();
    });
});
