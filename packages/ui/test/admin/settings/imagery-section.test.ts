import type { CityDoc } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cityDoc, draftOf, page, settingsState } from '../layers/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';

function area(state: SettingsViewState): FakeArea<SettingsViewState, SettingsIntentsPort> {
    return new FakeArea<SettingsViewState, SettingsIntentsPort>(state, { saveSection: Promise.resolve({ ok: true }) });
}

function calls(store: FakeArea<SettingsViewState, SettingsIntentsPort>): readonly string[] {
    return store.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap'));
}

function imageryState(city: CityDoc = cityDoc(), more: Partial<SettingsViewState['citySection']> = {}): SettingsViewState {
    const base = settingsState();
    return { ...base, section: 'imagery', citySection: { ...base.citySection, section: 'imagery', draft: draftOf(city), ...more } };
}

const BUCHAREST = cityDoc({ imagery: { autoPublish: true, rmseThresholdM: 15, targetYears: [1966, 1980] } });

describe('<hcm-settings-page> imagery', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_autoPublishTheThresholdAndTheTargetYears', async () => {
        const settings = area(imageryState(BUCHAREST));
        const { element } = await page('settings', settings, { params: ['imagery'] });

        const threshold = deep(element, '#imagery-threshold') as HTMLInputElement;
        const shown = [threshold.value, deepAll(element, '.year-row span').map((year) => year.textContent)];
        deep(element, 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        threshold.value = '9';
        threshold.dispatchEvent(new Event('input'));
        threshold.value = '';
        threshold.dispatchEvent(new Event('input'));
        deep(deepAll(element, '.year-row hcm-icon-button')[0] ?? element, 'button').click();
        await userEvent.type(deep(element, '#imagery-new-year'), '1977');
        deep(deep(element, '.actions hcm-button[icon="add"]'), 'button').click();

        expect(shown).toEqual(['15', ['1966', '1980']]);
        expect(calls(settings)).toEqual([
            'editCity {"imagery":{"autoPublish":false,"rmseThresholdM":15,"targetYears":[1966,1980]}}',
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":9,"targetYears":[1966,1980]}}',
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":null,"targetYears":[1966,1980]}}',
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":15,"targetYears":[1980]}}',
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":15,"targetYears":[1966,1977,1980]}}',
        ]);
        expect((deep(element, '#imagery-new-year') as HTMLInputElement).value).toBe('');
        expect(deepText(element)).toContain('15 m is about the width of a street.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aYearThatIsNoYearOrAlreadyListedIsRefusedAndAnInvalidThresholdIsSaid', async () => {
        const issues = [
            { path: 'imagery.rmseThresholdM', code: 'validation.tooSmall' as const },
            { path: 'imagery.targetYears', code: 'validation.duplicateId' as const },
        ];
        const settings = area(imageryState(BUCHAREST, { draft: draftOf(BUCHAREST, { issues }) }));
        const { element } = await page('settings', settings, { params: ['imagery'], locale: 'ro' });

        for (const typed of ['19', '1966']) {
            const field = deep(element, '#imagery-new-year') as HTMLInputElement;
            field.value = typed;
            deep(deep(element, '.actions hcm-button[icon="add"]'), 'button').click();
        }
        await updated(element);

        expect(calls(settings)).toEqual([]);
        expect(deepText(element)).toContain('Scrie un an între 1800 și 2099 care nu e încă în listă (cel mult 20 de ani).');
        expect(deep(element, '#imagery-threshold').closest('.field')?.hasAttribute('data-invalid')).toBe(true);
        expect(deep(element, '[role="alert"]').textContent).toContain('Anii doriți trebuie să fie ani diferiți');
    });

    it('badPath_aThresholdBeingTypedShowsEmptyAndAddWithoutItsFieldDoesNothing', async () => {
        const settings = area(imageryState(cityDoc({ imagery: { rmseThresholdM: Number.NaN } })));
        const { element } = await page('settings', settings, { params: ['imagery'] });
        const empty = (deep(element, '#imagery-threshold') as HTMLInputElement).value;
        deep(element, '#imagery-new-year').remove();
        deep(deep(element, '.actions hcm-button[icon="add"]'), 'button').click();

        expect(empty).toBe('');
        expect(calls(settings)).toEqual([]);
    });

    it('happyPath_aCityWithoutImagerySettingsShowsTheDefaultsAndNoYears', async () => {
        const settings = area(imageryState(cityDoc()));
        const { element } = await page('settings', settings, { params: ['imagery'] });

        expect((deep(element, '#imagery-threshold') as HTMLInputElement).value).toBe('15');
        expect((deep(element, 'hcm-switch') as HTMLElement & { checked: boolean }).checked).toBe(true);
        expect(deep(element, '[data-state="no-years"]').textContent).toContain('every year counts the same');
    });

    it('badPath_aRevokedAdminChangesNothingAndAListOfTwentyTakesNoMore', async () => {
        const full = cityDoc({ imagery: { targetYears: Array.from({ length: 20 }, (_, index) => 1960 + index) } });
        const settings = area(imageryState(full));
        const { element } = await page('settings', settings, { params: ['imagery'] });
        const field = deep(element, '#imagery-new-year') as HTMLInputElement;
        field.value = '1999';
        deep(deep(element, '.actions hcm-button[icon="add"]'), 'button').click();
        const revoked = await page('settings', area(imageryState(full)), { params: ['imagery'], revoked: true });

        expect(calls(settings)).toEqual([]);
        expect((deep(revoked.element, '#imagery-new-year') as HTMLInputElement).readOnly).toBe(true);
        expect((deep(revoked.element, '.actions hcm-button[icon="add"]') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('badPath_theSectionBeforeTheCityIsReadShowsItsHeadAlone', async () => {
        const base = imageryState();
        const settings = area({ ...base, citySection: { ...base.citySection, draft: { ...base.citySection.draft, value: null } } });
        const { element } = await page('settings', settings, { params: ['imagery'] });

        expect(deep(element, '[data-detail-heading]').textContent).toBe('Historical imagery');
        expect(deepAll(element, '#imagery-threshold')).toHaveLength(0);
    });
});
