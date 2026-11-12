/**
 * The store's side of the linked views (`./linked-views.ts`, in the lazy chunk): the first pane move once a fit exists fetches the
 * chunk, the latest move made meanwhile is played once it is in, and from then on every move goes to its `ViewLink`. The map's
 * camera before that move (as the map first showed, or its previous `move`) is handed over with it, so a first move that starts on
 * the map (one jump, one `move`, under reduced motion) still moves the scan. A failed fetch is logged and the panes simply stay
 * unlinked for the visit.
 */
import type { FittedTransform } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import type { Store } from '../state/store.js';
import { chunkOf, type ExtrasLoader } from './extras.js';
import type { GeorefMap } from './georef-map.js';
import type { LinkPorts, MapCamera, ScanCamera, ViewLink } from './linked-views.js';
import type { GeorefState } from './state.js';

/** Runs a callback at the next animation frame (a seam for the tests). */
export type FrameScheduler = LinkPorts['frame'];

export const ANIMATION_FRAME: FrameScheduler = (run) => {
    requestAnimationFrame(run);
};

export interface LinkDeps {
    readonly services: Pick<ContentServices, 'cityId' | 'callables' | 'notify' | 'log'>;
    readonly extras: ExtrasLoader;
    readonly ports: LinkPorts;
}

export class LinkedPanes {
    readonly #deps: LinkDeps;
    #link: ViewLink | null = null;
    #loading = false;
    /** The latest move made while the chunk loads (a quick zoom is over before it is in). */
    #waiting: ((link: ViewLink) => void) | null = null;
    /** The map's camera last seen before the chunk is in (null: none yet). */
    #mapSeen: MapCamera | null = null;

    constructor(deps: LinkDeps) {
        this.#deps = deps;
    }

    scan(camera: ScanCamera): void {
        this.#use((link) => {
            link.scan(camera);
        });
    }

    /** The map shows `camera` without a move of the owner's (it has just been made). */
    seen(camera: MapCamera): void {
        if (this.#link === null) {
            this.#mapSeen = camera;
            return;
        }
        this.#link.seen(camera);
    }

    map(camera: MapCamera): void {
        if (this.#link !== null) {
            this.#link.map(camera);
            return;
        }
        const before = this.#mapSeen;
        this.#mapSeen = camera;
        this.#use((link) => {
            if (before !== null) {
                link.seen(before);
            }
            link.map(camera);
        });
    }

    #use(run: (link: ViewLink) => void): void {
        if (this.#link !== null) {
            run(this.#link);
            return;
        }
        this.#waiting = run;
        if (!this.#loading && this.#deps.ports.transform() !== null) {
            this.#loading = true;
            void this.#load();
        }
    }

    async #load(): Promise<void> {
        const chunk = await chunkOf(this.#deps.services, this.#deps.extras);
        if (chunk !== null) {
            this.#link = new chunk.ViewLink(this.#deps.ports);
            this.#waiting?.(this.#link);
        }
    }
}

interface StoreSide {
    readonly services: LinkDeps['services'];
    readonly extras: ExtrasLoader;
    readonly frame: FrameScheduler;
    readonly map: GeorefMap;
    readonly cell: Store<GeorefState>;
    /** The store's fit now (null: none). */
    readonly transform: () => FittedTransform | null;
}

/** The georeferencer store's linked panes: on while `linked` and no map point is dragged; the scan pane follows through `scanFollow`. */
export function linkedPanesOf({ services, extras, frame, map, cell, transform }: StoreSide): LinkedPanes {
    return new LinkedPanes({
        ...{ services, extras },
        ports: {
            transform,
            active: () => cell.state.linked && !map.dragging,
            moveMap: (camera) => {
                map.follow(camera);
            },
            moveScan: (scanFollow) => {
                cell.update({ scanFollow });
            },
            frame,
        },
    });
}
