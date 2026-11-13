/**
 * The viewer's compass (the owner, 2026-11-13: "a compass for the viewer … clicking on it resets to north up"; scenario
 * V64, docs/ENGINE_API.md → *Compass*): what its needle draws, the camera's bearing and tilt on every frame the camera
 * moves, and the reset to north up and level. The store's `watchCamera` and `resetNorth` are these, so the store stays
 * within its length.
 */
import type { MapView } from '@hcm/shared';
import type { FlyOptions, Unsubscribe, ViewerMapPort } from '@hcm/ui/map';

/** What the compass draws: degrees clockwise from north, `[0, 360)`, and the tilt in degrees (0 looks straight down). */
export interface MapCamera {
    readonly bearing: number;
    readonly pitch: number;
}

/** Under a twentieth of a degree the needle and the address both say north (the hash keeps one decimal). */
const NORTH_TOLERANCE = 0.05;

/** The camera of `map` (its `view` when a `move` already carries it). */
export function cameraOf(map: ViewerMapPort, view: MapView = map.getView()): MapCamera {
    return { bearing: view.bearing, pitch: map.getPitch() };
}

/** True when the camera faces north and looks straight down: the compass's press then changes nothing. */
export function isNorthUp({ bearing, pitch }: MapCamera): boolean {
    return Math.min(bearing, 360 - bearing) < NORTH_TOLERANCE && pitch < NORTH_TOLERANCE;
}

/** `listener` gets the camera now and on every frame it moves (Mapbox's `move`: a drag, a turn, a flight, compare's sync). */
export function watchCamera(map: ViewerMapPort, listener: (camera: MapCamera) => void): Unsubscribe {
    listener(cameraOf(map));
    return map.on('move', (view) => {
        listener(cameraOf(map, view));
    });
}

/** The store's compass actions (`ViewerStore` extends them). */
export interface CompassActions {
    /**
     * The compass (V64): turns the camera back to north up and level (bearing and tilt 0), animated unless reduced motion;
     * already there, nothing moves. The hash follows from the camera's `moveend`; in swipe compare the second map follows.
     */
    resetNorth(): void;
    /** The compass's needle: `listener` gets the camera's bearing and tilt now and on every frame the camera moves. */
    watchCamera(listener: (camera: MapCamera) => void): Unsubscribe;
}

/** How the camera flies: `Boot.flyMap`, which reads reduced motion when the button is pressed. */
interface Flyer {
    flyMap(view: Partial<MapView>, options?: FlyOptions): boolean;
}

/**
 * The compass's press: bearing 0 and tilt 0, or nothing at all when the camera is already there (the address keeps what
 * it says). True when the camera moved.
 */
export function resetNorth(map: ViewerMapPort, flyer: Flyer): boolean {
    if (isNorthUp(cameraOf(map))) {
        return false;
    }
    flyer.flyMap({ bearing: 0 }, { pitch: 0 });
    return true;
}
