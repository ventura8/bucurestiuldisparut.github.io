/**
 * The shell's page registry (`docs/research/M2b-interfaces.md` §1.1): a route shows the custom element its loader
 * resolves, imported lazily, so a later workstream adds a page (`registerAdminPage`) without touching the shell. A route
 * without a page stays out of the navigation and opens Setup.
 */
import type { AdminRouteId } from './routes.js';

/** Resolves the tag of the page's custom element once its module is loaded and the element defined. */
export type PageLoader = () => Promise<string>;

/** A page element's tag: the kit's `hcm-` prefix, lower case (it is created with `document.createElement`). */
const PAGE_TAG = /^hcm-[a-z0-9]+(?:-[a-z0-9]+)+$/;

export class PageRegistry {
    readonly #loaders = new Map<AdminRouteId, PageLoader>();

    /** Adds (or replaces) the page of `id`. */
    register(id: AdminRouteId, load: PageLoader): void {
        this.#loaders.set(id, load);
    }

    has(id: AdminRouteId): boolean {
        return this.#loaders.has(id);
    }

    /** The page's tag; null when no page is registered, its module fails to load or it names no `hcm-` element. */
    async load(id: AdminRouteId): Promise<string | null> {
        const load = this.#loaders.get(id);
        try {
            const tag = load === undefined ? null : await load();
            return tag !== null && PAGE_TAG.test(tag) ? tag : null;
        } catch {
            return null;
        }
    }
}
