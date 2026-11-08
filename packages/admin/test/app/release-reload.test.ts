// M18 item 1 (docs/research/M18-improvements.md): after a deploy the tab reloads into the newer admin by itself when no
// one is looking or the owner has just come back, and only when no edit would be lost; otherwise the Reload banner.
import { describe, expect, it, vi } from 'vitest';

import type { PageVisibility } from '../../src/app/ports.js';
import { followReleases, RETURN_WINDOW_MS } from '../../src/app/release-reload.js';
import type { ShellStateAccess } from '../../src/state/state.js';
import { FakeClock, testLog } from './fakes.js';

const NEWER = '1.0.1+abc1234';

class SwitchedVisibility implements PageVisibility {
    shown = true;
    readonly listeners = new Set<(visible: boolean) => void>();

    visible(): boolean {
        return this.shown;
    }

    onChange(listener: (visible: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    set(visible: boolean): void {
        this.shown = visible;
        for (const listener of [...this.listeners]) {
            listener(visible);
        }
    }
}

function world(options: { shown?: boolean; unsaved?: boolean } = {}) {
    const clock = new FakeClock();
    const visibility = new SwitchedVisibility();
    visibility.shown = options.shown ?? true;
    const state = { unsaved: options.unsaved ?? false, reloads: 0, banner: null as string | null };
    const heard: { listener?: (release: string) => void } = {};
    const stopNewer = vi.fn();
    const releases = {
        onNewer: vi.fn((listener: (release: string) => void) => {
            heard.listener = listener;
            return stopNewer;
        }),
        stop: vi.fn(),
    };
    const shell = {
        update: (patch: { newRelease?: string | null }) => {
            state.banner = patch.newRelease ?? null;
        },
    } as unknown as ShellStateAccess;
    const { log, recording } = testLog();
    const stop = followReleases(
        {
            ...{ releases, visibility, clock, log },
            location: {
                reload: () => {
                    state.reloads += 1;
                },
            },
            unsaved: () => state.unsaved,
        },
        shell,
    );
    const serve = (): void => {
        heard.listener?.(NEWER);
    };
    return { clock, visibility, state, serve, stop, releases, stopNewer, recording };
}

describe('followReleases: a reload by itself', () => {
    it('happyPath_theOwnerComesBackAfterADeploy_theTabReloadsWithoutABanner', () => {
        const w = world({ shown: false });
        w.visibility.set(true);
        w.clock.advance(RETURN_WINDOW_MS - 1);
        w.serve();
        expect(w.state.reloads).toBe(1);
        expect(w.state.banner).toBeNull();
        expect(w.recording.records.at(-1)).toMatchObject({ level: 'info', message: 'the admin reloads itself into the newer release' });
    });

    it('happyPath_aHiddenTabThatHearsOfANewerAdminReloadsAtOnce', () => {
        const w = world({ shown: false });
        w.serve();
        expect(w.state.reloads).toBe(1);
    });

    it('happyPath_aBannerShownWhileWorking_theNextReturnToTheTabReloads', () => {
        const w = world();
        w.serve();
        expect(w.state.banner).toBe(NEWER);
        expect(w.state.reloads).toBe(0);
        w.visibility.set(false);
        expect(w.state.reloads).toBe(0);
        w.visibility.set(true);
        expect(w.state.reloads).toBe(1);
    });
});

describe('followReleases: the Reload banner instead', () => {
    it('badPath_aNewerAdminSeenWhileTheOwnerWorks_isTheBannerNotAReload', () => {
        const w = world();
        w.visibility.set(true);
        w.clock.advance(RETURN_WINDOW_MS + 1);
        w.serve();
        expect(w.state.reloads).toBe(0);
        expect(w.state.banner).toBe(NEWER);
    });

    it('badPath_anUnsavedEditIsNeverLost_theBannerStaysOnEveryReturn', () => {
        const w = world({ shown: false, unsaved: true });
        w.serve();
        w.visibility.set(true);
        expect(w.state.reloads).toBe(0);
        expect(w.state.banner).toBe(NEWER);
    });

    it('badPath_aReturnBeforeAnyNewerReleaseReloadsNothing', () => {
        const w = world();
        w.visibility.set(false);
        w.visibility.set(true);
        expect(w.state.reloads).toBe(0);
    });

    it('happyPath_theReturnedCallEndsTheWatchAndTheVisibilityListener', () => {
        const w = world();
        w.stop();
        expect(w.stopNewer).toHaveBeenCalledTimes(1);
        expect(w.releases.stop).toHaveBeenCalledTimes(1);
        expect(w.visibility.listeners.size).toBe(0);
    });

    it('happyPath_withoutAWatchNothingIsFollowed', () => {
        const clock = new FakeClock();
        const stop = followReleases(
            {
                ...{ visibility: new SwitchedVisibility(), clock, log: testLog().log },
                location: { reload: () => undefined },
                unsaved: () => false,
            },
            {} as ShellStateAccess,
        );
        expect(() => {
            stop();
        }).not.toThrow();
    });
});
