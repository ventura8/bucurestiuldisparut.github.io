import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { cataloguePackPlugin, packCatalogues } from '../src/catalogue-pack.js';
import { ROOT } from './support.js';

/** A variable's object literal as `[key, text]` entries, read from a module's source (`as const` and `satisfies` skipped). */
function sourceEntries(code: string, name: string): [string, string][] {
    let entries: [string, string][] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.name.getText() === name) {
            let object = node.initializer;
            while (object !== undefined && (ts.isAsExpression(object) || ts.isSatisfiesExpression(object))) {
                object = object.expression;
            }
            entries = (object as ts.ObjectLiteralExpression).properties.map((property) => {
                const pair = property as ts.PropertyAssignment;
                return [(pair.name as ts.StringLiteral).text, (pair.initializer as ts.StringLiteral).text];
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile('a.ts', code, ts.ScriptTarget.Latest, true));
    return entries;
}

/**
 * A packed variable as `[key, text]` entries, as `Object.fromEntries(keys.split(' ').map((x, i) => [x, texts[i]]))` makes
 * them: the call's two arguments read from the packed module's source; none when the helper is not the plugin's.
 */
function packedEntries(code: string, name: string): [string, string][] {
    let entries: [string, string][] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.name.getText() === name && node.initializer !== undefined) {
            const call = node.initializer as ts.CallExpression;
            const [keys, texts] = call.arguments as unknown as [ts.StringLiteral, ts.ArrayLiteralExpression];
            const ours = call.expression.getText() === UNPACK;
            entries = ours ? keys.text.split(' ').map((key, at) => [key, (texts.elements[at] as ts.StringLiteral).text]) : [];
        }
        ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile('a.ts', code, ts.ScriptTarget.Latest, true));
    return entries;
}

const UNPACK = '((k, v) => Object.fromEntries(k.split(" ").map((x, i) => [x, v[i]])))';

describe('packCatalogues', () => {
    it('happyPath_aCatalogueBecomesItsKeysStringAndItsTextsArrayOnItsFirstLine', () => {
        const code = "export const ro = {\n    'a.b': 'A',\n    'c.d': \"C's\",\n} as const;\nexport type K = keyof typeof ro;\n";

        expect(packCatalogues(code, 'ro.ts')).toBe(
            `export const ro = ${UNPACK}("a.b c.d", ['A', "C's"])\n\n\n;\nexport type K = keyof typeof ro;\n`,
        );
    });

    it('happyPath_thePackedModuleBuildsTheSameEntriesInOrder', () => {
        const code = "export const en = {\n    'z.last': 'Z {name}',\n    'a.first': 'A\\n2',\n} satisfies Record<string, string>;\n";

        expect(packedEntries(packCatalogues(code, 'en.ts') ?? '', 'en')).toEqual([
            ['z.last', 'Z {name}'],
            ['a.first', 'A\n2'],
        ]);
    });

    it.each(['ro', 'en'])('happyPath_theViewersOwnCatalogue_%s_hasTheSameEntriesPackedAndKeepsItsLines', (locale) => {
        const path = join(ROOT, `packages/shared/src/i18n/${locale}.ts`);
        const code = readFileSync(path, 'utf8');

        const out = packCatalogues(code, path) ?? '';

        expect(out.split('\n')).toHaveLength(code.split('\n').length);
        expect(sourceEntries(code, locale).length).toBeGreaterThan(100);
        expect(packedEntries(out, locale)).toEqual(sourceEntries(code, locale));
    });

    it('badPath_anObjectWithAnythingButQuotedKeysAndPlainTextsIsLeftAsWritten', () => {
        const objects = [
            "{ 'a': 'A', ...rest }",
            "{ 'a': 'A', b: 'B' }",
            "{ 'a b': 'A' }",
            "{ 'a': `A` }",
            "{ 'a': 'A', ['b']: 'B' }",
            "{ 'a': 'A', b() { return 'B'; } }",
            '{}',
        ];

        for (const object of objects) {
            expect(packCatalogues(`const c = ${object};`, 'c.ts')).toBeNull();
        }
        expect(packCatalogues('const c = 1;\nlet d;', 'c.ts')).toBeNull();
    });
});

describe('cataloguePackPlugin', () => {
    it('happyPath_transformsTheIncludedTypeScriptModulesOnly', () => {
        const plugin = cataloguePackPlugin(/\/i18n\//);
        const code = "const c = { 'a': 'A' };";

        expect([plugin.name, plugin.enforce]).toEqual(['hcm-catalogue-pack', 'pre']);
        expect(plugin.transform(code, '/repo/packages/shared/src/i18n/ro.ts?v=1')).toEqual({
            code: `const c = ${UNPACK}("a", ['A']);`,
            map: null,
        });
        expect(plugin.transform(code, '/repo/packages/shared/src/other/ro.ts')).toBeNull();
        expect(plugin.transform(code, '/repo/node_modules/x/i18n/ro.ts')).toBeNull();
        expect(plugin.transform(code, '/repo/packages/shared/src/i18n/ro.js')).toBeNull();
        expect(plugin.transform('const c = 1;', '/repo/packages/shared/src/i18n/ro.ts')).toBeNull();
    });
});
