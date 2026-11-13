import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { everyStringBut, splitAdminSite } from '../src/hosting/admin-site.js';

/**
 * The admin on its own Hosting site (DECISIONS-for-review.md §210): one built tree becomes the public map's site and the
 * admin's, in a real folder. The repository's own `firebase.json` is the input, so every rule it gains is split too.
 */
const SITE = 'demo-hcm-admin';
const ORIGIN = 'https://demo-hcm-admin.web.app';

let dir: string;

type Entry = Record<string, unknown> & { readonly redirects: Record<string, unknown>[]; readonly headers: { source?: string }[] };

function repositoryHosting(): Record<string, unknown> {
    const config = JSON.parse(readFileSync('firebase.json', 'utf8')) as { hosting: Record<string, unknown> };
    return { ...config.hosting, site: 'demo-hcm', public: 'public' };
}

function tree(): string {
    mkdirSync(join(dir, 'public/admin/install/r'), { recursive: true });
    writeFileSync(join(dir, 'public/index.html'), 'the map');
    writeFileSync(join(dir, 'public/release.json'), '{"release":"1.0.0+abc1234","variant":"public"}');
    writeFileSync(join(dir, 'public/admin/index.html'), 'the admin');
    writeFileSync(join(dir, 'public/admin/runtime.json'), '{"release":"1.0.0+abc1234"}');
    writeFileSync(join(dir, 'public/admin/install/r/manifest.json'), '{}');
    writeFileSync(join(dir, 'public/admin/starter.json'), '{"version":"v"}');
    const config = join(dir, 'firebase.json');
    writeFileSync(config, JSON.stringify({ hosting: repositoryHosting() }));
    return config;
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hcm-admin-site-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/** Hosting's RE2 pattern as a JavaScript one (named groups are `(?<name>)` there). */
function forwardRule(config: string): RegExp {
    const [map] = (JSON.parse(readFileSync(config, 'utf8')) as { hosting: Entry[] }).hosting;
    return new RegExp(String(map?.redirects[1]?.['regex']).replace('(?P<', '(?<'));
}

describe("the forward of the admin's old addresses", () => {
    it('happyPath_everyAdminAddressButTheStarterListGoesWithItsPath_badPath_theStarterListStays', () => {
        const config = tree();
        splitAdminSite({ config, siteId: SITE });
        const rule = forwardRule(config);

        const paths = [
            '/admin/',
            '/admin/index.html',
            '/admin/install/r/manifest.json',
            '/admin/s',
            '/admin/starter.jso',
            '/admin/starter.json.bak',
            '/admin/starters.json',
        ];
        expect(paths.map((path) => rule.exec(path)?.groups?.['rest'])).toEqual(paths.map((path) => path.slice('/admin/'.length)));
        expect(rule.test('/admin/starter.json')).toBe(false);
        expect(rule.test('/bucharest/')).toBe(false);
    });

    it('happyPath_thePatternLeavesOutExactlyTheNameGiven', () => {
        const only = new RegExp(`^(?:${everyStringBut('a.b')})$`);

        expect(['', 'a', 'a.', 'axb', 'a.bb', 'b'].every((text) => only.test(text))).toBe(true);
        expect(only.test('a.b')).toBe(false);
    });
});

describe('splitAdminSite', () => {
    it('happyPath_theAdminMovesToItsOwnSiteAndThePublicMapsAdminAddressesForwardThere', () => {
        const config = tree();

        expect(splitAdminSite({ config, siteId: SITE })).toEqual({ split: true, adminPublic: 'public-admin', adminOrigin: ORIGIN });

        const [map, admin] = (JSON.parse(readFileSync(config, 'utf8')) as { hosting: Entry[] }).hosting;
        expect(map).toMatchObject({ site: 'demo-hcm', public: 'public' });
        // The route travels in the address's hash, which a browser keeps across the redirect.
        expect(map?.redirects[0]).toEqual({ source: '/admin', destination: `${ORIGIN}/admin/`, type: 301 });
        expect(map?.redirects[1]).toMatchObject({ destination: `${ORIGIN}/admin/:rest`, type: 301 });
        expect(JSON.stringify(map?.['rewrites'])).not.toContain('/admin');
        expect(map?.headers.some((rule) => rule.source?.startsWith('/admin') === true)).toBe(false);
        expect(admin).toMatchObject({
            site: SITE,
            public: 'public-admin',
            rewrites: [{ source: '/admin/**', destination: '/admin/index.html' }],
        });
        expect(admin?.redirects[0]).toEqual({ regex: '^/(?:index\\.html)?$', destination: '/admin/', type: 301 });
        expect(JSON.stringify(admin?.headers)).toContain('Content-Security-Policy');
        expect(admin?.['predeploy']).toBeUndefined();

        // A Linux starter from before §210 reads its list here with curl and no -L: the one file the public map keeps.
        expect(readFileSync(join(dir, 'public/admin/starter.json'), 'utf8')).toBe('{"version":"v"}');
        expect(existsSync(join(dir, 'public/admin/index.html'))).toBe(false);
        expect(readFileSync(join(dir, 'public-admin/admin/install/r/manifest.json'), 'utf8')).toBe('{}');
        expect(JSON.parse(readFileSync(join(dir, 'public-admin/admin/runtime.json'), 'utf8'))).toEqual({
            release: '1.0.0+abc1234',
            adminOrigin: ORIGIN,
        });
        // Setup's release check reads the site's release on the admin's own origin.
        expect(readFileSync(join(dir, 'public-admin/release.json'), 'utf8')).toContain('1.0.0+abc1234');
    });

    it('badPath_aTreeSplitBeforeIsLeftAlone', () => {
        const config = tree();
        splitAdminSite({ config, siteId: SITE });
        const before = readFileSync(config, 'utf8');

        expect(splitAdminSite({ config, siteId: SITE })).toEqual({ split: false, adminPublic: 'public-admin', adminOrigin: ORIGIN });
        expect(readFileSync(config, 'utf8')).toBe(before);
    });

    it('badPath_aTreeWithoutTheAdminOrAHostingEntryIsRefused', () => {
        const config = tree();
        rmSync(join(dir, 'public/admin'), { recursive: true });

        expect(() => splitAdminSite({ config, siteId: SITE })).toThrow('needs the admin');

        writeFileSync(config, JSON.stringify({ functions: [] }));
        expect(() => splitAdminSite({ config, siteId: SITE })).toThrow('no hosting entry');
    });

    it('happyPath_aTreeWithoutARuntimeOrReleaseFileStillSplits', () => {
        const config = tree();
        rmSync(join(dir, 'public/admin/runtime.json'));
        rmSync(join(dir, 'public/release.json'));
        rmSync(join(dir, 'public/admin/starter.json'));

        expect(splitAdminSite({ config, siteId: SITE }).split).toBe(true);
        expect(existsSync(join(dir, 'public/admin'))).toBe(false);
        expect([existsSync(join(dir, 'public-admin/admin/runtime.json')), existsSync(join(dir, 'public-admin/release.json'))]).toEqual([
            false,
            false,
        ]);
    });
});
