import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { e2eContentSecurityPolicy } from '../src/admin/csp.js';
import {
    CSP_HEADER,
    e2eHostingHeaders,
    globToRegExp,
    hostingHeaders,
    isIgnored,
    parseHostingConfig,
    rewriteOf,
    type HostingConfig,
} from '../src/admin/hosting.js';
import { SiteBuildError } from '../src/errors.js';
import { ROOT } from './support.js';

function committedHosting(): HostingConfig {
    return parseHostingConfig(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
}

const E2E_ORIGINS = ['http://127.0.0.1:8080', 'http://127.0.0.1:4311'];

describe('parseHostingConfig', () => {
    it('happyPath_readsTheCommittedHostingBlock', () => {
        const hosting = committedHosting();

        expect(hosting.public).toBe('packages/admin/dist');
        expect(hosting.cleanUrls).toBe(true);
        expect(hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }]);
    });

    it('happyPath_optionalPartsDefaultToNothing', () => {
        expect(parseHostingConfig('{"hosting": {"public": "dist"}}')).toEqual({
            public: 'dist',
            cleanUrls: false,
            ignore: [],
            rewrites: [],
            headers: [],
        });
    });

    it('badPath_notJsonOrWithoutAValidHostingBlockIsABuildError', () => {
        expect(() => parseHostingConfig('{', 'broken.json')).toThrow(/^broken\.json: not JSON: SyntaxError/);
        expect(() => parseHostingConfig('{"hosting": {"public": ""}}')).toThrow(/firebase\.json: invalid hosting block\nhosting\.public/);
        expect(() => parseHostingConfig('{}')).toThrow(SiteBuildError);
    });
});

describe('globToRegExp', () => {
    it.each([
        ['**', '/', true],
        ['**', '/a/b/c.js', true],
        ['**/*.@(html|js|mjs|css|json)', '/admin.iife.js', true],
        ['**/*.@(html|js|mjs|css|json)', '/legacy/bucharest/photos.json', true],
        ['**/*.@(html|js|mjs|css|json)', '/admin.iife.js.map', false],
        ['**/*.map', '/admin.mjs.map', true],
        ['**/.*', '/legacy/.hidden', true],
        ['**/.*', '/legacy/visible', false],
        ['/static/?.txt', '/static/a.txt', true],
        ['/static/?.txt', '/static/ab.txt', false],
        ['*.html', '/a/index.html', false],
        ['a+b.js', '/a+b.js', true],
    ])('happyPath_%s_matches_%s_%s', (glob, path, expected) => {
        expect(globToRegExp(glob).test(path.replace(/^\//, ''))).toBe(expected);
    });
});

describe('hostingHeaders', () => {
    it('happyPath_everyMatchingRuleAddsItsHeadersInFileOrder', () => {
        const hosting = committedHosting();

        expect(Object.keys(hostingHeaders(hosting, '/admin.iife.js'))).toEqual([
            'Content-Security-Policy',
            'Content-Security-Policy-Report-Only',
            'Cross-Origin-Opener-Policy',
            'Referrer-Policy',
            'X-Content-Type-Options',
            'Permissions-Policy',
            'Cache-Control',
        ]);
        expect(hostingHeaders(hosting, '/')['Cache-Control']).toBeUndefined();
        expect(hostingHeaders(hosting, '/')['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups');
    });

    it('happyPath_theLegacyImportBundleIsCachedForADayAndTheAppNever', () => {
        const hosting = committedHosting();

        expect(hostingHeaders(hosting, '/legacy/bucharest/originals/Ferdinand.png')['Cache-Control']).toBe('public, max-age=86400');
        expect(hostingHeaders(hosting, '/legacy/bucharest/photos.json')['Cache-Control']).toBe('public, max-age=86400');
        expect(hostingHeaders(hosting, '/project.json')['Cache-Control']).toBe('no-cache');
    });

    it('badPath_aLaterRuleOverridesTheSameHeader', () => {
        const hosting: HostingConfig = {
            public: 'dist',
            cleanUrls: false,
            ignore: [],
            rewrites: [],
            headers: [
                { source: '**', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
                { source: '**/*.js', headers: [{ key: 'Cache-Control', value: 'max-age=60' }] },
            ],
        };

        expect(hostingHeaders(hosting, '/a.js')).toEqual({ 'Cache-Control': 'max-age=60' });
        expect(hostingHeaders(hosting, '/a.css')).toEqual({ 'Cache-Control': 'no-cache' });
    });
});

describe('isIgnored and rewriteOf', () => {
    it('happyPath_sourceMapsAndDotFilesAreNeverDeployedAndEveryPathRewritesToTheApp', () => {
        const hosting = committedHosting();

        expect(isIgnored(hosting, '/admin.iife.js.map')).toBe(true);
        expect(isIgnored(hosting, '/.env')).toBe(true);
        expect(isIgnored(hosting, '/admin.iife.js')).toBe(false);
        expect(rewriteOf(hosting, '/photos/abc')).toBe('/index.html');
    });

    it('badPath_noRewriteWithoutAMatchingRule', () => {
        expect(rewriteOf({ ...committedHosting(), rewrites: [] }, '/x')).toBeUndefined();
    });
});

describe('e2eHostingHeaders', () => {
    it('happyPath_onlyTheCspDiffersFromHosting', () => {
        const hosting = committedHosting();
        const production = hostingHeaders(hosting, '/admin.iife.js');
        const e2e = e2eHostingHeaders(hosting, '/admin.iife.js', E2E_ORIGINS);

        expect({ ...e2e, [CSP_HEADER]: '' }).toEqual({ ...production, [CSP_HEADER]: '' });
        expect(e2e[CSP_HEADER]).toBe(e2eContentSecurityPolicy(String(production[CSP_HEADER]), E2E_ORIGINS));
        expect(e2e[CSP_HEADER]).not.toContain('upgrade-insecure-requests');
        expect(e2e[CSP_HEADER]).toContain('http://127.0.0.1:8080 http://127.0.0.1:4311; img-src');
    });

    it('badPath_aResponseWithoutACspStaysWithoutOne', () => {
        const hosting: HostingConfig = { ...committedHosting(), headers: [{ source: '**', headers: [{ key: 'X-A', value: 'b' }] }] };

        expect(e2eHostingHeaders(hosting, '/', E2E_ORIGINS)).toEqual({ 'X-A': 'b' });
    });
});
