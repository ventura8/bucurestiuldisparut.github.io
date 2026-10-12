import { describe, expect, it } from 'vitest';

import { en as setupEn } from '../src/i18n/admin-setup/en.js';
import { translateAdminSetup } from '../src/i18n/admin-setup/index.js';
import { ro as setupRo } from '../src/i18n/admin-setup/ro.js';
import { en as shellEn } from '../src/i18n/admin-shell/en.js';
import { translateAdminShell } from '../src/i18n/admin-shell/index.js';
import { ro as shellRo } from '../src/i18n/admin-shell/ro.js';
import { catalogueTranslator } from '../src/i18n/catalogue.js';
import { PROVISION_ITEMS, SERVICE_STATES } from '../src/schemas/firestore-ops.js';

const byText = (a: string, b: string): number => a.localeCompare(b);

/** Romanian with the cedilla forms (ş, ţ) instead of the comma-below letters (ș, ț): wrong in every catalogue. */
const CEDILLA = /[şţŞŢ]/;

const FAMILIES = [
    ['admin shell', shellRo, shellEn],
    ['Setup Assistant', setupRo, setupEn],
] as const;

describe('admin catalogues', () => {
    it.each(FAMILIES)('happyPath_the %s catalogues have the same keys in both languages', (_name, ro, en) => {
        expect(Object.keys(en).toSorted(byText)).toEqual(Object.keys(ro).toSorted(byText));
    });

    it.each(FAMILIES)('badPath_the %s catalogues use comma-below diacritics only', (_name, ro, en) => {
        const wrong = [...Object.values(ro), ...Object.values(en)].filter((text) => CEDILLA.test(text));

        expect(wrong).toEqual([]);
    });

    it('happyPath_theShellExplainsTheGoogleConsentInBothLanguages', () => {
        expect(translateAdminShell('ro', 'adminShell.auth.notOwner', { projectId: 'demo-hcm' })).toBe(
            'Doar proprietarul proiectului Google Cloud demo-hcm poate configura harta.',
        );
        expect(translateAdminShell('en', 'adminShell.oauth.unverifiedHow', { domain: 'demo-hcm.firebaseapp.com' })).toBe(
            'If so, open the advanced options and continue to demo-hcm.firebaseapp.com.',
        );
    });

    it('happyPath_everyDoctorItemAndServiceStateHasALabel', () => {
        const items = PROVISION_ITEMS.map((id) => translateAdminSetup('en', `adminSetup.provision.item.${id}`));
        const states = SERVICE_STATES.map((state) => translateAdminSetup('ro', `adminSetup.state.${state}`));

        expect(items).toHaveLength(PROVISION_ITEMS.length);
        expect(items.every((label) => label.length > 0)).toBe(true);
        expect(states).toEqual(['De făcut', 'În așteptare', 'Gata', 'Necesită atenție', 'Indisponibil acum']);
    });

    it('badPath_anUnknownPlaceholderStaysVisible', () => {
        expect(translateAdminSetup('ro', 'adminSetup.import.progress', { done: '3' })).toBe('3 din {total} fotografii importate');
    });
});

describe('catalogueTranslator', () => {
    const translate = catalogueTranslator<'greeting'>({ ro: { greeting: 'Salut, {name}!' }, en: { greeting: 'Hello, {name}!' } });

    it('happyPath_fillsThePlaceholdersOfTheChosenLocale', () => {
        expect(translate('en', 'greeting', { name: 'Ana' })).toBe('Hello, Ana!');
        expect(translate('ro', 'greeting', { name: 'Ana' })).toBe('Salut, Ana!');
    });

    it('badPath_withoutParamsThePlaceholderStaysVisible', () => {
        expect(translate('ro', 'greeting')).toBe('Salut, {name}!');
    });
});
