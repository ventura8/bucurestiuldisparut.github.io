import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cssLiteralsPlugin, minifyCss, minifyCssLiterals } from '../src/css-literals.js';
import { ROOT } from './support.js';

describe('minifyCss', () => {
    it('happyPath_indentationCommentsAndTheSpaceAroundPunctuationGoAndEveryLineStays', () => {
        const raw = '\n    :host {\n        display: block; /* the box */\n        font: 400 1rem/1.5 a, b;\n    }\n';

        expect(minifyCss(raw)).toBe('\n:host{\ndisplay:block;\nfont:400 1rem/1.5 a,b;\n}\n');
        expect(minifyCss(raw).split('\n')).toHaveLength(raw.split('\n').length);
    });

    it('happyPath_aSelectorsDescendantSpaceAndAValuesSpacesStay', () => {
        expect(minifyCss(':host  :focus-visible { margin: calc(100% - 8px)  0 }')).toBe(':host :focus-visible{margin:calc(100% - 8px) 0}');
        expect(minifyCss('@media (min-width: 600px) and (forced-colors: active) { a { color: red !important; } }')).toBe(
            '@media (min-width:600px) and (forced-colors:active){a{color:red !important;}}',
        );
    });

    it('badPath_stringsEscapesAndAQuoteInACommentAreKept', () => {
        expect(minifyCss('content: \'  two  spaces  \' ; --x: "a ; b";')).toBe('content:\'  two  spaces  \';--x:"a ; b";');
        expect(minifyCss(".sm\\: block { content: '\\201C' }")).toBe(".sm\\: block{content:'\\201C'}");
        expect(minifyCss("a { /* the container's ring */ color: red }")).toBe('a{color:red}');
        expect(minifyCss("a { content: 'not closed")).toBe("a{content:'not closed");
        expect(minifyCss('a { color: red } /* not closed')).toBe('a{color:red}');
        expect(minifyCss('a/b { x: y }')).toBe('a/b{x:y}');
    });

    it('badPath_whitespaceAtAnInterpolationStays', () => {
        expect(minifyCss('  .b { color: ', { start: false, end: false })).toBe(' .b{color:');
        expect(minifyCss(' ;\n', { start: false, end: true })).toBe(';\n');
        expect(minifyCss(' a ', { start: false, end: false })).toBe(' a ');
        expect(minifyCss(' a ', { start: true, end: true })).toBe('a');
    });
});

describe('minifyCssLiterals', () => {
    it('happyPath_everyCssTemplateWithItsInterpolations', () => {
        const code = [
            "import { css } from 'lit';",
            'const ring = css`',
            '    :focus-visible {',
            '        outline: 3px solid ${unsafeCSS(colour)};',
            '    }',
            '`;',
            'const plain = css`a { color: red }`;',
            'const other = html`<p>  two  spaces  </p>`;',
        ].join('\n');

        const out = minifyCssLiterals(code, 'ring.ts');

        expect(out).toBe(
            [
                "import { css } from 'lit';",
                'const ring = css`',
                ':focus-visible{',
                'outline:3px solid ${unsafeCSS(colour)};',
                '}',
                '`;',
                'const plain = css`a{color:red}`;',
                'const other = html`<p>  two  spaces  </p>`;',
            ].join('\n'),
        );
    });

    it('happyPath_aTemplateWithSeveralInterpolationsKeepsTheSpaceAtEach', () => {
        const code = 'const a = css`${host} .b { margin: ${x}  ${y}; }`;';

        expect(minifyCssLiterals(code, 'a.ts')).toBe('const a = css`${host} .b{margin:${x} ${y};}`;');
    });

    it('badPath_aModuleWithoutCssOrAlreadyMinifiedIsLeftAlone', () => {
        expect(minifyCssLiterals('const x = 1;', 'x.ts')).toBeNull();
        expect(minifyCssLiterals('const a = css`a{color:red}`;', 'a.ts')).toBeNull();
        expect(minifyCssLiterals('const a = mycss`a { color: red }`; // css` in a comment', 'a.ts')).toBeNull();
    });

    it('happyPath_aKitElementKeepsItsLinesAndParses', () => {
        const code = readFileSync(join(ROOT, 'packages/ui/src/components/dialog.ts'), 'utf8');

        const out = minifyCssLiterals(code, 'dialog.ts') ?? '';

        expect(out.split('\n')).toHaveLength(code.split('\n').length);
        expect(out.length).toBeLessThan(code.length);
        expect(out).toContain('.actions{\ndisplay:flex;');
        expect(out).not.toContain('4 px above the actions');
    });
});

describe('cssLiteralsPlugin', () => {
    it('happyPath_transformsTheRepositorysTypeScriptModulesOnly', () => {
        const plugin = cssLiteralsPlugin();
        const code = 'const a = css`a { color: red }`;';

        expect([plugin.name, plugin.enforce]).toEqual(['hcm-css-literals', 'pre']);
        expect(plugin.transform(code, '/repo/packages/ui/src/a.ts?v=1')).toEqual({ code: 'const a = css`a{color:red}`;', map: null });
        expect(plugin.transform(code, '/repo/node_modules/lit/a.ts')).toBeNull();
        expect(plugin.transform(code, '/repo/packages/ui/src/a.css')).toBeNull();
        expect(plugin.transform('const a = 1;', '/repo/packages/ui/src/a.ts')).toBeNull();
    });
});
