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
    const entry = (name: string, bytes: Buffer) => ({ name, bytes: bytes.length, sha256: sha(bytes) });
    const manifest = Buffer.from(
        JSON.stringify({
            release,
            files: { server: entry('server.tgz', server), pipeline: entry('pipeline.tgz', pipeline), site: entry('hosting.tgz', site) },
        }),
    );
    const files = new Map([
        ['manifest.json', manifest],
        ['server.tgz', server],
        ['pipeline.tgz', pipeline],
        ['hosting.tgz', site],
    ]);
    return { files, manifestSha: sha(manifest), serverSha: sha(server) };
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
        HCM_FILES: 'server',
        HCM_OUT: join(work, 'server'),
        ...changes,
    };
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
    });

    it.each([
        [
            'a manifest the admin did not read',
            (found: Bundle) => envOf(found, { HCM_MANIFEST_SHA256: '0'.repeat(64) }),
            'not the one the admin read',
        ],
        ['another release', (found: Bundle) => envOf(found, { HCM_RELEASE: '1.0.1+abc1234' }), 'another release'],
        [
            'a tarball the admin did not choose',
            (found: Bundle) => envOf(found, { HCM_FILE_SHA256: '0'.repeat(64) }),
            'not the file the admin chose',
        ],
        ['a target the manifest does not name', (found: Bundle) => envOf(found, { HCM_FILES: 'other' }), 'names no file for other'],
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
