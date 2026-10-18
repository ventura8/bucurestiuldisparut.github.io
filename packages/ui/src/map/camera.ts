/**
 * Moving the camera of a Mapbox map for `MapPort.flyTo` and `fitBounds`: animated unless the visitor prefers reduced
 * motion or the caller says `animate: false` (then it jumps).
 */
import type { BBox, MapView } from '@hcm/shared';

import type { MapboxMap } from './mapbox-types.js';

/** Whether a camera move animates. */
export function animates(options: { readonly animate?: boolean } | undefined, reducedMotion: boolean): boolean {
    return options?.animate !== false && !reducedMotion;
}

export function moveCamera(map: MapboxMap, view: Partial<MapView>, animate: boolean): void {
    const camera = { ...view };
    if (animate) {
        map.flyTo(camera);
    } else {
        map.jumpTo(camera);
    }
}

export function fitCamera(map: MapboxMap, bounds: BBox, padding: number, animate: boolean): void {
    map.fitBounds([bounds[0], bounds[1]], { padding, animate });
}
