import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIREBASE_TOOLS_VERSION } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { SiteBuildError } from '../src/errors.js';
import { resolvePackage, toolsFolder, type Lockfile } from '../src/install/tools-lock.js';
import { ROOT } from './support.js';

/** The bundle's `tools/` (docs/research/M6-interfaces.md §1.3): firebase-tools' tree, cut offline from the repository's lockfile. */

const TOOL = 'node_modules/firebase-tools';

function lock(packages: Lockfile['packages']): Lockfile {
    return { lockfileVersion: 3, packages: { '': { name: 'root' }, [TOOL]: { version: FIREBASE_TOOLS_VERSION, dev: true }, ...packages } };
}

describe('resolvePackage', () => {
    it('happyPath_aPackagesOwnCopyWinsThenEachParentsThenTheRoot', () => {
        const packages = lock({
            'node_modules/a': {},
            'node_modules/b/node_modules/a': {},
            'node_modules/b/node_modules/c/node_modules/d': {},
        }).packages;

        expect(resolvePackage(packages, 'node_modules/b', 'a')).toBe('node_modules/b/node_modules/a');
        expect(resolvePackage(packages, 'node_modules/b/node_modules/c', 'a')).toBe('node_modules/b/node_modules/a');
        expect(resolvePackage(packages, 'node_modules/x', 'a')).toBe('node_modules/a');
        expect(resolvePackage(packages, '', 'missing')).toBeNull();
    });
});

describe('toolsFolder', () => {
    it('happyPath_theToolsTreeHoldsItsDependenciesOptionalOnesAndRequiredPeers', () => {
        const folder = toolsFolder(
            lock({
                [TOOL]: {
                    version: FIREBASE_TOOLS_VERSION,
                    dev: true,
                    dependencies: { dep: '1' },
                    optionalDependencies: { native: '1', gone: '1' },
                    peerDependencies: { peer: '1', loose: '1' },
                    peerDependenciesMeta: { loose: { optional: true } },
                },
                'node_modules/dep': { version: '1.0.0', dev: true, dependencies: { nested: '1' } },
                'node_modules/dep/node_modules/nested': { version: '2.0.0', devOptional: true },
                'node_modules/native': { version: '1.0.0', optional: true },
                'node_modules/peer': { version: '1.0.0' },
                'node_modules/loose': { version: '1.0.0' },
                'node_modules/unrelated': { version: '9.9.9' },
            }),
        );
        const packageLock = JSON.parse(folder.packageLock) as { packages: Record<string, Record<string, unknown>> };

        expect(Object.keys(packageLock.packages)).toEqual([
            '',
            'node_modules/dep',
            'node_modules/dep/node_modules/nested',
            TOOL,
            'node_modules/native',
            'node_modules/peer',
        ]);
        expect(packageLock.packages['node_modules/dep/node_modules/nested']).toEqual({ version: '2.0.0', optional: true });
        expect(Object.values(packageLock.packages).some((entry) => 'dev' in entry || 'devOptional' in entry)).toBe(false);
        expect(JSON.parse(folder.packageJson)).toEqual({
            name: 'hcm-install-tools',
            version: '1.0.0',
            private: true,
            dependencies: { 'firebase-tools': FIREBASE_TOOLS_VERSION },
        });
    });

    it('badPath_aRequiredPackageTheLockfileLacksStopsTheBuild', () => {
        expect(() => toolsFolder(lock({ [TOOL]: { version: FIREBASE_TOOLS_VERSION, dependencies: { missing: '1' } } }))).toThrow(
            SiteBuildError,
        );
    });

    it('badPath_anotherFirebaseToolsIsRefused', () => {
        expect(() => toolsFolder(lock({ [TOOL]: { version: '1.0.0' } }))).toThrow(`does not hold firebase-tools ${FIREBASE_TOOLS_VERSION}`);
    });

    it('happyPath_theRepositorysOwnLockfileHoldsTheWholeTree', () => {
        const repository = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as Lockfile;

        const packageLock = JSON.parse(toolsFolder(repository).packageLock) as { packages: Record<string, { version?: string }> };

        expect(packageLock.packages[TOOL]?.version).toBe(FIREBASE_TOOLS_VERSION);
        expect(Object.keys(packageLock.packages).length).toBeGreaterThan(100);
        expect(Object.keys(packageLock.packages).every((path) => path === '' || path.startsWith('node_modules/'))).toBe(true);
    });
});
