/**
 * M26: "This computer" (`docs/research/M26-governor.md` §6), in the lazy `worker-local` chunk. The worker's `GET /state`,
 * which `local.ts` reads every `PROBE_MS` already, carries `machine`: what the governor says of the computer (cores,
 * memory, power, cards, where the matcher runs, the profile in force and why, the budget). A worker older than M26 says
 * nothing of it (`old`: the card asks to update the worker). The owner's choice (`auto`, `quiet`, `full`) is posted to
 * the worker's `POST /profile` from the admin's Hosting origin, under `/pair`'s rules; it stays on that computer.
 */
import { workerMachineSchema, type WorkerMachine, type WorkerProfileChoice } from '@hcm/shared';

/** What the card shows: nothing heard yet, a worker older than the governor, or what the governor says. */
export type MachineView =
    | { readonly kind: 'unknown' }
    | { readonly kind: 'old' }
    | { readonly kind: 'known'; readonly machine: WorkerMachine; readonly failed: boolean };

export const UNKNOWN_MACHINE: MachineView = { kind: 'unknown' };

/** The card's view of one `/state` answer: `old` without `machine` (or with one this admin cannot read), unknown before its first tick. */
export function machineOf(answer: unknown): MachineView {
    const said = machineSaid(answer);
    if (said === null) {
        return UNKNOWN_MACHINE;
    }
    const parsed = workerMachineSchema.safeParse(said);
    return parsed.success ? { kind: 'known', machine: parsed.data, failed: false } : { kind: 'old' };
}

/** The answer's `machine` (null before the governor's first tick); undefined, which no schema takes, when it has none. */
function machineSaid(answer: unknown): unknown {
    const record = answer as { readonly machine?: unknown } | null;
    return typeof record === 'object' && record !== null && 'machine' in record ? record.machine : undefined;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The owner's profile posted to the worker; its new state's machine, or null when the worker did not take it. */
export async function postProfile(fetch: Fetch, worker: string, profile: WorkerProfileChoice): Promise<MachineView | null> {
    try {
        const response = await fetch(`${worker}/profile`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ profile }),
            credentials: 'omit',
        });
        return response.ok ? machineOf(await response.json()) : null;
    } catch {
        return null;
    }
}
