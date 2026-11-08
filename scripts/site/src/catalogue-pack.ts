import ts from 'typescript';

/**
 * Packs a message catalogue's object literal for the engine's Vite build (`DECISIONS-for-review.md` §127a). A catalogue
 * (`packages/shared/src/i18n/ro.ts`, `en.ts`, …) is one object literal of `'family.key': 'text'` pairs; the bundler's
 * minifier keeps it as written, so every key is spelt once per language. Packed, the module builds the same object from
 * one string of its keys and an array of its texts:
 *
 *     export const ro = ((k, v) => Object.fromEntries(k.split(' ').map((x, i) => [x, v[i]])))('a.b c.d', ['A', 'C']);
 *
 * which has the same keys, in the same order, with the same texts (`Object.fromEntries` over the keys in source order),
 * and saves about 270 bytes gzip of the engine's IIFE: the second language's key string is one long repeat of the first.
 *
 * Only an object literal whose every property is a quoted key without whitespace and a plain string text is packed (an
 * `as const` or `satisfies` around it goes, as it has no runtime meaning); anything else (a spread, a method, a computed
 * key, a template text) leaves the whole object as written. Every line of the module stays where it was: the line breaks
 * the catalogue lost follow the packed call, before its `;`, so the source map needs no change.
 */

/** A key that the packed string can hold: no whitespace (the separator), not empty. */
const PACKABLE_KEY = /^\S+$/;

/** The helper the packed call starts with: the object from the keys' string and the texts' array. */
const UNPACK = '((k, v) => Object.fromEntries(k.split(" ").map((x, i) => [x, v[i]])))';

/** One catalogue in the module: where its expression is, and what replaces it. */
interface Catalogue {
    readonly from: number;
    readonly to: number;
    readonly text: string;
}

/** The object literal under an `as const` or `satisfies` (or the expression itself). */
function objectOf(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
    let inner = expression;
    while (ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) {
        inner = inner.expression;
    }
    return ts.isObjectLiteralExpression(inner) ? inner : undefined;
}

/** A `'key': 'text'` property's key and the text's source spelling, or undefined when it is anything else. */
function pairOf(property: ts.ObjectLiteralElementLike, source: ts.SourceFile): readonly [string, string] | undefined {
    const plain = ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) && ts.isStringLiteral(property.initializer);
    return plain && PACKABLE_KEY.test(property.name.text) ? [property.name.text, property.initializer.getText(source)] : undefined;
}

/** The packed call of an object literal, or undefined when one of its properties cannot be packed (or it has none). */
function packed(object: ts.ObjectLiteralExpression, source: ts.SourceFile): string | undefined {
    const pairs: (readonly [string, string])[] = [];
    for (const property of object.properties) {
        const pair = pairOf(property, source);
        if (pair === undefined) {
            return undefined;
        }
        pairs.push(pair);
    }
    const keys = JSON.stringify(pairs.map(([key]) => key).join(' '));
    return pairs.length === 0 ? undefined : `${UNPACK}(${keys}, [${pairs.map(([, text]) => text).join(', ')}])`;
}

/** The catalogue a node declares (a variable whose initializer is a packable object literal), or undefined. */
function catalogueAt(node: ts.Node, source: ts.SourceFile): Catalogue | undefined {
    if (!ts.isVariableDeclaration(node) || node.initializer === undefined) {
        return undefined;
    }
    const object = objectOf(node.initializer);
    const text = object === undefined ? undefined : packed(object, source);
    return text === undefined ? undefined : { from: node.initializer.getStart(source), to: node.initializer.end, text };
}

/** Every packable catalogue in the module, the last in the module first. */
function catalogues(source: ts.SourceFile): Catalogue[] {
    const found: Catalogue[] = [];
    const visit = (node: ts.Node): void => {
        const catalogue = catalogueAt(node, source);
        if (catalogue !== undefined) {
            found.push(catalogue);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found.toSorted((a, b) => b.from - a.from);
}

/** `code` with one catalogue packed and the line breaks it lost after it. */
function withCatalogue(code: string, catalogue: Catalogue): string {
    const lost = code.slice(catalogue.from, catalogue.to).split('\n').length - 1;
    return code.slice(0, catalogue.from) + catalogue.text + '\n'.repeat(lost) + code.slice(catalogue.to);
}

/** The module with its catalogues packed, or null when it has none. */
export function packCatalogues(code: string, fileName: string): string | null {
    const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out = catalogues(source).reduce(withCatalogue, code);
    return out === code ? null : out;
}

/** Whether `file` is a TypeScript module under `include`, outside `node_modules`. */
function isCatalogueModule(file: string, include: RegExp): boolean {
    return file.endsWith('.ts') && !file.includes('/node_modules/') && include.test(file);
}

/** The Vite plugin: the catalogue modules (`.ts` under `include`, outside `node_modules`), before the TypeScript transform. */
export function cataloguePackPlugin(include: RegExp): {
    readonly name: string;
    readonly enforce: 'pre';
    transform(code: string, id: string): { readonly code: string; readonly map: null } | null;
} {
    return {
        name: 'hcm-catalogue-pack',
        enforce: 'pre',
        transform(code, id) {
            const file = id.split('?')[0] ?? id;
            const out = isCatalogueModule(file, include) ? packCatalogues(code, file) : null;
            return out === null ? null : { code: out, map: null };
        },
    };
}
