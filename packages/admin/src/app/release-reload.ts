/**
 * What the shell does once Hosting serves a newer admin (finding 29 of 2026-10-31; M18 item 1,
 * `docs/research/M18-improvements.md`): the tab used to keep the release it booted with until the owner reloaded, so
 * Home's and Setup's Update the map, which compare the installed release with the admin's own, stayed hidden after a
 * deploy. Now the tab reloads by itself when no one is looking at it or the owner has just come back to it (the newer
 * release seen within `RETURN_WINDOW_MS` of the tab becoming visible, or on any later return), and only when no edit
 * would be lost; otherwise the Reload banner stays up as before. The sign-in lives in the tab's `sessionStorage`, so it
 * survives the reload.
 */
import type { Logger } from '@hcm/shared';

import type { ShellStateAccess } from '../state/state.js';
import type { Clock, HashLocation, PageVisibility } from './ports.js';
import type { ReleaseWatch } from './release-watch.js';

/** A newer release seen this long after the tab became visible again is the owner's return, not work under way. */
export const RETURN_WINDOW_MS = 10_000;

export interface ReleaseFollowDeps {
    /** Finding 29: a newer admin served; none: nothing is watched. */
    readonly releases?: Pick<ReleaseWatch, 'onNewer' | 'stop'> | undefined;
    readonly visibility: PageVisibility;
    readonly clock: Pick<Clock, 'now'>;
    readonly location: Pick<HashLocation, 'reload'>;
    /** An edit on screen, or an upload still being sent, that a reload would lose. */
    readonly unsaved: () => boolean;
    readonly log: Pick<Logger, 'info'>;
}

/** Follows the watch: a reload by itself when it is safe, else the shell's Reload banner. The returned call ends it. */
export function followReleases(deps: ReleaseFollowDeps, shell: ShellStateAccess): () => void {
    const releases = deps.releases;
    if (releases === undefined) {
        return () => undefined;
    }
    let returnedAt = Number.NEGATIVE_INFINITY;
    let newer: string | null = null;
    const reloadIfSafe = (): boolean => {
        if (deps.unsaved()) {
            return false;
        }
        deps.log.info('the admin reloads itself into the newer release', { release: newer });
        deps.location.reload();
        return true;
    };
    const stopVisibility = deps.visibility.onChange((visible) => {
        if (!visible) {
            return;
        }
        returnedAt = deps.clock.now();
        if (newer !== null) {
            reloadIfSafe();
        }
    });
    const stopNewer = releases.onNewer((release) => {
        newer = release;
        const away = !deps.visibility.visible() || deps.clock.now() - returnedAt <= RETURN_WINDOW_MS;
        if (!(away && reloadIfSafe())) {
            shell.update({ newRelease: release });
        }
    });
    return () => {
        stopNewer();
        stopVisibility();
        releases.stop();
    };
}
