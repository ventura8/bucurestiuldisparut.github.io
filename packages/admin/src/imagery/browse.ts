/**
 * The scenes' browse images (`docs/research/M3-interfaces.md` §3.4): no USGS address ever reaches the browser, so a
 * scene's image is the copy in the private bucket, read with the Storage SDK as a `blob:` address. The list shows the
 * copies that exist (the harvest copies the best-ranked ones ahead); the scene's detail asks `imagery.browse` to copy a
 * missing one first, and a failure says the preview is unavailable with Try again (`S-A11-BAD-BROWSE-UNAVAILABLE`).
 * Every address is released when the area closes.
 */
import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { callImagery, refusalOf } from './api.js';
import type { FilePort } from './files.js';
import type { SceneItem } from './model.js';

export type BrowseImage =
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly url: string }
    | { readonly status: 'failed'; readonly error: NoticeInput };

/** The list loads at most this many thumbnails (the first scenes it shows). */
const LIST_THUMBNAILS = 24;

const UNAVAILABLE: BrowseImage = { status: 'failed', error: { key: 'apiError.imagery.browseUnavailable' } };

/** A scene's copy in our bucket, when the harvest made one. */
function copiedPath(scene: SceneItem): string | null {
    return scene.browse.state === 'copied' ? scene.browse.path : null;
}

export class BrowseImages {
    readonly #services: ContentServices;
    readonly #files: FilePort;
    readonly #changed: (images: Readonly<Record<string, BrowseImage>>) => void;
    readonly #images = new Map<string, BrowseImage>();
    readonly #paths = new Map<string, string>();
    /** Bumped by `clear`: an address that arrives for an older opening is released at once. */
    #generation = 0;

    constructor(services: ContentServices, files: FilePort, changed: (images: Readonly<Record<string, BrowseImage>>) => void) {
        this.#services = services;
        this.#files = files;
        this.#changed = changed;
    }

    /** The bucket path of a scene's copy, once known. */
    pathOf(id: string): string | null {
        return this.#paths.get(id) ?? null;
    }

    /** The list's thumbnails: the copies that exist, for the first scenes shown. */
    thumbnails(scenes: readonly SceneItem[]): void {
        for (const scene of scenes.slice(0, LIST_THUMBNAILS)) {
            const path = copiedPath(scene);
            if (path !== null && !this.#images.has(scene.id)) {
                void this.#load(scene.id, path, this.#generation);
            }
        }
    }

    /** The detail's image: copied first when the harvest made no copy. */
    async open(scene: SceneItem): Promise<void> {
        if (this.#images.has(scene.id)) {
            return;
        }
        this.#set(scene.id, { status: 'loading' });
        const generation = this.#generation;
        try {
            await this.#load(scene.id, copiedPath(scene) ?? (await this.#copy(scene.id)), generation);
        } catch (error) {
            if (generation === this.#generation) {
                this.#set(scene.id, { status: 'failed', error: refusalOf(error) });
            }
        }
    }

    /** Try again after a failure. */
    retry(scene: SceneItem): Promise<void> {
        this.#forget(scene.id);
        return this.open(scene);
    }

    /** The area closed: every address is released. */
    clear(): void {
        this.#generation += 1;
        for (const id of [...this.#images.keys()]) {
            this.#forget(id);
        }
        this.#paths.clear();
        this.#emit();
    }

    async #copy(entityId: string): Promise<string> {
        const answer = await callImagery(this.#services.callables, 'imagery.browse', { cityId: this.#services.cityId, entityId });
        return answer.path;
    }

    async #load(id: string, path: string, generation: number): Promise<void> {
        if (generation !== this.#generation) {
            return;
        }
        this.#paths.set(id, path);
        this.#set(id, { status: 'loading' });
        const url = await this.#files.url(path);
        if (generation !== this.#generation) {
            this.#release(url);
            return;
        }
        this.#set(id, url === null ? UNAVAILABLE : { status: 'ready', url });
    }

    #release(url: string | null): void {
        if (url !== null) {
            this.#files.release(url);
        }
    }

    #forget(id: string): void {
        const image = this.#images.get(id);
        this.#release(image?.status === 'ready' ? image.url : null);
        this.#images.delete(id);
    }

    #set(id: string, image: BrowseImage): void {
        this.#images.set(id, image);
        this.#emit();
    }

    #emit(): void {
        this.#changed(Object.fromEntries(this.#images));
    }
}
