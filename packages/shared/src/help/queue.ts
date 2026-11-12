/**
 * The Help calibrate queue (`docs/research/M22-help-calibrate.md` §1.1): computed from the versions that already exist, never stored.
 * Today it covers the layer versions that wait for a person: an archive series whose tile layout needs the owner (`layoutCheck`, the
 * tile-import wizard `#/help/{versionId}/tiles`, M20 §16) first, then every version waiting for points (`needsPoints`, the
 * georeferencer). The photo and value rows of §1.1 and §1.2 join it later.
 */
import type { HelpItem } from '../schemas/imagery-archive.js';
import type { LayerVersionDoc } from '../schemas/imagery.js';

/** What an item asks of the person, in the queue's order. */
export const HELP_ITEM_CODES = ['layoutCheck', 'needsPoints'] as const;

export type HelpItemCode = (typeof HELP_ITEM_CODES)[number];

/** A version as the queue reads it. */
export interface HelpVersionInput {
    readonly id: string;
    readonly state: LayerVersionDoc['state'];
    readonly help?: Pick<HelpItem, 'reason'> | undefined;
}

/** One row of the queue: the version, what it asks, and the page that answers it. */
export interface HelpQueueItem {
    readonly versionId: string;
    readonly code: HelpItemCode;
    readonly page: 'tiles' | 'georef';
}

function itemOf(version: HelpVersionInput): HelpQueueItem {
    return version.help?.reason === 'layout-check'
        ? { versionId: version.id, code: 'layoutCheck', page: 'tiles' }
        : { versionId: version.id, code: 'needsPoints', page: 'georef' };
}

/** The versions that wait for a person, `layoutCheck` first, each group in the given order. */
export function helpItemsOf(versions: readonly HelpVersionInput[]): readonly HelpQueueItem[] {
    const items = versions.filter((version) => version.state === 'needs_gcps').map(itemOf);
    return [...items].sort((left, right) => HELP_ITEM_CODES.indexOf(left.code) - HELP_ITEM_CODES.indexOf(right.code));
}
