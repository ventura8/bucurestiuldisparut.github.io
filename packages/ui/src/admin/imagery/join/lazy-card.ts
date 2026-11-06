/**
 * The join's screens as a chunk of their own (M8, `docs/research/M8-join-interfaces.md` §6; after `orders/lazy-card.ts`):
 * the Imagery area's chunk stays within its budget, and `join-card.ts` (the admin's `join-card-<hash>.js`) is fetched the
 * first time a page has something of a join to show: the city has a plan of its dates, or the open version is a join or a frame
 * one named. A city with none of these never fetches it.
 */
import type { TemplateResult } from 'lit';

import { EMPTY } from '../../shell/empty.js';
import type { ImageryContext } from '../context.js';
import type { VersionViewPort } from '../imagery-port.js';
import { chunkTemplate, chunkLoader, type ChunkLoader } from '../orders/lazy-card.js';
import type { dateRows, joinReport, sceneOffer, versionJoin } from './join-card.js';

/** What the chunk gives the pages: its templates. */
export interface JoinCardChunk {
    readonly dateRows: typeof dateRows;
    readonly sceneOffer: typeof sceneOffer;
    readonly versionJoin: typeof versionJoin;
    readonly joinReport: typeof joinReport;
}

/** The join card's chunk: one dynamic `import()`, so the bundler splits it. */
export const JOIN_CARD_CHUNK: ChunkLoader<JoinCardChunk> = chunkLoader(async () => import('./join-card.js'));

function ofAJoin(version: VersionViewPort | null): boolean {
    return version !== null && (version.origin === 'join' || version.partOf !== null);
}

/** `render` over the chunk, while the city has a plan of its dates or `version` has to do with a join; else nothing, unfetched. */
export function lazyJoin(
    context: ImageryContext,
    version: VersionViewPort | null,
    render: (chunk: JoinCardChunk) => TemplateResult,
    chunk: ChunkLoader<JoinCardChunk> = JOIN_CARD_CHUNK,
): TemplateResult {
    return context.view.dates.length > 0 || ofAJoin(version) ? chunkTemplate(context, chunk, render) : EMPTY;
}
