/**
 * The install bundle's `tools/` folder (`docs/research/M6-interfaces.md` §1.3): a `package.json` that pins
 * `firebase-tools` and the `package-lock.json` of its tree, cut offline from the repository's own lockfile (no registry
 * call): every package Node would resolve from `node_modules/firebase-tools`, through its dependencies, optional
 * dependencies and required peers, at the same paths. `npm ci` in the build then installs exactly that tree, each
 * package checked against its integrity.
 */
import { FIREBASE_TOOLS_VERSION } from '@hcm/shared';

import { SiteBuildError } from '../errors.js';

interface LockPackage {
    readonly version?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly optionalDependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
    readonly dev?: boolean;
    readonly devOptional?: boolean;
    readonly optional?: boolean;
    readonly [key: string]: unknown;
}

export interface Lockfile {
    readonly lockfileVersion?: number;
    readonly packages: Readonly<Record<string, LockPackage>>;
}

const TOOL = 'firebase-tools';
const TOOLS_NAME = 'hcm-install-tools';

/** The package at `from` and every package it sits in, innermost first, then the root (''). */
function ancestors(from: string): string[] {
    const bases = [from];
    let base = from;
    while (base !== '') {
        const parent = base.lastIndexOf('/node_modules/');
        base = parent === -1 ? '' : base.slice(0, parent);
        bases.push(base);
    }
    return bases;
}

/** The path Node resolves `name` to from the package at `from` (its own `node_modules`, then each parent's), or null. */
export function resolvePackage(packages: Lockfile['packages'], from: string, name: string): string | null {
    const candidates = ancestors(from).map((base) => (base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`));
    return candidates.find((candidate) => packages[candidate] !== undefined) ?? null;
}

/** What a package needs installed: its dependencies, optional ones (each `optional`), its peers that are not optional. */
function needs(entry: LockPackage): readonly (readonly [string, boolean])[] {
    const optionalPeers = entry.peerDependenciesMeta ?? {};
    const peers = Object.keys(entry.peerDependencies ?? {}).filter((name) => optionalPeers[name]?.optional !== true);
    return [
        ...Object.keys(entry.dependencies ?? {}).map((name) => [name, false] as const),
        ...peers.map((name) => [name, false] as const),
        ...Object.keys(entry.optionalDependencies ?? {}).map((name) => [name, true] as const),
    ];
}

const DEV_FLAGS: ReadonlySet<string> = new Set(['dev', 'devOptional']);

/** An entry as the tools' lock keeps it: a runtime dependency (no `dev` flag; `devOptional` becomes `optional`). */
function runtimeEntry(entry: LockPackage): LockPackage {
    const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => !DEV_FLAGS.has(key)));
    return entry.devOptional === true ? { ...rest, optional: true } : rest;
}

function entryAt(lock: Lockfile, path: string): LockPackage {
    return lock.packages[path] ?? {};
}

/** Where `name` resolves from `path`; a required package the lockfile cannot resolve stops the build. */
function resolveNeed(lock: Lockfile, path: string, name: string, optional: boolean): string | null {
    const found = resolvePackage(lock.packages, path, name);
    if (found === null && !optional) {
        throw new SiteBuildError(`the lockfile cannot resolve ${name} for ${path}`);
    }
    return found;
}

/** Every lock path the tool needs, from `node_modules/firebase-tools`. */
function treeOf(lock: Lockfile, root: string): string[] {
    const seen = new Set<string>([root]);
    const queue = [root];
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        for (const [name, optional] of needs(entryAt(lock, path))) {
            const found = resolveNeed(lock, path, name, optional);
            if (found !== null && !seen.has(found)) {
                seen.add(found);
                queue.push(found);
            }
        }
    }
    return [...seen].sort((left, right) => (left < right ? -1 : 1));
}

/** `tools/package.json` and `tools/package-lock.json` for the pinned `firebase-tools`, from the repository's lockfile. */
export function toolsFolder(lock: Lockfile): { readonly packageJson: string; readonly packageLock: string } {
    const root = `node_modules/${TOOL}`;
    if (lock.packages[root]?.version !== FIREBASE_TOOLS_VERSION) {
        throw new SiteBuildError(`the lockfile does not hold ${TOOL} ${FIREBASE_TOOLS_VERSION}`);
    }
    const dependencies = { [TOOL]: FIREBASE_TOOLS_VERSION };
    const packages = Object.fromEntries(treeOf(lock, root).map((path) => [path, runtimeEntry(entryAt(lock, path))]));
    const packageJson = { name: TOOLS_NAME, version: '1.0.0', private: true, dependencies };
    const packageLock = {
        name: TOOLS_NAME,
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: TOOLS_NAME, version: '1.0.0', dependencies }, ...packages },
    };
    return { packageJson: `${JSON.stringify(packageJson, null, 4)}\n`, packageLock: `${JSON.stringify(packageLock, null, 4)}\n` };
}
