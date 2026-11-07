/**
 * The Windows starter. The quality image has no PowerShell, so a small reader of its strings stands for the parser where it matters
 * (`[scriptblock]::Create` refuses the whole file at one bad string, install and removal alike), and what Windows PowerShell 5.1 does to
 * a native command's arguments is pinned by what the file may hold: it drops an empty argument and strips a quote inside one
 * (`docs/LESSONS.md`). The logic is the POSIX file's (`starter-sidecar.test.ts`); here, that the Windows one holds the same.
 */
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { starterFile as file } from '../support/starter-file.js';

async function powerShell(action: 'install' | 'uninstall' = 'install'): Promise<string> {
    return (await file('windows', action)).body.split('#PS-BEGIN\r\n')[1] ?? '';
}

/** Where a character may end a string: a word, a backslash or a quote straight after one means it ended too early. */
const AFTER_A_STRING = /[\w\\'"]/;

/** A double-quoted string from `start` (just past its quote): the index past its end, or why not. */
function doubleQuoted(text: string, start: number): { readonly end: number } | { readonly fault: string } {
    for (let at = start; at < text.length; at += 1) {
        const character = text[at];
        if (character === '`') {
            at += 1;
        } else if (character === '"' && text[at + 1] === '"') {
            at += 1;
        } else if (character === '"') {
            return AFTER_A_STRING.test(text[at + 1] ?? '') ? { fault: text.slice(start - 1, at + 8) } : { end: at + 1 };
        } else if (character === '\n') {
            return { fault: `a string runs past its line: ${text.slice(start - 1, at)}` };
        }
    }
    return { fault: 'a string never ends' };
}

function singleQuoted(text: string, start: number): number {
    let at = start;
    while (at < text.length && (text[at] !== "'" || text[at + 1] === "'")) {
        at += text[at] === "'" ? 2 : 1;
    }
    return at + 1;
}

function endOfLine(text: string, at: number): number {
    const end = text.indexOf('\n', at);
    return end === -1 ? text.length : end;
}

/** One token at `at`: where the next begins, and what is wrong with a string it holds. */
function readToken(text: string, at: number, faults: string[]): number {
    const character = text[at];
    if (character === '#') {
        return endOfLine(text, at);
    }
    if (character === "'") {
        return singleQuoted(text, at + 1);
    }
    if (character !== '"') {
        return at + 1;
    }
    const read = doubleQuoted(text, at + 1);
    if ('fault' in read) {
        faults.push(read.fault);
        return endOfLine(text, at);
    }
    return read.end;
}

/** What is wrong with the strings of a PowerShell text: nothing, for one that parses. */
function stringFaults(text: string): readonly string[] {
    const faults: string[] = [];
    let at = 0;
    while (at < text.length) {
        at = readToken(text, at, faults);
    }
    return faults;
}

describe('the Windows starter under Windows PowerShell 5.1', () => {
    it('badPath_theReaderOfStringsRefusesABackslashQuoteAsPowerShellDoes @S-P07-BAD-WINDOWS-STARTER', () => {
        expect(stringFaults(String.raw`$word = "printf '{\"state\":\"x\"}' > /ai/box/starter.json"`)).not.toEqual([]);
        expect(stringFaults('$a = "never ends\n$b = 1')).not.toEqual([]);
        expect(stringFaults('$a = \'it\'\'s\'; $b = "`"x`" ""y""" # a " in a comment')).toEqual([]);
    });

    it.each(['install', 'uninstall'] as const)(
        'happyPath_everyStringOfThe%sFileEndsWhereItShould @S-P07-HAPPY-WINDOWS-STARTER',
        async (action) => {
            expect(stringFaults((await powerShell(action)).replaceAll('\r\n', '\n'))).toEqual([]);
        },
    );

    it('badPath_noCallOfDockerHoldsAnEmptyArgumentOrAQuoteInsideOne @S-P07-BAD-WINDOWS-STARTER', async () => {
        const calls = (await powerShell()).split('\r\n').filter((line) => line.includes('& docker'));

        expect(calls.length).toBeGreaterThan(10);
        expect(calls.filter((call) => /\s(""|'')(\s|$)/.test(call))).toEqual([]);
        expect(calls.filter((call) => call.includes('\\"') || call.includes('`"'))).toEqual([]);
        expect(calls.find((call) => call.includes('matcher.child'))).toContain('probe gpu none *> $null');
    });

    it('happyPath_theRefusalReadsAsJsonWhatever51DoesToQuotes @S-P07-BAD-WINDOWS-STARTER', async () => {
        const line = (await powerShell()).split('\r\n').find((each) => each.includes('$word = '));
        const word = /\$word = "(.*)"$/.exec(line?.trim() ?? '')?.[1] ?? '';

        expect(word).not.toContain('"');
        const run = spawnSync('/bin/sh', ['-c', word.replace('$Why', 'disk').replace(' > /ai/box/starter.json', '')], { encoding: 'utf8' });
        expect(JSON.parse(run.stdout)).toEqual({ state: 'unavailable', why: 'disk' });
    });

    it('happyPath_theLoopIsTheSameAsThePosixOnesAndEndsWithItsSupervisor @S-P07-HAPPY-SIDECAR-WHILE-WANTED', async () => {
        const text = await powerShell();

        // It looks at its supervisor, as `kill -0` does, and a new supervisor stops the loops an earlier one left.
        expect(text).toContain('while (Get-Process -Id $Supervisor -ErrorAction SilentlyContinue)');
        expect(text).toContain('Stop-Processes "*$Name.ps1*matcher*"');
        expect(text).toContain('"$Run matcher $PID"');
        expect(text).toContain('Start-MatcherLoop ([int]$args[1])');
        // The sidecar is detached, so the loop goes on; it goes when nobody wants it, or the worker has not answered twice.
        expect(text).toContain('& docker run -d --rm --name $Matcher');
        expect(text).toContain('if ($missed -ge 2) { Stop-Sidecar }');
        expect(text).toContain("return (& docker inspect --format '{{.State.Running}}' $Matcher 2> $null) -eq 'true'");
        expect(text).toContain('if ($script:SidecarImage -eq $Image -and (Test-SidecarUp)) { return }');
    });

    it('happyPath_theWorkerIsToldWhatDockerRunsOn @S-P07-BAD-ARM-HOST', async () => {
        const text = await powerShell();

        expect(text).toContain("$arch = & docker version --format '{{.Server.Arch}}' 2> $null");
        expect(text).toContain('"HCM_DOCKER_ARCH=$arch"');
    });

    it('happyPath_theNoteOfImagesKeepsEachAndTheNewPullLetsTheEarlierGo @S-P07-HAPPY-SIDECAR-WHILE-WANTED', async () => {
        const text = await powerShell();

        expect(text).toContain('Set-AiImageNote $Wanted');
        expect(text).toContain('& docker image rm $old *> $null');
        expect(text).toContain('Set-Content -LiteralPath $AiImageNote -Value ($kept + $Wanted) -Encoding Ascii');
    });
});
