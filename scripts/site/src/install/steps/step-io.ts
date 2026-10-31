/**
 * What the install builds' step scripts (`docs/research/M6-interfaces.md` §1.4) need from the world, so each is tested
 * over fakes: a command to run with its output (shown live and kept for the retry patterns), Google's REST APIs with
 * the build's own token (the metadata server's: the build runs as `hcm-installer@`, no key and no owner token ever
 * reach it), a file, a clock and the build log. `nodeStepDeps()` is the real world of a Cloud Build step.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { installLogLine, type InstallLogEvent } from '@hcm/shared';

export interface CommandResult {
    readonly code: number;
    /** What the command printed (both streams, at most the last {@link MAX_OUTPUT} characters). */
    readonly output: string;
}

export interface StepDeps {
    /** Runs `command` with `args`, showing its output as it comes. */
    readonly run: (command: string, args: readonly string[]) => Promise<CommandResult>;
    readonly fetch: typeof fetch;
    /** The build's own access token (the metadata server's). */
    readonly token: () => Promise<string>;
    readonly readFile: (path: string) => string;
    readonly sleep: (ms: number) => Promise<void>;
    /** Writes one line of the build log. */
    readonly log: (line: string) => void;
}

/** The most of a command's output a step keeps. */
export const MAX_OUTPUT = 1_000_000;

/** The metadata server's token of the account the build runs as. */
export const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** Prints an `HCM_INSTALL` event the admin reads back from the build's log. */
export function logEvent(deps: Pick<StepDeps, 'log'>, event: InstallLogEvent): void {
    deps.log(installLogLine(event));
}

/** The token the metadata server gives the build (throws when it gives none). */
export async function metadataToken(fetcher: typeof fetch): Promise<string> {
    const response = await fetcher(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
    const body = response.ok ? ((await response.json()) as { access_token?: unknown }) : {};
    if (typeof body.access_token !== 'string' || body.access_token === '') {
        throw new Error(`the metadata server gave no token (HTTP ${String(response.status)})`);
    }
    return body.access_token;
}

/** Keeps the last `MAX_OUTPUT` characters of `text`. */
export function tail(text: string): string {
    return text.length > MAX_OUTPUT ? text.slice(-MAX_OUTPUT) : text;
}

/** Runs a command, its output both shown and kept. */
export function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
    return new Promise((resolve) => {
        let output = '';
        const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        const keep = (chunk: Buffer): void => {
            process.stdout.write(chunk);
            output = tail(output + chunk.toString('utf8'));
        };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        child.on('error', (error) => {
            resolve({ code: 1, output: `${output}${String(error)}` });
        });
        child.on('close', (code) => {
            resolve({ code: code ?? 1, output });
        });
    });
}

/** The real world of a Cloud Build step. */
export function nodeStepDeps(): StepDeps {
    return {
        run: runCommand,
        fetch: globalThis.fetch.bind(globalThis),
        token: () => metadataToken(globalThis.fetch.bind(globalThis)),
        readFile: (path) => readFileSync(path, 'utf8'),
        sleep: (ms) =>
            new Promise((resolve) => {
                setTimeout(resolve, ms);
            }),
        log: (line) => {
            process.stdout.write(`${line}\n`);
        },
    };
}

/** A Google REST call with the build's token: the JSON answer, or an error naming the call and its status. */
export async function googleJson(deps: Pick<StepDeps, 'fetch'>, token: string, url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await deps.fetch(url, {
        ...init,
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
        },
    });
    if (!response.ok) {
        throw new GoogleCallError(init.method ?? 'GET', url, response.status);
    }
    const text = await response.text();
    return text === '' ? {} : (JSON.parse(text) as unknown);
}

/** A refused Google call: its method, address (no query: it never holds the token) and status. */
export class GoogleCallError extends Error {
    readonly status: number;

    constructor(method: string, url: string, status: number) {
        super(`${method} ${new URL(url).origin}${new URL(url).pathname}: HTTP ${String(status)}`);
        this.name = 'GoogleCallError';
        this.status = status;
    }
}
