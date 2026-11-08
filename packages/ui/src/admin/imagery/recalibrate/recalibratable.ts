/** M16 (`docs/research/M16-recalibrate.md` §7): which versions the page offers to calibrate again (the server's own check is `recalibrate.ts`). */
import type { VersionViewPort } from '../imagery-port.js';

const FROM: ReadonlySet<VersionViewPort['state']> = new Set(['published', 'awaiting_approval']);

/** Published or waiting, with a scan and a fit of pairs; a join (no scan) is refined frame by frame. */
export function recalibratable(version: VersionViewPort): boolean {
    const pairs = version.georef !== null && version.georef.method !== 'embedded';
    return FROM.has(version.state) && version.hasScan && pairs;
}
