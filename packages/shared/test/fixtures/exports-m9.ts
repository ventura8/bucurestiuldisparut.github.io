/** M9 (`docs/research/M9-calibration.md`): the public API of calibration, for `index.test.ts`. */
import { M13_EXPORTS } from './exports-m13.js';

export const M9_EXPORTS = [
    ...M13_EXPORTS,
    'CALIBRATION_HOWS',
    'CALIBRATION_OUTLINE_MAX',
    'CALIBRATION_REFUSALS',
    'CHECKPOINT_KINDS',
    'AUTO_MIN_MEASURED_PCT',
    'measuredOutlineSchema',
    'CITY_MIN_COVERAGE_PCT',
    'calibrationModelSchema',
    'calibrationSchema',
    'imageryPassDocSchema',
    'passKeyOf',
    'passPrefixOf',
    // M12 (docs/research/M12-own-tiles.md): the own tiles' contracts.
    'IMAGERY_PREVIEW_URL_SECONDS',
    'SIDE_JOB_TYPES',
    'exportTilesPath',
    'imageryPreviewUrlResponseSchema',
    'isSideJob',
    'layerTilesParamsSchema',
    'versionTilesSchema',
] as const;
