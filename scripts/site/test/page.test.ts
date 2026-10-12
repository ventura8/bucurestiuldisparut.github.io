import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy } from '../src/csp.js';
import { MAPBOX_GL_SCRIPT, MAPBOX_GL_STYLESHEET, MAPBOX_GL_VERSION, renderSitePage } from '../src/page.js';
import { parseSiteSpec } from '../src/site-spec.js';
import { subresourceIntegrity } from '../src/sri.js';
import { ROOT, htmlValidateMessages } from './support.js';

function bucharestPage(): string {
    return renderSitePage({
        spec: parseSiteSpec(readFileSync(join(ROOT, 'sites/bucharest/site.json'), 'utf8')),
        csp: contentSecurityPolicy({ connect: ['https://telemetry.example'], images: [] }),
        mapboxGlIntegrity: { script: 'sha384-script', stylesheet: 'sha384-style' },
    });
}

describe('renderSitePage', () => {
    it('happyPath_passesTheRepositoryHtmlValidateRules', async () => {
        expect(await htmlValidateMessages(bucharestPage())).toEqual([]);
    });

    it('happyPath_theCspComesBeforeEveryResource', () => {
        const html = bucharestPage();
        const csp = html.indexOf('http-equiv="Content-Security-Policy"');

        expect(csp).toBeGreaterThan(html.indexOf('<meta charset="utf-8">'));
        expect(csp).toBeLessThan(html.indexOf('<link'));
        expect(csp).toBeLessThan(html.indexOf('<script'));
        expect(html).toContain("connect-src 'self' https://api.mapbox.com");
        expect(html).toContain('https://telemetry.example;');
    });

    it('happyPath_loadsPinnedMapboxWithIntegrityThenConfigThenTheEngineModule', () => {
        const html = bucharestPage();
        const scripts = [...html.matchAll(/<script [^>]*>/g)].map(([tag]) => tag);

        expect(scripts).toEqual([
            `<script src="${MAPBOX_GL_SCRIPT}" defer integrity="sha384-script" crossorigin="anonymous">`,
            '<script src="config.js" defer>',
            '<script type="module" src="engine/engine.mjs">',
        ]);
        expect(html).toContain(`<link rel="stylesheet" href="${MAPBOX_GL_STYLESHEET}" integrity="sha384-style" crossorigin="anonymous">`);
        expect(html).toContain('<link rel="stylesheet" href="engine/engine.css">');
        expect(html).toContain('<meta name="referrer" content="strict-origin-when-cross-origin">');
    });

    it('happyPath_hasTheMountPointAndABilingualNoScriptNote', () => {
        const html = bucharestPage();

        expect(html).toContain('<html lang="ro">');
        expect(html).toContain('<title>București dispărut</title>');
        expect(html).toContain('<div id="historic-city-map"></div>');
        expect(html).toMatch(/<noscript>\n\s+<p lang="ro" class="site-noscript">Harta are nevoie de JavaScript\./);
        expect(html).toMatch(/<p lang="en" class="site-noscript">The map needs JavaScript\./);
    });

    it('badPath_noInlineScriptOrStyleCanAppear', () => {
        const html = bucharestPage();

        expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
        expect(html).not.toMatch(/<style|\sstyle=|\son[a-z]+=/);
    });

    it('happyPath_theMapboxVersionIsThePinnedPackage', () => {
        const pinned = JSON.parse(readFileSync(join(ROOT, 'node_modules/mapbox-gl/package.json'), 'utf8')) as { version: string };

        expect(MAPBOX_GL_VERSION).toBe(pinned.version);
        expect(MAPBOX_GL_SCRIPT).toBe(`https://api.mapbox.com/mapbox-gl-js/v${pinned.version}/mapbox-gl.js`);
    });
});

describe('subresourceIntegrity', () => {
    it('happyPath_isTheBase64Sha384', () => {
        expect(subresourceIntegrity(new TextEncoder().encode('abc'))).toBe(
            'sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn',
        );
    });
});
