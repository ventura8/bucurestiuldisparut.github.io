/**
 * M26's governor in the POSIX starter (`docs/research/M26-governor.md` §4, §5): `sh hcm-worker.sh governor` over stand-ins of
 * `curl`, `docker`, `nvidia-smi`, `xprintidle` and `sleep`. Every few seconds it writes the host's hints into the worker's volume
 * through the worker's own container, and sets the worker's CPU quota to the budget's threads only when they change.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { starterFile as file } from '../support/starter-file.js';

interface GovernorWorld {
    /** The budget's threads `/state` says, one per pass (null: no machine, an older worker). */
    readonly threads: readonly (number | null)[];
    /** What `docker info` lists. */
    readonly info?: string;
    /** Whether this computer has an NVIDIA card (nvidia-smi answers). */
    readonly nvidia?: boolean;
}

function stateOf(threads: number | null): string {
    const machine =
        threads === null ? '' : `, "machine": {"budget": {"threads": ${String(threads)}, "memoryMb": 2048, "gpuFraction": 0.4}}`;
    return `{"signedIn": true${machine}}`;
}

async function governorLoop(
    world: GovernorWorld,
): Promise<{ readonly calls: readonly string[]; readonly hints: unknown; readonly output: string }> {
    const folder = mkdtempSync(join(tmpdir(), 'hcm-governor-'));
    const bin = join(folder, 'bin');
    const log = join(folder, 'calls.log');
    const hints = join(folder, 'hints.json');
    mkdirSync(bin);
    world.threads.forEach((threads, index) => {
        writeFileSync(join(folder, `state-${String(index)}`), stateOf(threads));
    });
    const last = world.threads.length - 1;
    const tools: Readonly<Record<string, string>> = {
        curl: [
            `n=$(grep -c '^curl' "${log}" 2>/dev/null) || n=0`,
            `echo curl >>"${log}"`,
            `[ "$n" -gt ${String(last)} ] && n=${String(last)}`,
            `cat "${folder}/state-$n"`,
        ].join('\n'),
        docker: [
            `echo "$*" >>"${log}"`,
            'case "$1" in',
            `exec) cat >"${hints}" ;;`,
            `info) echo "${world.info ?? ''}" ;;`,
            'esac',
            'exit 0',
        ].join('\n'),
        'nvidia-smi': world.nvidia === true ? "echo 'NVIDIA GeForce RTX 3080 Laptop GPU, 8192, 6400, 83, 81'" : 'exit 127',
        xprintidle: 'echo 42000',
        sleep: `echo "sleep $1" >>"${log}"\n[ "$(grep -c '^sleep' "${log}")" -ge ${String(world.threads.length)} ] && kill -9 "$PPID"\nexit 0`,
    };
    for (const [name, body] of Object.entries(tools)) {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    const script = join(folder, 'hcm-worker.sh');
    writeFileSync(script, (await file('linux', 'install')).body);
    const run = spawnSync('/bin/sh', [script, 'governor'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: folder },
        timeout: 20_000,
    });
    return {
        calls: readFileSync(log, 'utf8').trim().split('\n'),
        hints: existsSync(hints) ? JSON.parse(readFileSync(hints, 'utf8')) : null,
        output: run.stdout,
    };
}

function updates(calls: readonly string[]): readonly string[] {
    return calls.filter((call) => call.startsWith('update '));
}

describe("the governor's loop in the starter (M26)", () => {
    it('happyPath_theQuotaFollowsTheBudgetOnlyWhenItChangesAndTheHintsReachTheVolume @S-A141-HAPPY', async () => {
        const { calls, hints, output } = await governorLoop({ threads: [14, 14, 4], info: 'Runtimes: runc nvidia', nvidia: true });

        expect(updates(calls)).toEqual(['update --cpus 14 hcm-worker', 'update --cpus 4 hcm-worker']);
        expect(output).toContain('governor: the worker may use 4 cores');
        expect(calls).toContain(
            'exec -i hcm-worker sh -c cat > /work/host-hints.json.part && mv /work/host-hints.json.part /work/host-hints.json',
        );
        expect(calls.filter((call) => call.startsWith('run ') || call.includes('docker.sock'))).toEqual([]);
        expect(hints).toMatchObject({
            idleS: 42,
            gpus: [
                {
                    vendor: 'nvidia',
                    name: 'NVIDIA GeForce RTX 3080 Laptop GPU',
                    vramMb: 8192,
                    othersMb: 6400,
                    busyPct: 83,
                    tempC: 81,
                    via: 'cuda',
                },
            ],
            npus: [],
        });
        expect(typeof (hints as { at?: unknown }).at).toBe('number');
    });

    it('badPath_anOlderWorkerOrAPauseLeavesTheQuotaAndACardDockerCannotReachHasNoRuntime @S-A141-BAD-NO-GPU', async () => {
        const { calls, hints } = await governorLoop({ threads: [null, 0, 6], nvidia: true });

        expect(updates(calls)).toEqual(['update --cpus 6 hcm-worker']);
        expect(hints).toMatchObject({ gpus: [{ vendor: 'nvidia', via: null }] });
    });

    it('badPath_noCardNoHintsOfOne @S-A141-BAD-NO-GPU', async () => {
        const { hints } = await governorLoop({ threads: [2] });

        expect(hints).toMatchObject({ gpus: [], npus: [] });
    });

    it('happyPath_theWindowsFileHasTheSameLoop', async () => {
        const text = (await file('windows', 'install')).body;

        expect(text).toContain('GetLastInputInfo');
        expect(text).toContain('Win32_Battery');
        expect(text).toContain('Start-Process -FilePath \'powershell.exe\' -ArgumentList "$Run governor $PID" -WindowStyle Hidden');
        expect(text).toContain('& docker update --cpus $threads $Name');
        expect(text).toContain("'governor' { Start-GovernorLoop ([int]$args[1]) }");
    });
});
