import { describe, expect, it, vi } from 'vitest';

import { Navigation } from '../../src/app/navigation.js';
import { PageRegistry } from '../../src/routing/pages.js';
import { RETURN_TO_KEY } from '../../src/routing/router.js';
import type { ShellState } from '../../src/state/state.js';
import { FakeLocation, MemoryStore, shellStateAccess } from './fakes.js';

function navigation(hash: string, pages: readonly ('admins' | 'photos')[] = ['admins']) {
    const location = new FakeLocation(hash);
    const session = new MemoryStore();
    const shell = shellStateAccess();
    const registry = new PageRegistry();
    for (const page of pages) {
        registry.register(page, () => Promise.resolve(`hcm-${page}-page`));
    }
    const track = vi.fn();
    const nav = new Navigation({ shell, location, session, pages: registry, track });
    const change = (patch: Partial<ShellState>): void => {
        shell.update(patch);
        nav.stateChanged(shell.get());
    };
    return { location, session, shell, track, nav, change };
}

describe('Navigation', () => {
    it('badPath_aSignedOutDeepLinkIsKeptAndOpenedAfterSignIn', () => {
        const n = navigation('#/admins');

        n.change({ auth: 'signedOut', mode: 'normal' });
        expect(n.session.get(RETURN_TO_KEY)).toBe('#/admins');
        n.location.current = '';
        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.shell.get().route).toEqual({ id: 'admins', params: [] });
        expect(n.session.get(RETURN_TO_KEY)).toBeNull();
        expect(n.location.writes).toEqual([{ hash: '#/admins', replace: true }]);
        expect(n.track).toHaveBeenCalledWith({ name: 'page_view', route: 'admins' });
    });

    it('happyPath_aLinkOpensItsPageAndEachRouteIsOnePageView', () => {
        const n = navigation('');
        n.change({ auth: 'admin', mode: 'normal' });

        n.location.visit('#/admins');
        n.location.visit('#/admins');
        n.nav.navigate({ id: 'setup', params: [] });

        expect(n.shell.get().route.id).toBe('setup');
        expect(n.shell.get().destinations.map((destination) => destination.id)).toEqual(['setup', 'admins']);
        expect(n.track.mock.calls.map(([event]) => (event as { route: string }).route)).toEqual(['setup', 'admins', 'setup']);
    });

    it('badPath_anUnknownAddressOpensSetupWithAMessage', () => {
        const n = navigation('#/nowhere');

        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.shell.get()).toMatchObject({ route: { id: 'setup' }, notice: { key: 'adminShell.route.notFound' } });
        expect(n.location.writes).toEqual([{ hash: '#/setup', replace: true }]);
    });

    it('badPath_aServerPageInStartUpModeOpensSetupAndTheSwitchKeepsNavigating', () => {
        const n = navigation('#/admins');
        n.change({ auth: 'bootstrap', mode: 'bootstrap' });
        expect(n.shell.get()).toMatchObject({ route: { id: 'setup' }, notice: { key: 'adminShell.route.needsBackend' } });
        expect(n.shell.get().destinations.map((destination) => destination.id)).toEqual(['setup']);

        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.shell.get().destinations.map((destination) => destination.id)).toEqual(['setup', 'admins']);
    });

    it('badPath_somethingThatIsNotARouteHashIsNotKept', () => {
        const n = navigation('#photo=abc');

        n.change({ auth: 'signedOut', mode: 'normal' });
        n.location.visit('#/setup?x=1');

        expect(n.session.get(RETURN_TO_KEY)).toBeNull();
    });

    it('happyPath_aStateChangeThatKeepsShellAndModeChangesNothing', () => {
        const n = navigation('');
        n.change({ auth: 'admin', mode: 'normal' });

        n.change({ busy: true });
        n.nav.stop();
        n.location.visit('#/admins');

        expect(n.track).toHaveBeenCalledTimes(1);
        expect(n.shell.get().route.id).toBe('setup');
    });
});
