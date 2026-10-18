/**
 * `@hcm/ui/map/draw`: the admin's drawing tools (docs/research/M2c-interfaces.md §4), an entry of their own so the
 * viewer never loads them (dependency-cruiser `viewer-never-loads-the-draw-tools`). `MapDrawPort` and the DOM-free
 * geometry rules the editors share with it; the Terra Draw adapter, which the admin creates once it has loaded Terra
 * Draw lazily.
 */
export type { DrawChange, DrawLimits, DrawMode, DrawnFeature, DrawOptions, DrawRefusal, DrawShape, MapDrawPort } from './draw-port.js';
export {
    DRAW_DECIMALS,
    checkGeometry,
    checkPositions,
    polygonCrossesItself,
    ringArea,
    roundGeometry,
    roundPosition,
    segmentsMeet,
} from './rules.js';
export { CLICK_DRAW_OVERLAY_ID, createClickDrawPort, drawnPositions, shapeGeometry } from './click-draw-adapter.js';
export { createTerraDrawPort } from './terra-draw-adapter.js';
export type { TerraDrawModules } from './terra-draw-types.js';
