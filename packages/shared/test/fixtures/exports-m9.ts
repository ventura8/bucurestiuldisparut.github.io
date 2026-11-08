/** M9 (`docs/research/M9-calibration.md`): the public API of calibration, for `index.test.ts`. */
export const M9_EXPORTS = [
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
    // M15 (`docs/research/M15-calibration-accuracy.md`, *Joint solve*): the frames a fit was joined to.
    'ALIGNMENT_MAX_PARTNERS',
    'ALIGNMENT_STATUSES',
    'alignedWith',
    'calibrationAlignmentSchema',
    // M15, *Terrain*: the notice a layer fitted over the Copernicus DEM carries.
    'DEM_ATTRIBUTION',
] as const;
