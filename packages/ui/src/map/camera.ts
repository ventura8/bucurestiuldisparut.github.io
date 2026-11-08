/**
 * Moving the camera of a Mapbox map for `MapPort.flyTo` and `fitBounds`: animated unless the visitor prefers reduced
 * motion or the caller says `animate: false` (then it jumps). An offset puts the target that many pixels from the map's
 * centre (the viewer's Locate keeps a photo's place clear of the sheet); `jumpTo` has none, so that jump is an `easeTo` of no
 * duration.
 */
import type { BBox, MapView } from '@hcm/shared';

import type { CameraOffset, MapboxMap } from './mapbox-types.js';

/** Whether a camera move animates. */
export function animates(options: { readonly animate?: boolean } | undefined, reducedMotion: boolean): boolean {
    return options?.animate !== false && !reducedMotion;
}

export function moveCamera(map: MapboxMap, view: Partial<MapView>, animate: boolean, offset?: CameraOffset): void {
    const camera = offset === undefined ? { ...view } : { ...view, offset };
    if (animate) {
        map.flyTo(camera);
    } else if (offset === undefined) {
        map.jumpTo(camera);
    } else {
        map.easeTo({ ...camera, duration: 0 });
    }
}

export function fitCamera(map: MapboxMap, bounds: BBox, padding: number, animate: boolean): void {
    map.fitBounds([bounds[0], bounds[1]], { padding, animate });
}
