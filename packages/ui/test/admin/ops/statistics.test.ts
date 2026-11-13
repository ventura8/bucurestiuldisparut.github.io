import { axeViolations } from '@hcm/test-support/axe';
import { WIZARD_IDS } from '@hcm/shared/funnels';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CrashesIntentsPort, CrashesViewState } from '../../../src/admin/crashes/crashes-port.js';
import { GA_HOME_URL } from '../../../src/admin/crashes/statistics-view.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { crashesState, page } from './fixtures.js';

/** The Statistics view (`#/crashes/statistics`, §200): the wizards' funnels in plain words, and the way to Google Analytics. */
describe('the Statistics view', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_everyWizardWithItsStepsAndTheWayToItsFunnel', async () => {
        // @S-A151-HAPPY-STATISTICS
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { app, element } = await page('crashes', crashes, { params: ['statistics'] });
        (element as HTMLElement & { state: unknown }).state = { ...app.state, analytics: true };
        await updated(element);

        expect(deepAll(element, '[data-wizard]').map((item) => item.dataset['wizard'])).toEqual([...WIZARD_IDS]);
        expect(deepText(deep(element, '[data-wizard="new_city"]'))).toMatch(/The area on the map \( ?area ?\)/);
        expect(deepText(deep(element, '[data-wizard="setup"]'))).toContain('One step per Setup card');
        expect(deep(element, 'a.external').getAttribute('href')).toBe(GA_HOME_URL);
        expect(deepAll(element, '[data-statistics-off]')).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAnalyticsItSaysSoAndLeadsToSetup', async () => {
        // @S-A151-BAD-NO-ANALYTICS
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { element } = await page('crashes', crashes, { params: ['statistics'], locale: 'ro' });

        expect(deepText(deep(element, '[data-statistics-off]'))).toContain('Statisticile sunt oprite');
        expect(deepAll(element, 'a').some((link) => link.getAttribute('href') === '#/setup/analytics')).toBe(true);
    });

    it('happyPath_theCrashListLinksTheView', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { element } = await page('crashes', crashes);

        expect(deep(element, '[data-statistics-link]').getAttribute('href')).toBe('#/crashes/statistics');
    });
});
