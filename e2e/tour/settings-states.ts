import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { chooseMenuItem, dismissToast, menuButton, t, viewer } from '../support/viewer.js';

/**
 * The states of the owner's request of 2026-11-08 in the tour's inventory: Settings (Setări), the menu's dialog that holds
 * the language and the theme since they left About, visited by the journey `home` of e2e/tour/states.ts, then the other
 * language chosen in it; and the Layers pane minimized to its rail, which exists only where the pane is always docked
 * (extra-large, 1600 px and wider), visited by the journey `year-layers` after the opacity state.
 */

export interface SettingsTour {
    readonly page: Page;
    readonly lang: Locale;
}

/** Extra-large windows (1600 px and wider, not a phone held landscape) dock the Layers pane for good (layout.ts). */
function hasDockedLayers(page: Page): boolean {
    const size = page.viewportSize();
    return size !== null && size.width >= 1600 && size.height >= 480;
}

export const SETTINGS_STATES = {
    settings: {
        title: 'Settings from the menu: the language and the theme (full screen on a phone)',
        enter: async ({ page, lang }: SettingsTour) => {
            // The previous state's toast is closed first: its timer went mid-check on a slow machine.
            await dismissToast(page, lang);
            await chooseMenuItem(page, lang, t(lang, 'settings.title'));
            const dialog = viewer(page).locator('hcm-about-dialog');
            await expect(page.getByRole('dialog', { name: t(lang, 'settings.title') })).toBeVisible();
            await expect(dialog.getByRole('radiogroup', { name: t(lang, 'theme.label') })).toBeVisible();
        },
        escape: ({ lang }: SettingsTour) => ({ opener: t(lang, 'action.menu') }),
    },
    language: {
        title: 'The other language chosen in Settings: the whole viewer in it, Settings closed',
        enter: async ({ page, lang }: SettingsTour) => {
            const other = lang === 'ro' ? 'en' : 'ro';
            // The Settings state's Esc closed the dialog: it is opened again from the menu.
            await chooseMenuItem(page, lang, t(lang, 'settings.title'));
            await viewer(page)
                .locator('hcm-about-dialog')
                .getByRole('radio', { name: t(lang, `language.${other}`) })
                .click();
            await expect(page.getByRole('dialog', { name: t(other, 'settings.title') })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(menuButton(page, other)).toBeVisible();
        },
        shows: (lang: Locale): Locale => (lang === 'ro' ? 'en' : 'ro'),
    },
    'layers-minimized': {
        title: 'The always-docked Layers pane minimized to its rail: the map takes the rest',
        enter: async ({ page, lang }: SettingsTour) => {
            const pane = viewer(page).locator('.pane.leading');
            await pane.getByRole('button', { name: t(lang, 'action.close'), exact: true }).click();
            const rail = pane.getByRole('button', { name: t(lang, 'layers.title'), exact: true });
            await expect(rail).toBeFocused();
            await expect(rail).toHaveAttribute('aria-expanded', 'false');
        },
        exists: hasDockedLayers,
    },
};
