/**
 * The georeferencer's live warped preview (`docs/research/M3-interfaces.md` §10.4): the scan preview drawn through the
 * current fit into a canvas over the box the fitted scan covers, which the map shows as a canvas source. The box is
 * regular in EPSG:3857 (the canvas maps linearly onto the map), cut into `previewMesh`'s quads; each quad is two
 * triangles from the decoded preview into the canvas (`triangleTransform`).
 */
import {
    geoToMercator,
    previewMesh,
    scanBounds,
    triangleTransform,
    type BBox,
    type FittedTransform,
    type MeshQuad,
    type PlanePoint,
} from '@hcm/shared';

import type { PictureTriangle } from '../imagery/files.js';

/** The warped canvas's long side, in pixels. */
export const WARP_MAX_SIDE = 1024;

/** Quads per side of the mesh: enough to bend through a second-order fit or a spline. */
export const WARP_CELLS = 16;

export interface WarpFrame {
    readonly bounds: BBox;
    readonly width: number;
    readonly height: number;
}

interface Size {
    readonly width: number;
    readonly height: number;
}

/** The canvas over the box the fitted scan covers. */
export function warpFrame(transform: FittedTransform, scan: Size): WarpFrame {
    const bounds = scanBounds(transform, scan);
    const [[west, south], [east, north]] = bounds;
    const low = geoToMercator({ lat: south, lng: west });
    const high = geoToMercator({ lat: north, lng: east });
    const across = Math.max(high.x - low.x, 1e-9);
    const up = Math.max(high.y - low.y, 1e-9);
    const scale = WARP_MAX_SIDE / Math.max(across, up);
    return { bounds, width: Math.max(1, Math.round(across * scale)), height: Math.max(1, Math.round(up * scale)) };
}

type Triangle = readonly [PlanePoint, PlanePoint, PlanePoint];

/** A place of the frame's box as a pixel of its canvas (y down from the north). */
function canvasPoint(frame: WarpFrame, geo: MeshQuad['geo'][number]): PlanePoint {
    const [[west, south], [east, north]] = frame.bounds;
    const low = geoToMercator({ lat: south, lng: west });
    const high = geoToMercator({ lat: north, lng: east });
    const at = geoToMercator(geo);
    return { x: ((at.x - low.x) / (high.x - low.x)) * frame.width, y: ((high.y - at.y) / (high.y - low.y)) * frame.height };
}

function triangle(source: Triangle, target: Triangle): PictureTriangle | null {
    const transform = triangleTransform(source, target);
    return transform === null
        ? null
        : {
              clip: [
                  [target[0].x, target[0].y],
                  [target[1].x, target[1].y],
                  [target[2].x, target[2].y],
              ],
              transform,
          };
}

type Four = readonly [PlanePoint, PlanePoint, PlanePoint, PlanePoint];

/** The two triangles of one quad (north-west, north-east, south-east; north-west, south-east, south-west). */
function quadTriangles(quad: MeshQuad, frame: WarpFrame, scale: PlanePoint): (PictureTriangle | null)[] {
    const target = quad.geo.map((geo) => canvasPoint(frame, geo)) as unknown as Four;
    const source = quad.pixel.map((pixel) => ({ x: pixel.x * scale.x, y: pixel.y * scale.y })) as unknown as Four;
    return [
        triangle([source[0], source[1], source[2]], [target[0], target[1], target[2]]),
        triangle([source[0], source[2], source[3]], [target[0], target[2], target[3]]),
    ];
}

/** The triangles that draw a `source`-sized decoding of a `scan`-sized scan into the frame. */
export function warpTriangles(transform: FittedTransform, frame: WarpFrame, scan: Size, source: Size): PictureTriangle[] {
    const scale = { x: source.width / scan.width, y: source.height / scan.height };
    return previewMesh(transform, frame.bounds, WARP_CELLS)
        .flatMap((quad) => quadTriangles(quad, frame, scale))
        .filter((part): part is PictureTriangle => part !== null);
}
