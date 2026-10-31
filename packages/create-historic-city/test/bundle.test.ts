/** The self-host bundle `npm run build:self-host` assembles (src/self-host/bundle.ts; docs/research/M5-interfaces.md §4.4). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildSelfHostBundle, DEFAULT_LAYOUT, E2E_BUILD_MARKER, selfHostFirebaseConfig } from '../src/self-host/bundle.js';
import { cleanUp, list, read, REPOSITORY, temporaryFolder } from './support.js';

const folders: string[] = [];

afterEach(() => {
    cleanUp(...folders.splice(0));
});

function put(root: string, files: Readonly<Record<string, string>>): void {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
    }
}

/** A repository with built admin and functions, the rules, firebase.json and the project file. */
function repository(): string {
    const root = temporaryFolder();
    folders.push(root);
    put(root, {
        'packages/admin/dist/index.html': '<!doctype html>\n',
        'packages/admin/dist/admin.mjs': 'export {};\n',
        'packages/admin/dist/admin.mjs.map': '{}\n',
        'packages/admin/dist/legacy/bucharest/import.json': '{}\n',
        'packages/admin/dist/project.json': '{}\n',
        'packages/admin/dist/runtime.json': '{ "release": "1.0.0+abc1234" }\n',
        'functions/dist/index.js': 'export {};\n',
        'functions/dist/package.json': '{}\n',
        'functions/dist/package-lock.json': '{}\n',
        'functions/dist/.env.bucurestiul-disparut': 'HCM_VIEWER_ORIGINS=https://ventura8.github.io\n',
        'functions/dist/export-kit/kit.json': '{}\n',
        'firebase/firestore.rules': 'rules\n',
        'firebase/firestore.indexes.json': '{}\n',
        'firebase/storage.rules': 'rules\n',
        'infra/project.json': '{ "projectId": "bucurestiul-disparut" }\n',
        'firebase.json': read(join(REPOSITORY, 'firebase.json')),
    });
    return root;
}

describe('buildSelfHostBundle', () => {
    it('badPath_theAdminsE2eBuildIsNeverBundled', () => {
        // docs/LESSONS.md 247: `vite build --mode e2e` writes the same packages/admin/dist, with the OAuth stand-in.
        const root = repository();
        put(root, { 'packages/admin/dist/admin-core-Ab3_x9Yz.js': `const page = '${E2E_BUILD_MARKER}';\n` });

        expect(() => buildSelfHostBundle({ root, ...DEFAULT_LAYOUT })).toThrow(/admin-core-Ab3_x9Yz\.js is the admin's e2e build/);
        expect(list(root)).not.toContain('packages/create-historic-city/dist/self-host');
    });

    it('happyPath_theAdminTheFunctionsAndTheRulesForAnyProject', () => {
        const root = repository();

        expect(buildSelfHostBundle({ root, ...DEFAULT_LAYOUT })).toEqual({ admin: 2, functions: 4 });

        const out = join(root, DEFAULT_LAYOUT.out);
        expect(list(out)).toEqual([
            'bundle.json',
            'firebase.template.json',
            'functions',
            'functions/export-kit',
            'functions/export-kit/kit.json',
            'functions/index.js',
            'functions/package-lock.json',
            'functions/package.json',
            'hosting',
            'hosting/admin',
            'hosting/admin/admin.mjs',
            'hosting/admin/index.html',
            'rules',
            'rules/firestore.indexes.json',
            'rules/firestore.rules',
            'rules/storage.rules',
        ]);
        expect(JSON.parse(read(join(out, 'bundle.json')))).toEqual({ release: '1.0.0+abc1234' });
        const template = read(join(out, 'firebase.template.json'));
        expect(template).not.toContain('bucurestiul-disparut');
        expect(template).not.toContain('predeploy');
        expect(template).not.toContain('emulators');
        const config = JSON.parse(template) as {
            hosting: { site: string; public: string; redirects: unknown[]; headers: { headers: { key: string; value: string }[] }[] };
            functions: { source: string }[];
            firestore: { rules: string; indexes: string; location: string };
            storage: { rules: string };
        };
        expect(config.hosting.site).toBe('__PROJECT_ID__');
        expect(config.hosting.public).toBe('hosting');
        expect(config.hosting.redirects.at(-1)).toEqual({ source: '/', destination: '/admin/', type: 302 });
        const policy = config.hosting.headers.flatMap((rule) => rule.headers).find((header) => header.key === 'Content-Security-Policy');
        expect(policy?.value).toContain('https://__PROJECT_ID__.web.app');
        expect(config.functions[0]?.source).toBe('functions');
        expect(config.firestore).toMatchObject({
            rules: 'rules/firestore.rules',
            indexes: 'rules/firestore.indexes.json',
            location: 'nam5',
        });
        expect(config.storage).toEqual({ rules: 'rules/storage.rules' });
    });

    it('badPath_aMissingBuildStopsWithWhatToBuild', () => {
        const root = repository();
        cleanUp(join(root, 'functions/dist'));

        expect(() => buildSelfHostBundle({ root, ...DEFAULT_LAYOUT })).toThrow(/functions\/dist is missing: build it first/);

        cleanUp(join(root, 'packages/admin/dist'));
        expect(() => buildSelfHostBundle({ root, ...DEFAULT_LAYOUT })).toThrow(/packages\/admin\/dist is missing: build it first/);
    });
});

describe('selfHostFirebaseConfig', () => {
    it('happyPath_aSingleObjectFunctionsEntryToo', () => {
        const config = JSON.parse(
            selfHostFirebaseConfig(
                { functions: { source: 'functions/dist', predeploy: ['x'] }, hosting: [{ site: 'p-12345' }], firestore: {} },
                'p-12345',
            ),
        ) as { functions: unknown[]; hosting: unknown };

        expect(config.functions).toEqual([{ source: 'functions' }]);
        expect(config.hosting).toEqual({
            site: '__PROJECT_ID__',
            public: 'hosting',
            redirects: [{ source: '/', destination: '/admin/', type: 302 }],
        });
    });
});
