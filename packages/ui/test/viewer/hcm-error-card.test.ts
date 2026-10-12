import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_ERROR_CARD_TAG, HcmErrorCard, defineHcmErrorCard } from '../../src/viewer/hcm-error-card.js';
import { defineKitDoubles, mountElement, recordEvents, shadowText } from './doubles.js';

describe('<hcm-error-card>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmErrorCard();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aRetryableErrorOffersRetry', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG, {
            error: { code: 'error.manifest.notFound', retryable: true },
        });
        const events = recordEvents(element, 'hcm-retry');

        await expect.element(page.getByRole('alert')).toHaveTextContent('Harta nu a fost găsită: manifestul lipsește. Reîncearcă');
        await page.getByRole('button', { name: 'Reîncearcă' }).click();

        expect(events).toHaveLength(1);
    });

    it('badPath_aConfigurationErrorNamesTheProblemWithoutRetry', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG, {
            locale: 'en',
            error: { code: 'error.config.cityMismatch', retryable: false, params: { cityId: 'iasi', manifestCityId: 'bucuresti' } },
        });

        await expect
            .element(page.getByRole('alert'))
            .toHaveTextContent('The cityId in config.js (iasi) does not match the map (bucuresti).');
        expect(shadowText(element)).toContain('bucuresti');
        expect(element.shadowRoot?.querySelector('hcm-button')).toBeNull();
    });

    it('badPath_noErrorRendersNothing', async () => {
        const element = await mountElement<HcmErrorCard>(HCM_ERROR_CARD_TAG);

        expect(shadowText(element)).toBe('');
        expect(customElements.get(HCM_ERROR_CARD_TAG)).toBe(HcmErrorCard);
    });
});
