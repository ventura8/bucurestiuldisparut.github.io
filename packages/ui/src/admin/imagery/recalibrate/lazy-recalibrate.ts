/**
 * M16 (`docs/research/M16-recalibrate.md` §7): a version's Calibrate again block as a chunk of its own (the admin's `recalibrate-card-<hash>.js`,
 * after `orders/lazy-card.ts`), fetched only on a page that offers it or shows a recalibration's figures, so the version's page chunk keeps its
 * budget.
 */
import type { TemplateResult } from 'lit';

import { EMPTY } from '../../shell/empty.js';
import type { ImageryContext } from '../context.js';
import type { VersionPagePort, VersionViewPort } from '../imagery-port.js';
import { chunkLoader, chunkTemplate, type ChunkLoader } from '../orders/lazy-card.js';
import type { recalibrateCard } from './recalibrate-card.js';
import { recalibratable } from './recalibratable.js';

export interface RecalibrateChunk {
    readonly recalibrateCard: typeof recalibrateCard;
}

export const RECALIBRATE_CHUNK: ChunkLoader<RecalibrateChunk> = chunkLoader(async () => import('./recalibrate-card.js'));

/** The block, when the version may be calibrated again or is a recalibration; else nothing, unfetched. */
export function lazyRecalibrate(
    context: ImageryContext,
    page: VersionPagePort,
    version: VersionViewPort,
    chunk: ChunkLoader<RecalibrateChunk> = RECALIBRATE_CHUNK,
): TemplateResult {
    const shown = version.recalibration !== null || recalibratable(version);
    return shown ? chunkTemplate(context, chunk, (loaded) => loaded.recalibrateCard(context, page, version)) : EMPTY;
}
