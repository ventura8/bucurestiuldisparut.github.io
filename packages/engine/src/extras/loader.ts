/**
 * The engine's extras, loaded on demand (docs/ENGINE_API.md → *Extras on demand*, DECISIONS-for-review.md §159): code
 * no first paint needs (swipe compare, the gamepad, the consented Firebase SDK and field chunk) is its own classic script
 * beside the engine, `extra-<name>-<hash>.js`. The build (`scripts/site/src/engine-extras.ts`) writes each file's
 * Subresource Integrity into the engine, so a page that pins the engine with `integrity` covers its extras too.
 *
 * This loader adds the extra's `<script>` with that integrity the first time it is wanted, and resolves with what the
 * script registered on the host (`host.ts`). A script that fails (offline, a 404, a wrong integrity) is removed and
 * logged, its promise rejects with `ExtraLoadError`, and the next call tries again: the caller shows its friendly
 * message and the visitor retries by asking again.
 */
import type { Logger } from '@hcm/shared';

/** One extra as the build wrote it: where it registers, its file beside the engine and its integrity. */
export interface ExtraFile {
    /** The key the script registers its exports under on the host's `extras`. */
    readonly global: string;
    /** `extra-<name>-<hash>.js`, relative to the engine's folder. */
    readonly file: string;
    /** `sha384-…` of the file's bytes. */
    readonly integrity: string;
}

/** The parts of a `<script>` element the loader sets and listens to. */
export interface ExtraScript {
    src: string;
    integrity: string;
    crossOrigin: string | null;
    async: boolean;
    addEventListener(type: 'load' | 'error', listener: () => void): void;
    remove(): void;
}

/** The parts of `document` the loader uses (`S`: its script elements). */
export interface ExtrasDocument<S extends ExtraScript> {
    createElement(tagName: 'script'): S;
    readonly head: { append(node: S): void };
}

export interface ExtraLoaderDeps<S extends ExtraScript> {
    readonly document: ExtrasDocument<S>;
    /** The engine's folder (`engineBaseOf`), read when a script is added. */
    readonly base: () => string;
    /** Where the extras register their exports (the host's `extras`). */
    readonly registry: () => Readonly<Record<string, unknown>>;
    readonly log: Logger;
}

/** An extra that could not be loaded: its file did not arrive, was refused by its integrity, or registered nothing. */
export class ExtraLoadError extends Error {
    override readonly name = 'ExtraLoadError';

    constructor(
        readonly file: string,
        reason: string,
    ) {
        super(`the extra ${file} ${reason}`);
    }
}

/** Loads extras: one script per extra however often it is asked for, and a fresh try after a failure. */
export type ExtraLoader = (extra: ExtraFile) => Promise<unknown>;

export function createExtraLoader<S extends ExtraScript>(deps: ExtraLoaderDeps<S>): ExtraLoader {
    const loading = new Map<string, Promise<unknown>>();
    return (extra) => {
        const known = loading.get(extra.global);
        if (known !== undefined) {
            return known;
        }
        const started = registered(deps, extra) ?? fetched(deps, extra, loading);
        loading.set(extra.global, started);
        return started;
    };
}

/** An extra already on the page (registered by an earlier script) needs no new one. */
function registered(deps: ExtraLoaderDeps<ExtraScript>, extra: ExtraFile): Promise<unknown> | null {
    const module = deps.registry()[extra.global];
    return module === undefined ? null : Promise.resolve(module);
}

function fetched<S extends ExtraScript>(
    deps: ExtraLoaderDeps<S>,
    extra: ExtraFile,
    loading: Map<string, Promise<unknown>>,
): Promise<unknown> {
    const script = deps.document.createElement('script');
    const arrived = new Promise<unknown>((resolve, reject) => {
        script.addEventListener('load', () => {
            const module = deps.registry()[extra.global];
            if (module === undefined) {
                reject(new ExtraLoadError(extra.file, 'registered nothing'));
            } else {
                resolve(module);
            }
        });
        script.addEventListener('error', () => {
            reject(new ExtraLoadError(extra.file, 'could not be loaded'));
        });
    });
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.integrity = extra.integrity;
    script.src = `${deps.base()}${extra.file}`;
    deps.document.head.append(script);
    return arrived.catch((error: unknown) => {
        loading.delete(extra.global);
        script.remove();
        deps.log.warn('extra not loaded', { file: extra.file, error: String(error) });
        throw error;
    });
}
