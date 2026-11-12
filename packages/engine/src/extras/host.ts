/**
 * The host of the engine's extras (`loader.ts`): one global object, `__hcmEngineHost`, that the extras' scripts read the
 * engine's shared bindings from (Lit and `@hcm/shared`: one copy of each on the page, one catalogue state) and register
 * their exports on (`extras.<global>`). The extras' build maps `lit` to `__hcmEngineHost.lit` and `@hcm/shared` to
 * `__hcmEngineHost.shared` (`packages/engine/vite.config.ts`). The property is not enumerable: it is not part of the API.
 */
import * as lit from './host-lit.js';
import * as shared from './host-shared.js';

export const EXTRAS_HOST_GLOBAL = '__hcmEngineHost';

export interface ExtrasHost {
    readonly lit: typeof lit;
    readonly shared: typeof shared;
    readonly extras: Record<string, unknown>;
}

function isHost(value: unknown): value is ExtrasHost {
    return typeof value === 'object' && value !== null && 'extras' in value && 'lit' in value && 'shared' in value;
}

/** The scope's host, installed the first time (an engine loaded twice shares the first one's). */
export function installExtrasHost(scope: object): ExtrasHost {
    const existing: unknown = Reflect.get(scope, EXTRAS_HOST_GLOBAL);
    if (isHost(existing)) {
        return existing;
    }
    const host: ExtrasHost = { lit, shared, extras: {} };
    Object.defineProperty(scope, EXTRAS_HOST_GLOBAL, { value: host, writable: true, configurable: true, enumerable: false });
    return host;
}
