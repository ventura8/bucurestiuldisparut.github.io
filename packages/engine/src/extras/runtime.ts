/**
 * The page's extras loader (`loader.ts`): created the first time an extra is wanted, with the host installed on the page
 * (`host.ts`) and the engine's folder `index.ts` gives it (`setExtrasBase`). The builds' generated `imports.ts` calls
 * `loadExtra` (`scripts/site/src/engine-extras.ts`).
 */
import { createLogger } from '@hcm/shared';

import { installExtrasHost } from './host.js';
import { createExtraLoader, type ExtraFile, type ExtraLoader } from './loader.js';

let base = '';
let loader: ExtraLoader | null = null;

/** The folder the extras are loaded from: the engine script's (`engineBaseOf`). */
export function setExtrasBase(folder: string): void {
    base = folder;
}

function pageLoader(scope: typeof globalThis): ExtraLoader {
    const host = installExtrasHost(scope);
    return createExtraLoader<HTMLScriptElement>({
        document: scope.document,
        base: () => base,
        registry: () => host.extras,
        log: createLogger('engine').child('extras'),
    });
}

/** Loads one extra of the build, once (`loader.ts`). */
export function loadExtra(extra: ExtraFile): Promise<unknown> {
    loader ??= pageLoader(globalThis);
    return loader(extra);
}
