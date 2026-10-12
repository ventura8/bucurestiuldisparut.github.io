import { SITE_ORIGIN } from '../../fixtures/world.js';
import { mapFacts } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, openViewer, t } from '../../support/viewer.js';

/**
 * "Show my location" (behaviour V10): the browser's position moves the camera when it lies inside the city; a
 * refused permission or a position outside the city says so in a toast and leaves the camera where it was. The
 * position comes from the browser context (Playwright's geolocation), never from a network service.
 */

const INSIDE = { latitude: 44.4301, longitude: 26.1003 } as const;
/** Cluj-Napoca: far outside Bucharest's bounds. */
const OUTSIDE = { latitude: 46.7712, longitude: 23.6236 } as const;

test('A position inside the city moves the camera there', { tag: '@S-V10-HAPPY' }, async ({ page, context, lang }) => {
    await context.grantPermissions(['geolocation'], { origin: SITE_ORIGIN });
    await context.setGeolocation(INSIDE);
    await openViewer(page, { lang });

    await chooseMenuItem(page, lang, t(lang, 'action.locate'));

    await expect
        .poll(async () => (await mapFacts(page)).center[1], { message: 'the camera reaches the latitude' })
        .toBeCloseTo(INSIDE.latitude, 4);
    await expect.poll(async () => (await mapFacts(page)).moving).toBe(false);
    const facts = await mapFacts(page);
    expect(facts.center[0]).toBeCloseTo(INSIDE.longitude, 4);
    expect(facts.zoom).toBeGreaterThanOrEqual(16);
    await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0);
});

test('A refused permission says so and the camera stays', { tag: '@S-V10-BAD-DENIED' }, async ({ page, context, lang }) => {
    await context.clearPermissions();
    await openViewer(page, { lang });
    const before = await mapFacts(page);

    await chooseMenuItem(page, lang, t(lang, 'action.locate'));

    await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.geolocate.denied') })).toBeVisible();
    const after = await mapFacts(page);
    expect(after.center[0]).toBeCloseTo(before.center[0], 6);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
});

test('A position outside the city says so and the camera stays', { tag: '@S-V10-BAD-OUT-OF-BOUNDS' }, async ({ page, context, lang }) => {
    await context.grantPermissions(['geolocation'], { origin: SITE_ORIGIN });
    await context.setGeolocation(OUTSIDE);
    await openViewer(page, { lang });
    const before = await mapFacts(page);

    await chooseMenuItem(page, lang, t(lang, 'action.locate'));

    await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.geolocate.outside') })).toBeVisible();
    const after = await mapFacts(page);
    expect(after.center[1]).toBeCloseTo(before.center[1], 6);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
});
