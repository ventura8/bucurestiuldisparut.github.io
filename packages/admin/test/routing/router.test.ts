import { describe, expect, it } from 'vitest';

import { PageRegistry } from '../../src/routing/pages.js';
import { destinationOf, navigationDestinations, resolveAdminRoute, type RouteContext } from '../../src/routing/router.js';
import { ADMIN_ROUTES } from '../../src/routing/routes.js';

const NORMAL: RouteContext = { mode: 'normal', hasPage: (id) => id === 'admins' || id === 'photos' || id === 'history' };
const BOOTSTRAP: RouteContext = { mode: 'bootstrap', hasPage: () => true };

describe('resolveAdminRoute', () => {
    it('happyPath_aKnownRouteWithAPageOpens', () => {
        expect(resolveAdminRoute('#/photos/coltul-strada-fonteriei', NORMAL)).toEqual({
            route: { id: 'photos', params: ['coltul-strada-fonteriei'] },
            notice: null,
        });
        expect(resolveAdminRoute('#/setup/usgs', BOOTSTRAP)).toEqual({ route: { id: 'setup', params: ['usgs'] }, notice: null });
    });

    it('happyPath_noRouteIsSetupWithoutAMessage', () => {
        for (const hash of ['', '#', '#/']) {
            expect(resolveAdminRoute(hash, NORMAL)).toEqual({ route: { id: 'setup', params: [] }, notice: null });
        }
    });

    it('badPath_anUnknownAddressOrAPageNotBuiltOpensSetupWithNotFound', () => {
        expect(resolveAdminRoute('#/billing', NORMAL).notice).toBe('adminShell.route.notFound');
        expect(resolveAdminRoute('#/jobs', NORMAL)).toEqual({ route: { id: 'setup', params: [] }, notice: 'adminShell.route.notFound' });
    });

    it('badPath_aServerPageInStartUpModeOpensSetupWithNeedsBackend', () => {
        expect(resolveAdminRoute('#/admins', BOOTSTRAP)).toEqual({
            route: { id: 'setup', params: [] },
            notice: 'adminShell.route.needsBackend',
        });
        expect(resolveAdminRoute('#/admins', { mode: null, hasPage: () => true }).notice).toBe('adminShell.route.needsBackend');
    });
});

describe('navigationDestinations', () => {
    it('happyPath_normalModeListsSetupAndEveryBuiltPageHistoryIncluded', () => {
        expect(navigationDestinations(NORMAL).map((destination) => destination.id)).toEqual(['setup', 'photos', 'admins', 'history']);
        expect(navigationDestinations({ mode: 'normal', hasPage: () => true }).map((destination) => destination.id)).toEqual(ADMIN_ROUTES);
        expect(destinationOf('home')).toEqual({ id: 'home', icon: 'home', compact: false });
    });

    it('badPath_startUpModeListsSetupAlone', () => {
        expect(navigationDestinations(BOOTSTRAP)).toEqual([{ id: 'setup', icon: 'checklist', compact: true }]);
    });

    it('happyPath_aDestinationCarriesItsIconAndBarPlace', () => {
        expect(destinationOf('jobs')).toEqual({ id: 'jobs', icon: 'pending_actions', compact: false });
    });
});

describe('PageRegistry', () => {
    it('happyPath_aRegisteredPageNamesItsElement', async () => {
        const pages = new PageRegistry();
        pages.register('admins', () => Promise.resolve('hcm-admins-page'));

        expect(pages.has('admins')).toBe(true);
        await expect(pages.load('admins')).resolves.toBe('hcm-admins-page');
    });

    it('badPath_noPageAFailedLoadOrAForeignTagIsNone', async () => {
        const pages = new PageRegistry();
        pages.register('photos', () => Promise.reject(new Error('chunk failed')));
        pages.register('jobs', () => Promise.resolve('script'));
        pages.register('pois', () => Promise.resolve('hcm-'));

        expect(pages.has('layers')).toBe(false);
        await expect(pages.load('layers')).resolves.toBeNull();
        await expect(pages.load('photos')).resolves.toBeNull();
        await expect(pages.load('jobs')).resolves.toBeNull();
        await expect(pages.load('pois')).resolves.toBeNull();
    });
});
