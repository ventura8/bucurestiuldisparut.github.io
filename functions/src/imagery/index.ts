/**
 * The `imagery.*` functions (`docs/research/M3-interfaces.md` §9): the callables of the Imagery area, the georeferencer
 * and the layer editor; the dispatcher on job writes, the raster upload trigger, the publisher's task queue and the
 * five-minute tick. `functions/src/index.ts` exports `imagery = imageryFunctions(getDeps, bucket)`, which deploys
 * `imagery-search`, `imagery-browse`, ..., `imagery-tick`.
 */
import type { CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { approveFunction, rejectFunction } from './approve.js';
import { browseFunction } from './browse.js';
import { cropFunction } from './crop.js';
import { importFunction } from './import.js';
import { onJobWriteFunction } from './on-job-write.js';
import { onRasterUploadFunction } from './on-raster-upload.js';
import { probeTilesFunction } from './probe.js';
import { publishFunction } from './publish.js';
import { resumeGuardFunction } from './resume-guard.js';
import { retryFunction } from './retry.js';
import { saveGcpsFunction } from './save-gcps.js';
import { searchFunction } from './search.js';
import { chooseFunction, studioDoneFunction } from './studio.js';
import { tickFunction, type TickDeps } from './tick.js';

/** Every port the family uses (the union of its functions' own `Pick<Ports, …>`). */
export type ImageryFamilyDeps = CallableDeps & TickDeps & Pick<Ports, 'reader'>;

export function imageryFunctions(getDeps: () => ImageryFamilyDeps, bucket?: string) {
    return {
        search: searchFunction(getDeps),
        browse: browseFunction(getDeps),
        import: importFunction(getDeps),
        approve: approveFunction(getDeps),
        reject: rejectFunction(getDeps),
        choose: chooseFunction(getDeps),
        studioDone: studioDoneFunction(getDeps),
        saveGcps: saveGcpsFunction(getDeps),
        crop: cropFunction(getDeps),
        retry: retryFunction(getDeps),
        probeTiles: probeTilesFunction(getDeps),
        resumeGuard: resumeGuardFunction(getDeps),
        onJobWrite: onJobWriteFunction(getDeps),
        onRasterUpload: onRasterUploadFunction(getDeps, bucket),
        publish: publishFunction(getDeps),
        tick: tickFunction(getDeps),
    };
}
