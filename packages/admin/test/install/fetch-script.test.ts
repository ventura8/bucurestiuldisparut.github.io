import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FETCH_BUNDLE_SCRIPT } from '../../src/install/fetch-script.js';

/**
 * The install builds' first step (`fetch`, `docs/research/M6-interfaces.md` §1.3, §1.4), run as Cloud Build runs it
 * (`node --input-type=module --eval`) against a local bundle folder: it unpacks the target's tarball only when every
 * SHA-256 matches what the admin read, and stops with status 1 on anything else.
 */

const RELEASE = '1.0.0+abc1234';
/** The image's own `tar` and a PATH of fixed system folders (the step finds `tar` there, as in the Node image). */
const TAR = '/usr/bin/tar';
const FIXED_PATH = '/usr/local/bin:/usr/bin:/bin';

interface Bundle {
    readonly files: Map<string, Buffer>;
    readonly manifestSha: string;
    readonly serverSha: string;
}

let work: string;
let server: Server;
let origin: string;
let served: Map<string, Buffer>;

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** A tarball of one folder holding `name` with `text`. */
function tarball(name: string, text: string): Buffer {
    const source = mkdtempSync(join(work, 'src-'));
    writeFileSync(join(source, name), text);
    const out = join(work, `${name}.tgz`);
    execFileSync(TAR, ['-czf', out, '-C', source, name]);
    return readFileSync(out);
}

function bundle(release = RELEASE): Bundle {
    const server = tarball('server.txt', 'the server');
    const pipeline = tarball('pipeline.txt', 'the pipeline');
    const site = tarball('index.html', '<!doctype html><title>map</title>');
    const legacy = tarball('original.jpg', 'an original');
    const entry = (name: string, bytes: Buffer) => ({ name, bytes: bytes.length, sha256: sha(bytes) });
    const files = {
        server: entry('server.tgz', server),
        pipeline: entry('pipeline.tgz', pipeline),
        site: entry('hosting.tgz', site),
        legacy: entry('legacy.tgz', legacy),
    };
    const manifest = Buffer.from(JSON.stringify({ release, releaseTime: 1_761_955_200, files }));
    const served = new Map([
        ['manifest.json', manifest],
        ['server.tgz', server],
        ['pipeline.tgz', pipeline],
        ['hosting.tgz', site],
        ['legacy.tgz', legacy],
    ]);
    return { files: served, manifestSha: sha(manifest), serverSha: sha(server) };
}

function run(env: Readonly<Record<string, string>>): Promise<{ readonly code: number; readonly stderr: string }> {
    return new Promise((resolve) => {
        execFile(
            process.execPath,
            ['--input-type=module', '--eval', FETCH_BUNDLE_SCRIPT],
            { env: { PATH: FIXED_PATH, HCM_WORKSPACE: work, ...env } },
            (error, _stdout, stderr) => {
                resolve({ code: error === null ? 0 : Number(error.code ?? 1), stderr });
            },
        );
    });
}

function envOf(found: Bundle, changes: Readonly<Record<string, string>> = {}): Record<string, string> {
    return {
        HCM_BUNDLE_URL: `${origin}/admin/install/1-0-0-abc1234/`,
        HCM_MANIFEST_SHA256: found.manifestSha,
        HCM_FILE_SHA256: found.serverSha,
        HCM_RELEASE: RELEASE,
        HCM_RELEASE_TIME: '1761955200',
        HCM_FILES: 'server',
        HCM_OUT: join(work, 'server'),
        ...changes,
    };
}

/** A site tarball of a bundle made for no project (M14 §6): the token in `firebase.json` and the city page's `config.js`. */
function genericSite(): { readonly bytes: Buffer } {
    const source = mkdtempSync(join(work, 'generic-'));
    mkdirSync(join(source, 'public/city'), { recursive: true });
    writeFileSync(join(source, 'firebase.json'), '{"hosting":{"site":"__HCM_PROJECT_ID__"}}');
    writeFileSync(join(source, 'public/city/config.js'), 'bucket("__HCM_PROJECT_ID__-public")');
    const out = join(work, 'generic.tgz');
    execFileSync(TAR, ['-czf', out, '-C', source, 'firebase.json', 'public']);
    return { bytes: readFileSync(out) };
}

beforeEach(async () => {
    work = mkdtempSync(join(tmpdir(), 'hcm-fetch-'));
    served = new Map();
    server = createServer((request, response) => {
        const name = (request.url ?? '').split('/').pop() ?? '';
        const body = served.get(name);
        response.writeHead(body === undefined ? 404 : 200);
        response.end(body);
    });
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
    await new Promise<void>((resolve) => {
        server.close(() => {
            resolve();
        });
    });
    rmSync(work, { recursive: true, force: true });
});

describe('the fetch step', () => {
    it('happyPath_theCheckedServerTarballIsUnpacked', async () => {
        const found = bundle();
        served = found.files;

        const result = await run(envOf(found));

        expect(result).toEqual({ code: 0, stderr: '' });
        expect(readFileSync(join(work, 'server', 'server.txt'), 'utf8')).toBe('the server');
        expect(existsSync(join(work, 'bundle', 'manifest.json'))).toBe(true);
    });

    it('happyPath_theSiteKeepsTheWholeBundleInItsTree', async () => {
        const found = bundle();
        served = found.files;
        const siteSha = sha(found.files.get('hosting.tgz') ?? Buffer.alloc(0));
        mkdirSync(join(work, 'site'), { recursive: true });

        const result = await run(
            envOf(found, {
                HCM_FILE_SHA256: siteSha,
                HCM_FILES: 'site,server,pipeline',
                HCM_OUT: join(work, 'site'),
                HCM_KEEP_BUNDLE: 'public/admin/install/1-0-0-abc1234',
            }),
        );

        expect(result.code).toBe(0);
        expect(existsSync(join(work, 'site', 'index.html'))).toBe(true);
        const kept = join(work, 'site', 'public', 'admin', 'install', '1-0-0-abc1234');
        expect(['manifest.json', 'hosting.tgz', 'server.tgz', 'pipeline.tgz'].every((name) => existsSync(join(kept, name)))).toBe(true);
        // §73k: without legacy.tgz in HCM_FILES the originals are neither downloaded nor in the release.
        expect([existsSync(join(work, 'site', 'original.jpg')), existsSync(join(kept, 'legacy.tgz'))]).toEqual([false, false]);
    });

    it('happyPath_aSiteBuildBeforeTheLegacyImportEndsUnpacksTheOriginalsToo', async () => {
        const found = bundle();
        served = found.files;
        const siteSha = sha(found.files.get('hosting.tgz') ?? Buffer.alloc(0));

        const result = await run(
            envOf(found, {
                HCM_FILE_SHA256: siteSha,
                HCM_FILES: 'site,server,pipeline,legacy',
                HCM_OUT: join(work, 'site'),
                HCM_KEEP_BUNDLE: 'public/admin/install/1-0-0-abc1234',
                HCM_UNPACK: 'legacy',
            }),
        );

        expect(result.code).toBe(0);
        expect(readFileSync(join(work, 'site', 'original.jpg'), 'utf8')).toBe('an original');
        expect(existsSync(join(work, 'site', 'public', 'admin', 'install', '1-0-0-abc1234', 'legacy.tgz'))).toBe(true);
    });

    it.each([
        [
            'a manifest the admin did not read',
            (found: Bundle) => envOf(found, { HCM_MANIFEST_SHA256: '0'.repeat(64) }),
            'not the one the admin read',
        ],
        ['another release', (found: Bundle) => envOf(found, { HCM_RELEASE: '1.0.1+abc1234' }), 'another release'],
        // Finding 39 of 2026-11-01: the build time the admin read is the manifest's, or the build stops.
        ['another build time', (found: Bundle) => envOf(found, { HCM_RELEASE_TIME: '1761955201' }), 'another build time'],
        ['no build time for a timed release', (found: Bundle) => envOf(found, { HCM_RELEASE_TIME: '' }), 'another build time'],
        [
            'a tarball the admin did not choose',
            (found: Bundle) => envOf(found, { HCM_FILE_SHA256: '0'.repeat(64) }),
            'not the file the admin chose',
        ],
        ['a target the manifest does not name', (found: Bundle) => envOf(found, { HCM_FILES: 'other' }), 'names no file for other'],
        [
            'a tarball unpacked but not fetched',
            (found: Bundle) => envOf(found, { HCM_UNPACK: 'legacy' }),
            'legacy is unpacked but not fetched',
        ],
    ])('badPath_%s stops the build', async (_name, env, message) => {
        const found = bundle();
        served = found.files;

        const result = await run(env(found));

        expect(result.code).toBe(1);
        expect(result.stderr).toContain(message);
        expect(existsSync(join(work, 'server', 'server.txt'))).toBe(false);
    });

    it('badPath_aTarballChangedAfterTheManifestStopsTheBuild', async () => {
        const found = bundle();
        served = new Map(found.files);
        served.set('server.tgz', tarball('server.txt', 'another server'));

        const result = await run(envOf(found));

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('server.tgz is not the file the manifest names');
    });

    it('badPath_aMissingBundleStopsTheBuild', async () => {
        const result = await run(envOf(bundle()));

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('manifest.json: HTTP 404');
    });
});

describe('a site build of a bundle made for no project (M14)', () => {
    function servedGeneric(): Record<string, string> {
        const site = genericSite().bytes;
        const entry = { name: 'hosting.tgz', bytes: site.length, sha256: sha(site) };
        const manifest = Buffer.from(JSON.stringify({ release: RELEASE, releaseTime: 1_761_955_200, files: { site: entry } }));
        served.set('manifest.json', manifest);
        served.set('hosting.tgz', site);
        return {
            HCM_BUNDLE_URL: `${origin}/admin/install/1-0-0-abc1234/`,
            HCM_MANIFEST_SHA256: sha(manifest),
            HCM_FILE_SHA256: entry.sha256,
            HCM_RELEASE: RELEASE,
            HCM_RELEASE_TIME: '1761955200',
            HCM_FILES: 'site',
            HCM_OUT: join(work, 'site'),
            HCM_ADOPT_PROJECT: 'fostul-bacau',
            HCM_ADOPT_FROM: `${origin}/admin/project.json`,
        };
    }

    it('happyPath_theProjectJoinsTheTreeAndItsFileComesFromTheLiveSite', async () => {
        const env = servedGeneric();
        served.set('project.json', Buffer.from('{"projectId":"fostul-bacau"}'));

        expect((await run(env)).code).toBe(0);

        expect(readFileSync(join(work, 'site/firebase.json'), 'utf8')).toContain('"site":"fostul-bacau"');
        expect(readFileSync(join(work, 'site/public/city/config.js'), 'utf8')).toBe('bucket("fostul-bacau-public")');
        expect(readFileSync(join(work, 'site/public/admin/project.json'), 'utf8')).toBe('{"projectId":"fostul-bacau"}');
    });

    it('badPath_aProjectFileTheLiveSiteDoesNotServeStopsTheBuild', async () => {
        const { code, stderr } = await run(servedGeneric());

        expect(code).toBe(1);
        expect(stderr).toContain('project.json: HTTP 404');
    });
});
