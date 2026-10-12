import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_MAP_ATTRIBUTION_TAG, HcmMapAttribution, defineHcmMapAttribution } from '../../src/viewer/hcm-map-attribution.js';
import { mountElement, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';

/** mapbox-gl.css stands in as an empty stylesheet: the test runs offline. */
const CSS_URL = 'data:text/css,';

describe('<hcm-map-attribution>', () => {
    beforeAll(() => {
        defineHcmMapAttribution();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theMapboxLogoAndTheMapsCreditsWithTheirLinks', async () => {
        const element = await mountElement<HcmMapAttribution>(HCM_MAP_ATTRIBUTION_TAG, {
            parts: [{ text: '© Mapbox', href: 'https://www.mapbox.com/about/maps/' }, { text: 'USGS (e2e) <b>1966</b>' }],
            cssUrl: CSS_URL,
        });

        await expect.element(page.getByRole('link', { name: 'Pagina Mapbox' })).toHaveAttribute('href', 'https://www.mapbox.com/');
        await expect.element(page.getByRole('link', { name: '© Mapbox' })).toHaveAttribute('target', '_blank');
        expect(shadowQuery(element, '[data-layout-check="map-attribution"]').textContent.replace(/\s+/g, ' ').trim()).toBe(
            '© Mapbox USGS (e2e) <b>1966</b>',
        );
        expect(shadowQueryAll(element, 'b')).toHaveLength(0);
        expect(shadowQuery(element, 'link').getAttribute('href')).toBe(CSS_URL);
        // The wordmark sits in a 48 px tall touch target.
        expect(shadowQuery(element, 'a.mapboxgl-ctrl-logo').getBoundingClientRect().height).toBe(48);
    });

    it('badPath_beforeTheMapHasCreditsTheBasemapsAreShownInEnglishToo', async () => {
        const element = await mountElement<HcmMapAttribution>(HCM_MAP_ATTRIBUTION_TAG, { locale: 'en' });

        expect(shadowText(element)).toBe('© Mapbox © OpenStreetMap');
        await expect.element(page.getByRole('link', { name: 'Mapbox homepage' })).toBeVisible();
        expect(element.shadowRoot?.querySelector('link')).toBeNull();
        defineHcmMapAttribution();
        expect(customElements.get(HCM_MAP_ATTRIBUTION_TAG)).toBe(HcmMapAttribution);
    });
});
