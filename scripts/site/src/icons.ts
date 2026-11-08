import { DEFAULT_FAVICON_DATA_URL, STORAGE_PATHS, publicObjectUrl } from '@hcm/shared';

import { element, type HtmlElement } from './html.js';

/**
 * The tab icon of every page the build writes (the owner, 2026-11-08: the Layers panel's map glyph by default, and a
 * city's admins can change it; `docs/ENGINE_API.md` → *The page's tab icon*):
 *
 * - a city site that reads the public bucket links straight to its city's icon there (`STORAGE_PATHS.cityIcon`, fixed
 *   names `cities.setIcon` overwrites with a five-minute cache), so a new icon reaches the tab without a deploy;
 * - every other page (a site built without a bucket, the generic `/city/` page until its city's icon loads, the admin,
 *   the start page, 404 and start-up) inlines the default (`DEFAULT_FAVICON_DATA_URL`, the glyph in the project's
 *   colour): their policies allow `data:` images, and nothing is fetched.
 */
export interface PageIcons {
    /** The 32 px icon of the tab. */
    readonly favicon: string;
    /** The 180 px icon a phone's home screen takes; none for the default. */
    readonly appleTouch?: string;
}

export const DEFAULT_PAGE_ICONS: PageIcons = { favicon: DEFAULT_FAVICON_DATA_URL };

/** The icons of `cityId` in the public bucket. */
export function bucketIcons(bucket: string, cityId: string): PageIcons {
    return {
        favicon: publicObjectUrl(bucket, STORAGE_PATHS.cityIcon(cityId, 32)),
        appleTouch: publicObjectUrl(bucket, STORAGE_PATHS.cityIcon(cityId, 180)),
    };
}

/** The `<link>`s of the page's head. */
export function iconLinks(icons: PageIcons = DEFAULT_PAGE_ICONS): HtmlElement[] {
    const touch = icons.appleTouch === undefined ? [] : [element('link', { rel: 'apple-touch-icon', href: icons.appleTouch })];
    return [element('link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: icons.favicon }), ...touch];
}
