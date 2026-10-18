import { afterEach, describe, expect, it } from 'vitest';

import {
    adminRelease,
    buildCommit,
    headCommit,
    planRuntimeFile,
    RUNTIME_FILE,
    START_UP_VARIABLE,
    startUpDeploy,
} from '../src/admin/runtime.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { cleanup, temporaryDir } from './support.js';

afterEach(cleanup);

const COMMIT = '5d02329'.padEnd(40, 'a');
const OTHER = 'f'.repeat(40);

/** A checkout in a temporary folder: a root `package.json` of `version` and the `.git` files given. */
function checkout(git: Readonly<Record<string, string>>, version: unknown = '1.2.3'): SiteFileSystem {
    const files = nodeFileSystem(temporaryDir());
    files.write('package.json', JSON.stringify({ name: 'historic-city-map', version }));
    for (const [path, content] of Object.entries(git)) {
        files.write(`.git/${path}`, content);
    }
    return files;
}

describe('headCommit', () => {
    it.each([
        ['a branch with its own file', { HEAD: 'ref: refs/heads/feat/x\n', 'refs/heads/feat/x': `${COMMIT}\n` }],
        [
            'a packed branch',
            { HEAD: 'ref: refs/heads/main\n', 'packed-refs': `# pack-refs\n${OTHER} refs/heads/other\n${COMMIT} refs/heads/main\n` },
        ],
        ['a detached head (CI checkout)', { HEAD: `${COMMIT}\n` }],
    ])('happyPath_readsTheCommitOf %s', (_name, git) => {
        expect(headCommit(checkout(git))).toBe(COMMIT);
    });

    it.each([
        ['no checkout', {}],
        ['a branch without a commit yet', { HEAD: 'ref: refs/heads/new\n' }],
        ['a branch file that is no commit', { HEAD: 'ref: refs/heads/x\n', 'refs/heads/x': 'garbage\n' }],
        ['a packed file without the branch', { HEAD: 'ref: refs/heads/x\n', 'packed-refs': `${OTHER} refs/heads/y\n` }],
        ['a head that is neither', { HEAD: 'nonsense\n' }],
    ])('badPath_noCommitFrom %s', (_name, git) => {
        expect(headCommit(checkout(git))).toBeNull();
    });
});

describe('the release', () => {
    it('happyPath_theVersionAndTheShortCommit', () => {
        const files = checkout({ HEAD: `${COMMIT}\n` });

        expect(adminRelease(files, {})).toBe('1.2.3+5d02329');
        expect(adminRelease(files, { GITHUB_SHA: OTHER })).toBe('1.2.3+fffffff');
        expect(adminRelease(files, { HCM_COMMIT: OTHER.replace(/f/g, 'e'), GITHUB_SHA: OTHER })).toBe('1.2.3+eeeeeee');
    });

    it('badPath_anInvalidVariableFallsBackToTheCheckoutAndNoCommitToTheVersion', () => {
        expect(buildCommit(checkout({ HEAD: `${COMMIT}\n` }), { GITHUB_SHA: 'main' })).toBe(COMMIT);
        expect(adminRelease(checkout({}), { HCM_COMMIT: '' })).toBe('1.2.3');
        expect(adminRelease(checkout({}, ''), {})).toBe('0.0.0');
        expect(adminRelease(checkout({}, 7), {})).toBe('0.0.0');
    });
});

describe('the runtime file', () => {
    it('happyPath_theReleaseAlone', () => {
        const { file, release } = planRuntimeFile(checkout({ HEAD: `${COMMIT}\n` }), {});

        expect(release).toBe('1.2.3+5d02329');
        expect(file).toEqual({ to: RUNTIME_FILE, content: '{\n    "release": "1.2.3+5d02329"\n}\n' });
    });

    it.each(['1', 'true'])('happyPath_aStartUpDeploySaysSo_%s', (value) => {
        const { file } = planRuntimeFile(checkout({}), { [START_UP_VARIABLE]: value });

        expect('content' in file ? JSON.parse(file.content) : null).toEqual({ release: '1.2.3', startUp: true });
    });

    it.each([undefined, '', '0', 'false', 'yes'])('badPath_anythingElseIsNoStartUp_%s', (value) => {
        expect(startUpDeploy({ [START_UP_VARIABLE]: value })).toBe(false);
    });
});
