import ts from 'typescript';

/**
 * Minifies the CSS of Lit's `css` tagged templates in a module's source before the bundler sees it (the admin's Vite
 * build, `packages/admin/vite.config.ts`; `DECISIONS-for-review.md` §36). The bundler's own minifier shortens the
 * JavaScript of the IIFE (Vite's library mode minifies that format), but leaves a template literal's text as written:
 * the stylesheets' indentation and comments were about 77 KB of the admin bundle (2026-10-18).
 *
 * Outside quoted strings, comments go, runs of spaces and tabs become one space, the indentation after a line break
 * goes, and the whitespace around `{`, `}`, `;` and `,` and after `:` goes; a quoted string and an escaped character are
 * kept as they are. Every line break is kept, so every line of the module stays where it was and the source map needs
 * no change (the transform returns no map: the mappings of the lines hold). A whitespace at a template's interpolation
 * (`${...}`) stays, as the value there is not known.
 */

/** Characters around which whitespace has no meaning in a stylesheet. */
const TIGHT = new Set(['{', '}', ';', ',']);

/** Whitespace and comments, from where the expression is set to look (`lastIndex`). */
const BLANK = /(?:\s|\/\*[\s\S]*?(?:\*\/|$))+/y;

/** Whether the template's start or end is the literal part's own (not an interpolation's). */
interface Edge {
    readonly start: boolean;
    readonly end: boolean;
}

/** One piece of a stylesheet's text: kept as it is (a string, an escape, a character), or blank (whitespace, comments). */
interface Piece {
    readonly blank: boolean;
    readonly text: string;
    /** An escaped character (`\\:`): the whitespace after it is not after a colon of the stylesheet. */
    readonly escape: boolean;
}

/** Whether whitespace next to these characters has no meaning: around a brace, a semicolon, a comma, after a colon. */
function isTight(before: string, after: string): boolean {
    return TIGHT.has(before) || TIGHT.has(after) || before === ':';
}

/** Whether whitespace between `before` and `after` can go (`before` or `after` is '' at the part's edge). */
function droppable(before: string, after: string, edge: Edge): boolean {
    if (isTight(before, after)) {
        return true;
    }
    return before === '' ? edge.start : after === '' && edge.end;
}

function isQuote(char: string): boolean {
    return char === '"' || char === "'";
}

/** The quoted string that starts at `from` (its closing quote included; to the end when it is not closed). */
function stringAt(raw: string, from: number): string {
    const quote = raw.charAt(from);
    let end = from + 1;
    while (end < raw.length && raw.charAt(end) !== quote) {
        end += raw.charAt(end) === '\\' ? 2 : 1;
    }
    return raw.slice(from, end + 1);
}

/** The whitespace and comments that start at `from` ('' when none does). */
function blankAt(raw: string, from: number): string {
    BLANK.lastIndex = from;
    return BLANK.exec(raw)?.[0] ?? '';
}

/** The piece of `raw` at `at`. */
function pieceAt(raw: string, at: number): Piece {
    const char = raw.charAt(at);
    if (isQuote(char)) {
        return { blank: false, text: stringAt(raw, at), escape: false };
    }
    if (char === '\\') {
        return { blank: false, text: raw.slice(at, at + 2), escape: true };
    }
    const blank = blankAt(raw, at);
    return { blank: blank !== '', text: blank === '' ? char : blank, escape: false };
}

/** What a blank piece becomes: its line breaks, else one space where whitespace means something, else nothing. */
function blankText(blank: string, before: string, after: string, edge: Edge): string {
    const breaks = blank.split('\n').length - 1;
    if (breaks > 0) {
        return '\n'.repeat(breaks);
    }
    return droppable(before, after, edge) ? '' : ' ';
}

/**
 * One literal part of a `css` template, as its source spells it (`rawText`), minified (see the module's comment);
 * `edge` says whether its start and its end are the template's own (not an interpolation's).
 */
export function minifyCss(raw: string, edge: Edge = { start: true, end: true }): string {
    return minified(raw, edge);
}

/** `minifyCss` without its default. */
function minified(raw: string, edge: Edge): string {
    let out = '';
    // What a blank sees before it: the last character written, or a backslash after an escape (`\\:` is no colon).
    let last = '';
    for (let at = 0; at < raw.length;) {
        const piece = pieceAt(raw, at);
        out += piece.blank ? blankText(piece.text, last, raw.charAt(at + piece.text.length), edge) : piece.text;
        last = piece.escape ? '\\' : (out.at(-1) ?? '');
        at += piece.text.length;
    }
    return out;
}

/** A literal part of a template in the module: where its text is and whether its ends are the template's. */
interface LiteralPart {
    readonly from: number;
    readonly to: number;
    readonly edge: Edge;
}

/** The literal parts of a `css` template (one without interpolations, or the head, middles and tail of one with). */
function partsOf(template: ts.TemplateLiteral, source: ts.SourceFile): LiteralPart[] {
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
        return [{ from: template.getStart(source) + 1, to: template.end - 1, edge: { start: true, end: true } }];
    }
    const head = { from: template.head.getStart(source) + 1, to: template.head.end - 2, edge: { start: true, end: false } };
    const spans = template.templateSpans.map((span) => {
        const tail = ts.isTemplateTail(span.literal);
        return { from: span.literal.getStart(source) + 1, to: span.literal.end - (tail ? 1 : 2), edge: { start: false, end: tail } };
    });
    return [head, ...spans];
}

/** Every literal part of every `css` tagged template in the module. */
function cssParts(source: ts.SourceFile): LiteralPart[] {
    const parts: LiteralPart[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'css') {
            parts.push(...partsOf(node.template, source));
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return parts;
}

/** The module with the CSS of its `css` templates minified, or null when it has none (or none changes). */
export function minifyCssLiterals(code: string, fileName: string): string | null {
    if (!code.includes('css`')) {
        return null;
    }
    const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let out = code;
    for (const part of cssParts(source).reverse()) {
        out = out.slice(0, part.from) + minifyCss(out.slice(part.from, part.to), part.edge) + out.slice(part.to);
    }
    return out === code ? null : out;
}

/** The Vite plugin: TypeScript modules outside `node_modules`, before the TypeScript transform. */
export function cssLiteralsPlugin(): {
    readonly name: string;
    readonly enforce: 'pre';
    transform(code: string, id: string): { readonly code: string; readonly map: null } | null;
} {
    return {
        name: 'hcm-css-literals',
        enforce: 'pre',
        transform(code, id) {
            const file = id.split('?')[0] ?? id;
            if (!file.endsWith('.ts') || file.includes('/node_modules/')) {
                return null;
            }
            const minified = minifyCssLiterals(code, file);
            return minified === null ? null : { code: minified, map: null };
        },
    };
}
