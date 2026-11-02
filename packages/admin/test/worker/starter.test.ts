// The starter files as the admin gives them (finding 72 of 2026-11-02, `packages/admin/starter/`): each template filled
// for each system, checked for what it must and must not hold. The POSIX one is parsed by `sh -n` (shellcheck lints the
// template itself in the static stage); the quality image has no PowerShell, so the Windows one is checked for its
// structure: CRLF lines, one PowerShell marker after cmd's `exit /b`, balanced brackets.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { WORKER_OUTDATED_EXIT, WORKER_STARTER_TEMPLATES } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { starterText, WORKER_OSES, type WorkerOs } from '../../src/worker/local.js';

const VALUES = { project: 'demo-hcm', city: 'bucharest' } as const;

function template(os: WorkerOs): string {
    const file = os === 'windows' ? WORKER_STARTER_TEMPLATES.windows : WORKER_STARTER_TEMPLATES.posix;
    return readFileSync(new URL(`../../starter/${file}`, import.meta.url), 'utf8');
}

function filled(os: WorkerOs, action: 'install' | 'uninstall'): string {
    const text = starterText(template(os), { ...VALUES, action }, os);
    if (text === null) {
        throw new Error('the values were refused');
    }
    return text;
}

function count(text: string, character: string): number {
    return text.split(character).length - 1;
}

describe('the starter files', () => {
    it.each(WORKER_OSES.flatMap((os) => (['install', 'uninstall'] as const).map((action) => [os, action] as const)))(
        'happyPath_the%sFileTo%sNamesTheCityAndTheInstalledImageAndHoldsNoSecret',
        (os, action) => {
            const text = filled(os, action);

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

    it('happyPath_thePosixFileParsesAsAShellScript', () => {
        for (const action of ['install', 'uninstall'] as const) {
            const parsed = spawnSync('/bin/sh', ['-n'], { input: filled('linux', action), encoding: 'utf8' });
            expect(parsed.status).toBe(0);
        }
        expect(filled('mac', 'install')).toBe(filled('linux', 'install'));
        expect(filled('linux', 'install')).not.toContain('\r');
    });

    it('happyPath_theWindowsFileIsCmdThenOnePowerShellPart', () => {
        const text = filled('windows', 'install');
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
    });

    it('badPath_aValueThatCouldBreakOutOfTheFileIsNeverWritten', () => {
        for (const os of WORKER_OSES) {
            expect(starterText(template(os), { project: 'demo-hcm"&calc&"', city: 'bucharest', action: 'install' }, os)).toBeNull();
            expect(starterText(template(os), { project: 'demo-hcm', city: "x'$(id)'", action: 'install' }, os)).toBeNull();
        }
    });
});
