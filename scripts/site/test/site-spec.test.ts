import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { issuesText } from '../src/errors.js';
import { parseSiteSpec } from '../src/site-spec.js';
import { ROOT } from './support.js';

const VALID = {
    lang: 'ro',
    title: 'Orașul meu',
    description: 'O hartă istorică.',
    themeColor: '#8B5E3C',
    noscript: { ro: 'Harta are nevoie de JavaScript.', en: 'The map needs JavaScript.' },
    manifest: 'starter-kit/data/manifest.json',
    media: 'seed/bucharest/derived',
};

describe('parseSiteSpec', () => {
    it('happyPath_theCommittedSitesAreValid', () => {
        for (const site of ['sites/bucharest', 'starter-kit']) {
            const spec = parseSiteSpec(readFileSync(join(ROOT, site, 'site.json'), 'utf8'));

            expect(spec.lang).toBe('ro');
            expect(spec.noscript.en).toMatch(/JavaScript/);
        }
    });

    it('happyPath_aMinimalSpec', () => {
        expect(parseSiteSpec(JSON.stringify(VALID))).toEqual(VALID);
    });

    it('badPath_notJson', () => {
        expect(() => parseSiteSpec('{', 'sites/x/site.json')).toThrow(/^sites\/x\/site\.json: not JSON/);
    });

    it.each([
        ['an absolute path', { manifest: '/etc/passwd' }, 'manifest'],
        ['a parent folder', { media: 'seed/../../outside' }, 'media'],
        ['a leading parent folder', { media: '../outside' }, 'media'],
        ['an unknown language', { lang: 'fr' }, 'lang'],
        ['a colour that is not #rrggbb', { themeColor: 'red' }, 'themeColor'],
        ['an empty title', { title: '  ' }, 'title'],
        ['an unknown key', { script: 'alert(1)' }, 'script'],
    ])('badPath_refuses %s', (_name, change, path) => {
        expect(() => parseSiteSpec(JSON.stringify({ ...VALID, ...change }))).toThrow(new RegExp(`\\n${path}: `));
    });
});

describe('issuesText', () => {
    it('happyPath_rootIssuesAndOverflowAreSpelledOut', () => {
        const issues = Array.from({ length: 3 }, () => ({ path: '', code: 'validation.type' as const }));

        expect(issuesText(issues, 2)).toBe(
            '(root): The value has the wrong type. (validation.type)\n(root): The value has the wrong type. (validation.type)\n... and 1 more',
        );
    });
});
