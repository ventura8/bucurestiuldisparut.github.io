import { describe, expect, it } from 'vitest';

import { en } from '../src/i18n/en.js';
import { DEFAULT_LOCALE, LOCALES, resolveLocale, translate } from '../src/i18n/index.js';
import { ro } from '../src/i18n/ro.js';

const byText = (a: string, b: string): number => a.localeCompare(b);

describe('catalogues', () => {
    it('happyPath_romanianIsTheDefaultLocale', () => {
        expect(DEFAULT_LOCALE).toBe('ro');
        expect(LOCALES).toEqual(['ro', 'en']);
    });

    it('happyPath_everyLocaleHasTheSameKeys', () => {
        expect(Object.keys(en).toSorted(byText)).toEqual(Object.keys(ro).toSorted(byText));
    });

    it('badPath_noCatalogueHasAnEmptyMessage', () => {
        const empty = [...Object.entries(ro), ...Object.entries(en)].filter(([, text]) => text.trim() === '');

        expect(empty).toEqual([]);
    });
});

describe('resolveLocale', () => {
    it.each([
        ['ro', 'ro'],
        ['ro-RO', 'ro'],
        ['en', 'en'],
        ['EN-us', 'en'],
        [' en-GB ', 'en'],
    ] as const)('happyPath_%s_resolvesTo_%s', (tag, expected) => {
        expect(resolveLocale(tag)).toBe(expected);
    });

    it.each([['fr'], ['de-DE'], [''], [null], [undefined]])('badPath_%s_fallsBackToRomanian', (tag) => {
        expect(resolveLocale(tag)).toBe('ro');
    });
});

describe('translate', () => {
    it('happyPath_returnsTheCatalogueText', () => {
        expect(translate('ro', 'app.title')).toBe('București dispărut');
        expect(translate('en', 'app.title')).toBe('Vanished Bucharest');
    });

    it('happyPath_fillsPlaceholders', () => {
        expect(translate('ro', 'hello.greeting', { name: 'București' })).toBe('Salut, București!');
    });

    it('badPath_missingParameterLeavesThePlaceholderVisible', () => {
        expect(translate('en', 'hello.greeting')).toBe('Hello, {name}!');
    });
});
