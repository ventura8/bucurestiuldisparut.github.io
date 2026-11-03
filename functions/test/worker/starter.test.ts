/**
 * The starter files (finding 72 of 2026-11-02; finding 73 of 2026-11-03: served by `worker.starter`,
 * `functions/src/worker/starter.ts`, as a download): each template of `packages/admin/starter/` filled for each system and
 * action, checked for what it must and must not hold, the function's answers (the file with its name, a bad query, a
 * method other than GET or HEAD, a template that cannot be read), and finding 74's supervisor, which backs off when the
 * image the server names refuses its arguments. The POSIX file is parsed by `sh -n` (shellcheck lints the template
 * itself in the static stage) and run with stand-ins of `curl`, `docker` and `sleep`; the quality image has no
 * PowerShell, so the Windows one is checked for its structure: CRLF lines, one PowerShell marker after cmd's `exit /b`,
 * balanced brackets.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORKER_OSES, WORKER_OUTDATED_EXIT, type WorkerOs } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createDiskStarterTemplates } from '../../src/adapters/starter-templates.js';
import { handleStarterRequest, serveStarters, type StarterDeps } from '../../src/worker/starter.js';
import { recordingLogger } from '../support/fakes.js';

const TEMPLATES = new URL('../../../packages/admin/starter/', import.meta.url);
const CITY = 'bucharest';
const DIGEST = 'e2'.repeat(32);

function deps(starters = createDiskStarterTemplates(TEMPLATES)) {
    const { log, recording } = recordingLogger();
    const world: StarterDeps = { log, starters, config: { projectId: 'demo-hcm' } as StarterDeps['config'] };
    return { deps: world, recording };
}

async function file(os: WorkerOs, action: 'install' | 'uninstall') {
    return handleStarterRequest(deps().deps, { method: 'GET', query: { city: CITY, os, action } });
}

function count(text: string, character: string): number {
    return text.split(character).length - 1;
}

describe('worker.starter', () => {
    it.each(WORKER_OSES.flatMap((os) => (['install', 'uninstall'] as const).map((action) => [os, action] as const)))(
        'happyPath_the%sFileTo%sIsADownloadNamingTheCityAndTheInstalledImageAndHoldsNoSecret @S-A62-HAPPY-STARTER',
        async (os, action) => {
            const answer = await file(os, action);
            const text = answer.body;

            expect(answer.status).toBe(200);
            expect(answer.headers).toMatchObject({
                'content-type': 'application/octet-stream',
                'cache-control': 'no-store',
                'access-control-allow-origin': '*',
            });
            expect(answer.headers['content-disposition']).toMatch(/^attachment; filename="hcm-worker(-remove)?\.(sh|command|bat)"$/);
            expect(text).not.toContain('__HCM_');
            expect(text).toContain(os === 'windows' ? 'set "HCM_PROJECT=demo-hcm"' : "HCM_PROJECT='demo-hcm'");
            expect(text).toContain(os === 'windows' ? 'set "HCM_CITY=bucharest"' : "HCM_CITY='bucharest'");
            expect(text).toContain(os === 'windows' ? `set "HCM_ACTION=${action}"` : `HCM_ACTION='${action}'`);
            // The supervisor asks the server for the installed image, runs it on the loopback only and restarts it itself.
            expect(text).toContain('.cloudfunctions.net/worker-image');
            expect(text).toContain('--supervised');
            expect(text).toContain('127.0.0.1:');
            expect(text).toContain(String(WORKER_OUTDATED_EXIT));
            expect(text).not.toMatch(/--pair|--restart|docker\.sock/);
        },
    );

    it('happyPath_eachSystemGetsItsOwnFileName', async () => {
        const names = await Promise.all(
            WORKER_OSES.flatMap((os) => (['install', 'uninstall'] as const).map(async (action) => (await file(os, action)).headers)),
        );

        expect(names.map((headers) => headers['content-disposition'])).toEqual([
            'attachment; filename="hcm-worker.sh"',
            'attachment; filename="hcm-worker-remove.sh"',
            'attachment; filename="hcm-worker.command"',
            'attachment; filename="hcm-worker-remove.command"',
            'attachment; filename="hcm-worker.bat"',
            'attachment; filename="hcm-worker-remove.bat"',
        ]);
    });

    it('happyPath_thePosixFileParsesAsAShellScript', async () => {
        for (const action of ['install', 'uninstall'] as const) {
            const parsed = spawnSync('/bin/sh', ['-n'], { input: (await file('linux', action)).body, encoding: 'utf8' });
            expect(parsed.status).toBe(0);
        }
        expect((await file('mac', 'install')).body).toBe((await file('linux', 'install')).body);
        expect((await file('linux', 'install')).body).not.toContain('\r');
    });

    it('happyPath_theWindowsFileIsCmdThenOnePowerShellPart', async () => {
        const text = (await file('windows', 'install')).body;
        const lines = text.split('\r\n');
        const marker = lines.indexOf('#PS-BEGIN');
        const powershell = lines.slice(marker + 1).join('\n');

        expect(text.replace(/\r\n/g, '')).not.toContain('\n');
        expect(lines.filter((line) => line === '#PS-BEGIN')).toHaveLength(1);
        expect(lines.slice(0, marker).at(-1)).toBe('exit /b');
        expect(lines[0]).toBe('@echo off');
        expect([count(powershell, '{'), count(powershell, '(')]).toEqual([count(powershell, '}'), count(powershell, ')')]);
        expect(powershell).toContain('Register-ScheduledTask');
        expect(powershell).toContain('Unregister-ScheduledTask');
        expect(powershell).toContain('$Usage = 2');
    });

    it.each([
        ['no city', { os: 'linux', action: 'install' }],
        ['a city that could break out of the file', { city: "x'$(id)'", os: 'linux', action: 'install' }],
        ['another system', { city: CITY, os: 'beos', action: 'install' }],
        ['another action', { city: CITY, os: 'linux', action: 'run' }],
        ['a field more', { city: CITY, os: 'linux', action: 'install', project: 'other' }],
    ])('badPath_aRequestFor_%s_IsRefusedWithoutAFile', async (_case, query) => {
        const answer = await handleStarterRequest(deps().deps, { method: 'GET', query });

        expect(answer.status).toBe(400);
        expect(answer.headers).not.toHaveProperty('content-disposition');
    });

    it('badPath_onlyGetAndHeadAreAnswered', async () => {
        const query = { city: CITY, os: 'linux', action: 'install' };

        await expect(handleStarterRequest(deps().deps, { method: 'POST', query })).resolves.toMatchObject({
            status: 405,
            headers: { allow: 'GET, HEAD' },
        });
        await expect(handleStarterRequest(deps().deps, { method: 'HEAD', query })).resolves.toMatchObject({ status: 200 });
    });

    it('badPath_aTemplateThatCannotBeReadGivesNoFileAndIsLogged @S-A62-BAD-STARTER-TEMPLATE', async () => {
        const world = deps(createDiskStarterTemplates(new URL('file:///nowhere/hcm-starter/')));

        const answer = await handleStarterRequest(world.deps, { method: 'GET', query: { city: CITY, os: 'linux', action: 'install' } });

        expect(answer.status).toBe(503);
        expect(answer.headers).not.toHaveProperty('content-disposition');
        expect(world.recording.records.map((record) => record.message)).toContain('starter template not readable');
    });

    it('happyPath_theExpressHandlerSendsTheAnswer', async () => {
        const sent: { status?: number; headers?: Readonly<Record<string, string>>; body?: string } = {};
        const response = {
            status(code: number) {
                sent.status = code;
                return this;
            },
            set(headers: Readonly<Record<string, string>>) {
                sent.headers = headers;
                return this;
            },
            send(body: string) {
                sent.body = body;
            },
        };

        await serveStarters(() => deps().deps)({ method: 'GET', query: { city: CITY, os: 'linux', action: 'install' } }, response);

        expect(sent.status).toBe(200);
        expect(sent.headers?.['content-disposition']).toBe('attachment; filename="hcm-worker.sh"');
        expect(sent.body).toContain("HCM_CITY='bucharest'");
    });

    it('happyPath_aTemplateIsReadOnceAndAFailedReadIsTriedAgain', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'hcm-starter-'));
        const templates = createDiskStarterTemplates(new URL(`file://${folder}/`));

        await expect(templates.read('hcm-worker.sh')).rejects.toThrow();
        writeFileSync(join(folder, 'hcm-worker.sh'), 'first\n');
        await expect(templates.read('hcm-worker.sh')).resolves.toBe('first\n');
        writeFileSync(join(folder, 'hcm-worker.sh'), 'second\n');
        await expect(templates.read('hcm-worker.sh')).resolves.toBe('first\n');
    });
});

/** The filled POSIX file run as its supervisor (`sh hcm-worker.sh run`) over stand-ins that exit the worker with `code`. */
async function supervise(code: number): Promise<{ readonly output: string; readonly log: readonly string[] }> {
    const folder = mkdtempSync(join(tmpdir(), 'hcm-supervisor-'));
    const bin = join(folder, 'bin');
    const log = join(folder, 'calls.log');
    mkdirSync(bin);
    const tools: Readonly<Record<string, string>> = {
        curl: `printf '%s' '{"result":{"image":"us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${DIGEST}"}}'`,
        docker: `[ "$1" = run ] && { echo run >>"${log}"; exit ${String(code)}; }\nexit 0`,
        // The fourth wait ends the supervisor (its parent shell), as a stop of the service would.
        sleep: `echo "sleep $1" >>"${log}"\n[ "$(grep -c sleep "${log}")" -ge 4 ] && kill -9 "$PPID"\nexit 0`,
    };
    for (const [name, body] of Object.entries(tools)) {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    const script = join(folder, 'hcm-worker.sh');
    writeFileSync(script, (await file('linux', 'install')).body);
    const run = spawnSync('/bin/sh', [script, 'run'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: folder },
        timeout: 20_000,
    });
    return { output: run.stdout, log: readFileSync(log, 'utf8').trim().split('\n') };
}

describe('the supervisor (finding 74 of 2026-11-03)', () => {
    it('badPath_anImageThatRefusesTheSupervisorsArgumentsIsSaidOnceAndAskedForEveryFiveMinutes @S-A62-BAD-STARTER-OLD-IMAGE', async () => {
        const { output, log } = await supervise(2);

        expect(output.match(/does not support this computer's starter: update the map/g)).toHaveLength(1);
        expect(log).toEqual(['run', 'sleep 10', 'run', 'sleep 30', 'run', 'sleep 300', 'run', 'sleep 300']);
    });

    it('happyPath_anOutdatedWorkerIsStartedAgainAtOnceAndNothingIsSaid', async () => {
        const { output, log } = await supervise(WORKER_OUTDATED_EXIT);

        expect(output).not.toContain('update the map');
        expect(log).toEqual(['run', 'sleep 0', 'run', 'sleep 0', 'run', 'sleep 0', 'run', 'sleep 0']);
    });
});
