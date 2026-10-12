import { onUploadFunction } from './on-upload.js';
import { reprocessFunction, type ReprocessDeps } from './reprocess.js';
import type { PhotoDeps } from './upload.js';

export type PhotosDeps = PhotoDeps & ReprocessDeps;

/**
 * The `photos.*` functions under their registry names (`docs/research/M2-interfaces.md` §3.6): the Storage trigger
 * `onUpload` on the private bucket (the project's default bucket unless `bucket` names one) and the admin's
 * `reprocess`. The integrator exports them as the `photos` group (`export const photos = photosFunctions(getDeps)`).
 */
export function photosFunctions(getDeps: () => PhotosDeps, bucket?: string) {
    return { onUpload: onUploadFunction(getDeps, bucket), reprocess: reprocessFunction(getDeps) };
}
