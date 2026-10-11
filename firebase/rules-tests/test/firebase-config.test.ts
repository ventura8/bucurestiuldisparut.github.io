/**
 * firebase.json and .firebaserc: the emulator layout every test tier relies on, and the admin's
 * Hosting security headers (docs/research/design-review-security-cost.md §1.8). No emulator needed.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface Header {
    readonly key: string;
    readonly value: string;
}

interface FirebaseJson {
    readonly firestore: { readonly rules: string; readonly indexes: string };
    readonly storage: { readonly rules: string };
    readonly functions: readonly { readonly source: string; readonly codebase: string; readonly runtime: string }[];
    readonly hosting: {
        readonly public: string;
        readonly headers: readonly { readonly source: string; readonly headers: readonly Header[] }[];
    };
    readonly emulators: Readonly<Record<string, unknown>>;
}

function repoFile(path: string): string {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

const config = JSON.parse(repoFile('firebase.json')) as FirebaseJson;

function header(key: string): string {
    const all = config.hosting.headers.flatMap((block) => (block.source === '**' ? block.headers : []));
    return all.find((entry) => entry.key === key)?.value ?? '';
}

function directive(name: string): string[] {
    const found = header('Content-Security-Policy')
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .find(([directiveName]) => directiveName === name);
    return found?.slice(1) ?? [];
}

describe('emulators', () => {
    it('happyPath_everyEmulatorListensOnLoopbackAtItsFixedPort', () => {
        expect(config.emulators).toMatchObject({
            singleProjectMode: true,
            auth: { host: '127.0.0.1', port: 9099 },
            firestore: { host: '127.0.0.1', port: 8080 },
            storage: { host: '127.0.0.1', port: 9199 },
            functions: { host: '127.0.0.1', port: 5001 },
            hosting: { host: '127.0.0.1', port: 5000 },
            ui: { enabled: false },
        });
    });

    it('badPath_testsCanOnlyTargetTheDemoProject', () => {
        expect(JSON.parse(repoFile('.firebaserc'))).toEqual({ projects: { e2e: 'demo-hcm' } });
    });
});

describe('deploy targets', () => {
    it('happyPath_rulesIndexesAndFunctionsPointAtTheirSources', () => {
        expect(config.firestore).toEqual({
            database: '(default)',
            rules: 'firebase/firestore.rules',
            indexes: 'firebase/firestore.indexes.json',
        });
        expect(config.storage.rules).toBe('firebase/storage.rules');
        expect(config.functions).toMatchObject([{ source: 'functions/dist', codebase: 'default', runtime: 'nodejs24' }]);
        expect(config.hosting.public).toBe('packages/admin/dist');
        expect(repoFile(config.firestore.rules)).toContain("rules_version = '2';");
    });
});

describe('admin security headers', () => {
    it('happyPath_policiesFromTheSecurityReviewAreSent', () => {
        expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
        expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(header('X-Content-Type-Options')).toBe('nosniff');
        expect(header('Content-Security-Policy-Report-Only')).toBe("require-trusted-types-for 'script'");
        expect(directive('frame-ancestors')).toEqual(["'none'"]);
        expect(directive('object-src')).toEqual(["'none'"]);
        expect(directive('base-uri')).toEqual(["'none'"]);
    });

    it.each(['script-src', 'style-src', 'default-src'])('badPath_%sNeverAllowsInlineOrEval', (name) => {
        const sources = directive(name);

        expect(sources).toContain("'self'");
        expect(sources.filter((source) => ["'unsafe-inline'", "'unsafe-eval'", '*', 'http:', 'https:'].includes(source))).toEqual([]);
    });

    it('badPath_mapboxGlLoadsOnlyFromItsVersionedCdnPath', () => {
        expect(directive('script-src').filter((source) => source.includes('mapbox'))).toEqual(['https://api.mapbox.com/mapbox-gl-js/']);
    });
});
