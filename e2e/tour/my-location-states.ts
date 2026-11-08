import type { Locale } from '@hcm/shared';
import type { BrowserContext, Page } from '@playwright/test';

import { SITE_ORIGIN } from '../fixtures/world.js';
import { mapIdle } from '../support/map.js';
import { chooseMenuItem, holdToast, t } from '../support/viewer.js';

/**
 * Show my location's state in the tour's inventory (behaviour V10, `docs/ENGINE_API.md` → *Show my location*), visited by
 * the journey `home` of e2e/tour/states.ts after the refused permission: the browser context grants the position now, so
 * the blue dot, its accuracy circle and the toast that says the accuracy run the generic checkers at every viewport.
 */

export interface LocationTour {
    readonly page: Page;
    readonly context: BrowserContext;
    readonly lang: Locale;
}

/** The position the tour gives, with the accuracy its toast says. */
const POSITION = { latitude: 44.4301, longitude: 26.1003, accuracy: 25 };

function shown(lang: Locale): string {
    return t(lang, 'geolocate.shown', { meters: String(POSITION.accuracy) });
}

export const MY_LOCATION_STATES = {
    'my-location': {
        title: 'Show my location on: the blue dot with its accuracy circle, the accuracy said in a toast',
        enter: async ({ page, context, lang }: LocationTour) => {
            await context.grantPermissions(['geolocation'], { origin: SITE_ORIGIN });
            await context.setGeolocation(POSITION);
            await chooseMenuItem(page, lang, t(lang, 'action.locate'));
            await holdToast(page, shown(lang));
            await mapIdle(page);
        },
        announcements: (lang: Locale) => [shown(lang)],
    },
};
