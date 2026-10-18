// The deployment, Mapbox and USGS bodies: copy buttons, the paste boxes and the 60 s countdown.
import { axeViolations } from '@hcm/test-support/axe';
import { MAPBOX_TOKENS } from '@hcm/test-support/fakes';
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { HcmSetupDeploy } from '../../../src/admin/setup/hcm-setup-deploy.js';
import { defineHcmSetupDeploy } from '../../../src/admin/setup/hcm-setup-deploy.js';
import type { HcmSetupMapbox } from '../../../src/admin/setup/hcm-setup-mapbox.js';
import { defineHcmSetupMapbox } from '../../../src/admin/setup/hcm-setup-mapbox.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, type ViewChanges } from './fixtures.js';

defineHcmSetupDeploy();
defineHcmSetupMapbox();

describe('<hcm-setup-deploy>', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        cleanup();
    });

    async function deploy(changes: ViewChanges = {}) {
        const port = new FakeSetupPort(setupView(changes));
        return fixture<HcmSetupDeploy>(
            html`<hcm-setup-deploy .view=${port.getState()} .intents=${port.intents} locale="en"></hcm-setup-deploy>`,
        );
    }

    it('happyPath_explainsTheInstallationAndCountsTheFunctions', async () => {
        const element = await deploy({ deploy: { ...setupView().deploy, ready: 8, watching: true } });

        await expect.element(page.getByRole('progressbar', { name: '8 of 32 functions installed' })).toHaveAttribute('aria-valuenow', '25');
        expect(shadowPart(element, '[role="status"]').textContent).toBe('Checking every 30 seconds…');
        expect(shadowPart(element, '.copy-list').textContent).toContain('GCP_PROJECT_ID');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aCopyButtonCopiesTheVariableAndSaysSo', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const element = await deploy();

        await page.getByRole('button', { name: 'Copy GCP_PROJECT_ID' }).click();

        expect(writeText).toHaveBeenCalledWith('demo-hcm');
        await expect.poll(() => element.renderRoot.querySelector('.copied')?.textContent).toBe('Copied.');
    });

    it('badPath_theCopyButtonsLineUpWhateverTheValuesLength', async () => {
        // The M2 final screenshots: space-between put each button midway between its value and the empty status.
        const variables = [
            { name: 'GCP_DEPLOY_SA', value: 'gh-deployer@demo-hcm.iam.gserviceaccount.com' },
            { name: 'GCP_PROJECT_ID', value: 'demo-hcm' },
        ];
        const element = await deploy({ deploy: { ...setupView().deploy, variables } });
        // Wide enough that no value wraps: then the rows' free space differs, and so did the buttons' places.
        element.style.display = 'block';
        element.style.inlineSize = '1000px';
        const rows = [...element.renderRoot.querySelectorAll<HTMLElement>('.copy-row')];
        const ends = rows.map((row) => Math.round(row.querySelector('hcm-icon-button')?.getBoundingClientRect().right ?? 0));

        expect(rows.length).toBeGreaterThan(1);
        expect(new Set(ends).size).toBe(1);
    });

    it('badPath_aRefusedClipboardSaysNothing', async () => {
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        const element = await deploy();

        await page.getByRole('button', { name: 'Copy DEPLOY_ENABLED' }).click();

        await expect.poll(() => element.copied).toBeNull();
        expect([...element.renderRoot.querySelectorAll('.copied')].map((note) => note.textContent)).toEqual(['', '']);
    });

    it('badPath_noFunctionCountShowsAnEmptyBar', async () => {
        await deploy({ deploy: { ...setupView().deploy, total: 0 } });

        await expect.element(page.getByRole('progressbar', { name: '0 of 0 functions installed' })).toHaveAttribute('aria-valuenow', '0');
    });
});

describe('<hcm-setup-mapbox>', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        cleanup();
    });

    async function mapbox(changes: ViewChanges = {}, locale = 'ro') {
        const port = new FakeSetupPort(setupView(changes));
        const element = await fixture<HcmSetupMapbox>(
            html`<hcm-setup-mapbox .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-mapbox>`,
        );
        return { port, element };
    }

    it('happyPath_theScopesToTickCanBeCopied', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const { element } = await mapbox();

        expect(shadowPart(element, '.scopes').textContent).toBe('styles:read tokens:write');
        await page.getByRole('button', { name: 'Copiază permisiunile' }).click();

        expect(writeText).toHaveBeenCalledWith('styles:read tokens:write');
    });

    /** What a paste from the clipboard does to the box: its value, then an `insertFromPaste` input. */
    function paste(box: HTMLInputElement, value: string): void {
        box.value = value;
        box.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
    }

    it('happyPath_aPastedSecretIsSavedAtOnceAndTheBoxCleared', async () => {
        const { port, element } = await mapbox();
        const box = page.getByLabelText('Tokenul secret (sk.…)');

        await expect.element(box).toHaveAttribute('type', 'password');
        await expect.element(box).toHaveAttribute('autocomplete', 'off');
        paste(box.element() as HTMLInputElement, MAPBOX_TOKENS.bootstrap);

        expect(port.calls).toEqual([['saveMapbox', MAPBOX_TOKENS.bootstrap]]);
        expect((box.element() as HTMLInputElement).value).toBe('');
        expect(element.verdict).toBe('empty');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aTypedSecretIsSavedWithEnterOrSave', async () => {
        const { port, element } = await mapbox();
        const box = page.getByLabelText('Tokenul secret (sk.…)');

        await userEvent.fill(box, MAPBOX_TOKENS.bootstrap);
        expect(shadowPart(element, '#verdict').textContent).toBe('Pare un token secret.');
        expect(port.calls).toEqual([]);
        await userEvent.keyboard('{Enter}');
        await userEvent.fill(box, MAPBOX_TOKENS.bootstrap);
        await page.getByRole('button', { name: 'Salvează' }).click();
        await userEvent.click(box);
        await userEvent.keyboard('{Enter}');

        expect(port.calls).toEqual([
            ['saveMapbox', MAPBOX_TOKENS.bootstrap],
            ['saveMapbox', MAPBOX_TOKENS.bootstrap],
        ]);
    });

    it('badPath_aPastedPublicTokenIsCountedAndExplainedButNotSent', async () => {
        const { port, element } = await mapbox({}, 'en');

        paste(shadowPart(element, '#token') as HTMLInputElement, MAPBOX_TOKENS.defaultPublic);
        await element.updateComplete;

        expect(port.calls).toEqual([['noteInput', 'mapbox']]);
        expect(shadowPart(element, '#verdict').textContent).toBe('This is a public token (pk.). Paste the secret token (sk.) you created.');
    });

    it('badPath_aPublicTokenIsExplainedBeforeAnyCall', async () => {
        const { element } = await mapbox({}, 'en');
        const box = page.getByLabelText('Secret token (sk.…)');

        await userEvent.fill(box, MAPBOX_TOKENS.defaultPublic);
        expect(shadowPart(element, '#verdict').textContent).toBe('This is a public token (pk.). Paste the secret token (sk.) you created.');
        await userEvent.fill(box, 'hello');
        expect(shadowPart(element, '#verdict').textContent).toBe('This does not look like a Mapbox secret token (one starts with sk.).');
        await userEvent.fill(box, '   ');
        expect(shadowPart(element, '#verdict').textContent).toBe('');
    });

    it('badPath_saveBeforeAnyPasteSendsNothing', async () => {
        const { port, element } = await mapbox();

        shadowPart(element, 'hcm-button').click();

        expect(port.calls).toEqual([]);
    });

    it('happyPath_aSavedTokenNamesItsAccount', async () => {
        const { element } = await mapbox({ mapbox: { user: 'ventura86', requiredScopes: [] } });

        expect(shadowPart(element, '.success').textContent).toBe('Salvat pentru contul Mapbox ventura86.');
    });
});
