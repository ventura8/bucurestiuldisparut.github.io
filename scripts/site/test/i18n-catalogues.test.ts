/** The viewer's catalogues out of the engine's bundle and into `i18n/<locale>.json` (DECISIONS-for-review.md §159). */
import { VIEWER_LOCALES } from '@hcm/shared';
import { VIEWER_CATALOGUES } from '@hcm/shared/viewer-catalogues';
import { describe, expect, it } from 'vitest';

import { CATALOGUE_FOLDER, catalogueFile, catalogueStandIn, i18nCataloguesPlugin } from '../src/i18n-catalogues.js';

const I18N = '/repo/packages/shared/src/i18n';

describe('catalogueStandIn', () => {
    it.each([
        [`${I18N}/ro.ts`, 'export const ro = undefined;\n'],
        [`${I18N}/en.ts?v=1`, 'export const en = undefined;\n'],
        [`${I18N}/map-labels/ro.ts`, 'export const ro = undefined;\n'],
        ['C:\\repo\\packages\\shared\\src\\i18n\\map-labels\\en.ts', 'export const en = undefined;\n'],
    ])('happyPath_%s_isEmptied', (id, standIn) => {
        expect(catalogueStandIn(id)).toBe(standIn);
    });

    it.each([`${I18N}/de.ts`, `${I18N}/index.ts`, `${I18N}/admin-shell/ro.ts`, '/repo/packages/ui/src/ro.ts', `${I18N}/ro.tsx`])(
        'badPath_%s_isLeftToTheBundler',
        (id) => {
            expect(catalogueStandIn(id)).toBeNull();
        },
    );
});

describe('catalogueFile', () => {
    it('happyPath_theFileNamesTheEngineAndTheLanguageWithItsKeysSorted', () => {
        const file = JSON.parse(catalogueFile('1.2.3', 'de', { 'b.key': 'B', 'a.key': 'A' })) as Record<string, unknown>;

        expect(file).toEqual({ engine: '1.2.3', locale: 'de', messages: { 'a.key': 'A', 'b.key': 'B' } });
        expect(Object.keys(file['messages'] as object)).toEqual(['a.key', 'b.key']);
    });

    it('happyPath_everyViewerLanguageShipsTheSameKeysAsRomanian', () => {
        const keys = (locale: (typeof VIEWER_LOCALES)[number]): string[] =>
            Object.keys((JSON.parse(catalogueFile('1.0.0', locale, VIEWER_CATALOGUES[locale])) as { messages: object }).messages);

        for (const locale of VIEWER_LOCALES) {
            expect({ locale, keys: keys(locale) }).toEqual({ locale, keys: keys('ro') });
        }
        expect(keys('ro')).toContain('mapLabels.streets');
    });
});

describe('i18nCataloguesPlugin', () => {
    it('happyPath_emptiesTheBundledCataloguesAndWritesOneFilePerLanguage', () => {
        const plugin = i18nCataloguesPlugin('2.0.0', { de: { 'a.key': 'A' }, ar: { 'a.key': 'ب' } });
        const emitted: { fileName: string; source: string }[] = [];
        const context = {
            emitFile: (file: { fileName: string; source: string }) => {
                emitted.push(file);
                return file.fileName;
            },
        };
        const load = plugin.load as unknown as (id: string) => string | null;

        (plugin.generateBundle as unknown as (this: typeof context) => void).call(context);

        expect([plugin.name, plugin.enforce]).toEqual(['hcm-i18n-catalogues', 'pre']);
        expect(load(`${I18N}/ro.ts`)).toBe('export const ro = undefined;\n');
        expect(load(`${I18N}/de.ts`)).toBeNull();
        expect(emitted.map((file) => file.fileName)).toEqual([`${CATALOGUE_FOLDER}/de.json`, `${CATALOGUE_FOLDER}/ar.json`]);
        expect(JSON.parse(String(emitted[1]?.source))).toEqual({ engine: '2.0.0', locale: 'ar', messages: { 'a.key': 'ب' } });
    });
});
