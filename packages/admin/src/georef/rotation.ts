/**
 * The georeferencer's panes turned together (`docs/research/M3-interfaces.md` §10.4, 2026-11-12): once the pairs give a fit, the scan
 * is shown turned as the map shows the same ground. The fit says which way the scan's x axis points on a north-up map (`fitAngle`);
 * a map of bearing `b` shows everything turned by `-b`, so the scan's angle is `fitAngle - b`, and the map bearing that suits a scan
 * turned by `a` is `fitAngle - a`. Angles of the scan are radians clockwise in the pane, bearings degrees as Mapbox has them.
 */
import { geoToMercator, type FittedTransform, type PixelPoint } from '@hcm/shared';

const DEGREES = 180 / Math.PI;

/** Which way the scan's x axis points on a north-up map at `pixel`: radians clockwise from the map's right. */
export function fitAngle(transform: FittedTransform, pixel: PixelPoint): number {
    const at = geoToMercator(transform.toGeo(pixel));
    const right = geoToMercator(transform.toGeo({ x: pixel.x + 1, y: pixel.y }));
    // Web Mercator's y grows to the north, a pane's y down.
    return Math.atan2(at.y - right.y, right.x - at.x);
}

/** A bearing within -180 … 180 degrees. */
function wrapped(degrees: number): number {
    return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** The map bearing (degrees) that shows the ground as a scan turned by `angle` radians shows it at `pixel`; null where the fit has no place. */
export function bearingFor(transform: FittedTransform, pixel: PixelPoint, angle: number): number | null {
    const bearing = wrapped((fitAngle(transform, pixel) - angle) * DEGREES);
    return Number.isFinite(bearing) ? bearing : null;
}

/** The scan's angle (radians) that shows the ground as a map of `bearing` degrees shows it at `pixel`; null where the fit has no place. */
export function angleFor(transform: FittedTransform, pixel: PixelPoint, bearing: number): number | null {
    const angle = fitAngle(transform, pixel) - bearing / DEGREES;
    return Number.isFinite(angle) ? angle : null;
}
