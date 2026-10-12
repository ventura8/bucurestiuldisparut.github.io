/**
 * The browser abilities the viewer uses besides the store: sharing the page, the clipboard, the visitor's position,
 * the page address and media queries. `<hcm-map-viewer>` takes them as one injectable `services` object, so tests
 * drive every outcome (granted, denied, outside the city, no Web Share API) without a real browser permission.
 *
 * The visitor's position never leaves the page: it moves the camera and is neither stored nor logged.
 */
import { bboxContains, type BBox, type LngLat, type MessageKey } from '@hcm/shared';

export interface ViewerServices {
    /** The Web Share API, when the browser has it. */
    readonly share: ((data: { readonly title: string; readonly url: string }) => Promise<void>) | null;
    /** Writes text to the clipboard. */
    readonly copyText: (text: string) => Promise<void>;
    /** The visitor's position; rejects with an object whose `code` is 1 when permission was denied. */
    readonly locate: () => Promise<LngLat>;
    /** The page address to share (the URL hash carries the viewer state). */
    readonly pageUrl: () => string;
    readonly matchMedia: (query: string) => MediaQueryList;
}

/** How long the browser may look for a position, and how old a cached one may be. */
const POSITION_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 };

function locateWith(geolocation: Geolocation | undefined): Promise<LngLat> {
    return new Promise((resolve, reject) => {
        if (geolocation === undefined) {
            reject(new Error('geolocation unavailable'));
            return;
        }
        geolocation.getCurrentPosition(
            (position) => {
                resolve([position.coords.longitude, position.coords.latitude]);
            },
            reject,
            POSITION_OPTIONS,
        );
    });
}

/** The real browser services of `win`. */
export function browserServices(win: Window): ViewerServices {
    const navigator = win.navigator as Partial<Navigator>;
    const share = navigator.share === undefined ? null : (data: ShareData) => win.navigator.share(data);
    return {
        share,
        copyText: (text) => win.navigator.clipboard.writeText(text),
        locate: () => locateWith(navigator.geolocation),
        pageUrl: () => win.location.href,
        matchMedia: (query) => win.matchMedia(query),
    };
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed';

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

async function copyLink(services: ViewerServices, url: string): Promise<ShareOutcome> {
    try {
        await services.copyText(url);
        return 'copied';
    } catch {
        return 'failed';
    }
}

/**
 * Shares the page: the Web Share API when there is one (closing its sheet is "cancelled", not an error), else, or
 * when it fails, the clipboard.
 */
export async function sharePage(services: ViewerServices, title: string): Promise<ShareOutcome> {
    const url = services.pageUrl();
    if (services.share === null) {
        return copyLink(services, url);
    }
    try {
        await services.share({ title, url });
        return 'shared';
    } catch (error: unknown) {
        return isAbort(error) ? 'cancelled' : copyLink(services, url);
    }
}

/** The message a share outcome shows; a completed or cancelled share needs none. */
export function shareMessage(outcome: ShareOutcome): MessageKey | null {
    if (outcome === 'copied') {
        return 'share.copied';
    }
    return outcome === 'failed' ? 'share.failed' : null;
}

export type LocateOutcome = { readonly ok: true; readonly center: LngLat } | { readonly ok: false; readonly code: MessageKey };

function isDenied(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { readonly code?: unknown }).code === 1;
}

/** The visitor's position when it lies inside `bounds`; otherwise why the camera cannot go there (no bounds: no city yet). */
export async function locateVisitor(services: ViewerServices, bounds: BBox | null): Promise<LocateOutcome> {
    if (bounds === null) {
        return { ok: false, code: 'error.geolocate.unavailable' };
    }
    try {
        const center = await services.locate();
        return bboxContains(bounds, center) ? { ok: true, center } : { ok: false, code: 'error.geolocate.outside' };
    } catch (error: unknown) {
        return { ok: false, code: isDenied(error) ? 'error.geolocate.denied' : 'error.geolocate.unavailable' };
    }
}

/**
 * The absolute address of a photo image: manifest image URLs are https or relative to the manifest, and an inline
 * manifest's are relative to the page. Null when the address cannot be resolved.
 */
export function resolveAssetUrl(path: string, manifestUrl: string, baseUri: string): string | null {
    try {
        return new URL(path, new URL(manifestUrl, baseUri)).href;
    } catch {
        return null;
    }
}
