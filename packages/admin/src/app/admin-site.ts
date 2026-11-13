/**
 * Where the admin runs (the owner's decision of 2026-11-13, `DECISIONS-for-review.md` §210): on the project's own admin
 * site (`https://<project>-admin.web.app/admin/`), whose origin no public map page shares, or under the public map's
 * `/admin/` (a project without that site: a self-hosted copy, a first deploy, a site the installer could not create). The
 * site build writes the admin site's origin into the `runtime.json` it deploys there (`adminOrigin`), so the admin is on
 * its own site exactly when the page's origin is that one: nothing a viewer page serves can make an admin think so.
 */
import { hostingOrigins } from '../install/bundle.js';
import type { AdminRuntime } from './config.js';

/** Whether the page runs on the admin's own site: `runtime.json` names this very origin. */
export function onOwnSite(runtime: Pick<AdminRuntime, 'adminOrigin'>, origin: string): boolean {
    return runtime.adminOrigin !== undefined && runtime.adminOrigin === origin;
}

/** A Hosting host name's site id (`<site>.web.app` or `<site>.firebaseapp.com`), or null for any other host. */
function hostingSiteOf(origin: string): string | null {
    const match = /^https:\/\/([a-z0-9-]{6,30})\.(?:web\.app|firebaseapp\.com)$/.exec(origin);
    return match?.[1] ?? null;
}

/** The admin's own Hosting site id when the page runs on it (and it is a Hosting address), else null. */
export function ownSiteId(runtime: Pick<AdminRuntime, 'adminOrigin'>, origin: string): string | null {
    return onOwnSite(runtime, origin) ? hostingSiteOf(origin) : null;
}

/**
 * The public map's origin: the project's default site when the admin runs on its own site, else the page's own (the
 * public map and the admin share it).
 */
export function publicOrigin(projectId: string, runtime: Pick<AdminRuntime, 'adminOrigin'>, origin: string): string {
    return onOwnSite(runtime, origin) && hostingSiteOf(origin) !== null ? `https://${projectId}.web.app` : origin;
}

/** `runtime.json`'s release and build time, as the Setup Assistant installs them (M6; finding 39 of 2026-11-01). */
export function adminReleaseFields(runtime: Pick<AdminRuntime, 'release' | 'releaseTime'>): {
    readonly release: string;
    readonly releaseTime: number | null;
} {
    return { release: runtime.release, releaseTime: runtime.releaseTime ?? null };
}

/**
 * Where the admin may install from (the project's Hosting origins, the admin's own site's among them; the e2e world's own
 * origin in its build) and the admin's own site when the page runs on it, which the server build then names to the
 * functions (`HCM_ADMIN_SITE`): only a page served from that site proves the site is this project's.
 */
export function installPlace(
    projectId: string,
    runtime: Pick<AdminRuntime, 'adminOrigin'>,
    origin: string,
    production: boolean,
): { readonly installOrigins: readonly string[]; readonly adminSite: string | null } {
    return { installOrigins: production ? hostingOrigins(projectId) : [origin], adminSite: ownSiteId(runtime, origin) };
}

/** On the admin's own site, names the public map's root on the page (`<html data-hcm-public-map>`) for its links. */
export function markPublicMap(doc: Document, projectId: string, runtime: Pick<AdminRuntime, 'adminOrigin'>, origin: string): void {
    if (onOwnSite(runtime, origin)) {
        doc.documentElement.dataset['hcmPublicMap'] = `${publicOrigin(projectId, runtime, origin)}/`;
    }
}
