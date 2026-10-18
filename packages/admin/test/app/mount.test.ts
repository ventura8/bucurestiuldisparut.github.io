import type { CallableResponse } from '@hcm/shared';
import { BASELINE_THEME } from '@hcm/ui';
import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { createUpstreamFakes, GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it, vi } from 'vitest';

import { ADMINS_MODULE } from '../../src/admins/admins.js';
import { mount, SERVER_SEEN_KEY, serverMemory, THEME_KEY, type AdminDeps, type TelemetryView } from '../../src/app/mount.js';
import type { AreaModule } from '../../src/content/areas.js';
import type { ContentDeps } from '../../src/content/registry.js';
import type { ContentServices } from '../../src/content/services.js';
import { JOBS_MODULE } from '../../src/jobs/jobs.js';
import { NO_SETUP, type SetupModuleSpec, type ShellServices } from '../../src/app/services.js';
import { AdminTelemetry, CONSENT_KEY } from '../../src/app/telemetry.js';
import { GoogleAuthError } from '../../src/auth/google-auth.js';
import type { AnalyticsPort } from '../../src/firebase/analytics.js';
import { GOOGLE_SCOPES } from '../../src/google/scopes.js';
import { PageRegistry } from '../../src/routing/pages.js';
import { LANGUAGE_KEY } from '../../src/state/locale.js';
import {
    access,
    deployed,
    E2E_WEB_CONFIG,
    failure,
    FakeAuth,
    FakeCallables,
    FakeClock,
    FakeDocuments,
    FakeGoogle,
    FakeLocation,
    FakeVisibility,
    MemoryStore,
    NO_STORAGE,
    OWNER,
    SESSION,
    settle,
    testLog,
    undeployed,
} from './fakes.js';
import { asContentStore, NO_AREA_SERVICES, nth } from '../content/world.js';

interface Counter {
    readonly count: number;
}

function world(options: { readonly search?: string; readonly hash?: string } = {}) {
    const auth = new FakeAuth();
    const callables = new FakeCallables();
    const documents = new FakeDocuments();
    const google = new FakeGoogle(auth);
    const local = new MemoryStore();
    const session = new MemoryStore();
    const location = new FakeLocation(options.hash ?? '', options.search ?? '');
    const analytics: AnalyticsPort = { setConsent: vi.fn(), log: vi.fn() };
    const pages = new PageRegistry();
    pages.register('admins', () => Promise.resolve('hcm-admins-page'));
    const { log, recording } = testLog();
    let services: ShellServices<Counter> | null = null;
    const setup: SetupModuleSpec<Counter, { bump(): void }> = {
        initial: { count: 0 },
        create: (shell) => {
            services = shell;
            return {
                bump: () => {
                    shell.setSetup({ count: shell.getState().setup.count + 1 });
                },
            };
        },
    };
    const deps: AdminDeps<Counter, { bump(): void }> = {
        config: { ...E2E_WEB_CONFIG, measurementId: 'G-E2E0000000' },
        runtime: { release: 'e2e' },
        project: { projectId: 'demo-hcm', cities: ['bucharest'] },
        firebase: { auth, callables, documents, storage: NO_STORAGE },
        google,
        fetch: () => Promise.reject(new Error('no network in this test')),
        clock: new FakeClock(),
        session,
        local,
        location,
        log,
        visibility: new FakeVisibility(),
        languages: ['de-DE'],
        pages,
        telemetry: () => new AdminTelemetry({ local, analytics, errors: { report: vi.fn() }, clearCookies: vi.fn(), log }),
        setup,
    };
    const services$ = (): ShellServices<Counter> => {
        if (services === null) {
            throw new Error('the setup module was not created');
        }
        return services;
    };
    return { auth, callables, documents, google, local, session, location, analytics, recording, deps, services: services$ };
}

describe('mount', () => {
    it('happyPath_anAdminReachesTheShellInTheCitysColours', async () => {
        const w = world();
        w.auth.user = OWNER;
        deployed(w.callables, w.auth, SESSION.owner);
        w.documents.data.set('cities/bucharest', { theme: { seedColor: '#6750a4', tokens: BASELINE_THEME } });

        const app = mount(w.deps);
        await settle();

        expect(app.state).toMatchObject({ auth: 'admin', mode: 'normal', locale: 'ro', analytics: true, consent: 'unknown' });
        expect(app.state.theme.city).toEqual(BASELINE_THEME);
        expect(app.state.destinations.map((destination) => destination.id)).toEqual(['setup', 'admins']);
        await expect(app.loadPage('admins')).resolves.toBe('hcm-admins-page');
        app.destroy();
    });

    it('happyPath_preferencesAreStoredAndShownAtOnce', async () => {
        const w = world({ search: '?lang=en' });
        w.local.set(THEME_KEY, 'dark');
        undeployed(w.callables);
        const app = mount(w.deps);
        const seen: string[] = [];
        const stop = app.subscribe((state) => {
            seen.push(state.locale);
        });
        await settle();
        expect(app.state.locale).toBe('en');
        expect(app.state.theme.mode).toBe('dark');

        app.intents.setLocale('ro');
        app.intents.setTheme('light');
        app.intents.previewTheme(BASELINE_THEME);
        app.intents.setConsent('granted');
        app.intents.setWindowClass('large');
        stop();

        expect(w.local.get(LANGUAGE_KEY)).toBe('ro');
        expect(w.local.get(THEME_KEY)).toBe('light');
        expect(w.local.get(CONSENT_KEY)).toBe('granted');
        expect(app.state).toMatchObject({
            locale: 'ro',
            consent: 'granted',
            windowClass: 'large',
            theme: { mode: 'light', preview: BASELINE_THEME },
        });
        expect(seen).toContain('ro');
    });

    it('happyPath_theShellsOwnIntentsReachTheController', async () => {
        const w = world();
        undeployed(w.callables);
        const app = mount(w.deps);
        await settle();

        w.google.outcomes.push(new GoogleAuthError('popupClosed'));
        await app.intents.signIn();
        await app.intents.claim();
        await app.intents.join();
        await app.intents.enableApi();
        await app.intents.retry();
        app.intents.navigate({ id: 'setup', params: [] });
        app.intents.reload();
        app.intents.dismissNotice();
        await app.intents.signOut();

        expect(app.state.auth).toBe('signedOut');
        expect(w.location.reloads).toBe(1);
    });
});

describe('mount: the editor areas', () => {
    it('happyPath_theEditorAreasGetTheShellsServicesAndLoseTheirStoresOnSignOut', async () => {
        const w = world();
        w.auth.user = OWNER;
        deployed(w.callables, w.auth, SESSION.owner);
        const store = new FakeContentStore();
        const seen: ContentServices[] = [];
        let destroyed = 0;
        let unsaved = true;
        const module: AreaModule<{ readonly n: number }, null> = {
            area: 'jobs',
            create: (services) => {
                seen.push(services);
                return {
                    state: { n: 0 },
                    subscribe: () => () => undefined,
                    intents: null,
                    open: () => undefined,
                    close: () => undefined,
                    hasUnsavedChanges: () => unsaved,
                    destroy: () => {
                        destroyed += 1;
                    },
                };
            },
        };
        const content: ContentDeps = {
            modules: { jobs: module as never },
            store: asContentStore(store),
            theme: () => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} }),
            areas: NO_AREA_SERVICES,
            cityId: 'e2e-city',
        };
        w.documents.data.set('cities/e2e-city', { theme: { seedColor: '#6750a4', tokens: BASELINE_THEME } });
        const app = mount({ ...w.deps, content });
        await settle();

        // The e2e build's own city is the one whose colours the shell wears (CR-M2c-7), not the project's first.
        expect(app.state.theme.city).toEqual(BASELINE_THEME);
        expect(app.content.jobs).toBe(app.content.jobs);
        const services = nth(seen);
        services.notify({ key: 'adminContent.jobs.cancelRequested' });
        expect([services.cityId, services.user(), services.locale(), app.hasUnsavedChanges()]).toEqual([
            'e2e-city',
            { uid: OWNER.uid, name: OWNER.displayName },
            'ro',
            true,
        ]);
        expect(app.state.notice?.key).toBe('adminContent.jobs.cancelRequested');
        // An area's theme preview is the whole admin's (CR-M2c-28), until it ends.
        services.previewTheme(BASELINE_THEME);
        expect(app.state.theme.preview).toBe(BASELINE_THEME);
        services.previewTheme(null);
        expect(app.state.theme.preview).toBeNull();
        // Writes reach Firestore while the access holds (a revoked admin's are refused at once: content/revoked.test.ts).
        expect(await services.store.create('cities/e2e-city/notes/n1', { text: 'n' })).toEqual({ ok: true });
        unsaved = false;
        await app.intents.signOut();

        expect([destroyed, services.user(), app.hasUnsavedChanges()]).toEqual([1, null, false]);
        app.destroy();
    });

    it('badPath_signingOutWithAnUnsavedEditAsksFirst', async () => {
        const w = world();
        w.auth.user = OWNER;
        deployed(w.callables, w.auth, SESSION.owner);
        let unsaved = true;
        const module: AreaModule<null, null> = {
            area: 'jobs',
            create: () => ({
                ...{ state: null, subscribe: () => () => undefined, intents: null, open: () => undefined, close: () => undefined },
                hasUnsavedChanges: () => unsaved,
                destroy: () => undefined,
            }),
        };
        const store = asContentStore(new FakeContentStore());
        const theme = (): ReturnType<ContentDeps['theme']> => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} });
        const app = mount({
            ...w.deps,
            content: { modules: { jobs: module as never }, store, theme, areas: NO_AREA_SERVICES, cityId: null },
        });
        await settle();
        expect(app.content.jobs).not.toBeNull();

        await app.intents.signOut();
        const asked = app.state.leaving;
        app.intents.stayOnPage();
        const stayed = app.state.auth;
        await app.intents.signOut();
        unsaved = false;
        await app.intents.leavePage();
        await settle();

        expect([asked, stayed, app.state.auth, app.state.leaving]).toEqual([{ kind: 'signOut' }, 'admin', 'signedOut', null]);
        await expect(app.intents.leavePage()).resolves.toBeUndefined();
    });
});

describe('mount: the city the editor areas edit', () => {
    it('happyPath_theProjectsFirstCityWithoutAnOverrideAndNoAreasWithoutContent', async () => {
        const w = world();
        w.auth.user = { ...OWNER, displayName: null };
        deployed(w.callables, w.auth, SESSION.owner);
        const seen: ContentServices[] = [];
        const module: AreaModule<null, null> = {
            area: 'home',
            create: (services) => {
                seen.push(services);
                return {
                    state: null,
                    subscribe: () => () => undefined,
                    intents: null,
                    open: () => undefined,
                    close: () => undefined,
                    hasUnsavedChanges: () => false,
                    destroy: () => undefined,
                };
            },
        };
        const store = asContentStore(new FakeContentStore());
        const theme = (): ReturnType<ContentDeps['theme']> => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} });
        const app = mount({
            ...w.deps,
            content: { modules: { home: module as never }, store, theme, areas: NO_AREA_SERVICES, cityId: null },
        });
        const bare = mount(w.deps);
        await settle();

        expect(app.content.home).not.toBeNull();
        expect([seen[0]?.cityId, seen[0]?.user()]).toEqual(['bucharest', { uid: OWNER.uid, name: OWNER.email }]);
        expect([bare.content.home, bare.content.jobs]).toEqual([null, null]);
        expect(() =>
            mount({
                ...w.deps,
                project: { projectId: 'demo-hcm', cities: [] },
                content: { modules: {}, store, theme, areas: NO_AREA_SERVICES, cityId: null },
            }),
        ).not.toThrow();
    });
});

describe('mount: sessions ending and the city read', () => {
    it('badPath_aRemovedAdminsCallMakesTheShellAskAgain', async () => {
        const w = world();
        w.auth.user = OWNER;
        const answers: CallableResponse<'admin.session'>[] = [SESSION.admin, SESSION.admin, SESSION.stranger];
        w.callables.answer('admin.session', () => answers.shift() ?? SESSION.stranger);
        w.callables.fail('admins.list', failure('permission-denied', 'apiError.notAdmin'));
        const store = asContentStore(new FakeContentStore());
        const theme = (): ReturnType<ContentDeps['theme']> => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} });
        const app = mount({
            ...w.deps,
            content: { modules: { admins: ADMINS_MODULE }, store, theme, areas: NO_AREA_SERVICES, cityId: null },
        });
        await settle();

        await app.content.admins?.intents.refresh();
        await settle();

        expect(app.state.auth).toBe('notAdmin');
    });

    it('badPath_aRefusedFirestoreReadOfAnAreaMakesTheShellAskAgain', async () => {
        const w = world();
        w.auth.user = OWNER;
        const answers: CallableResponse<'admin.session'>[] = [SESSION.admin, SESSION.admin, SESSION.stranger];
        w.callables.answer('admin.session', () => answers.shift() ?? SESSION.stranger);
        const fake = new FakeContentStore();
        const theme = (): ReturnType<ContentDeps['theme']> => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} });
        const app = mount({
            ...w.deps,
            content: { modules: { jobs: JOBS_MODULE }, store: asContentStore(fake), theme, areas: NO_AREA_SERVICES, cityId: null },
        });
        await settle();

        app.content.jobs?.open([]);
        fake.fail('cities/bucharest/jobs', { kind: 'denied', code: 'permission-denied' });
        await settle();

        expect(app.state.auth).toBe('notAdmin');
    });

    it('badPath_aDeniedCityReadMakesTheShellAskAgain', async () => {
        const w = world();
        w.auth.user = OWNER;
        deployed(w.callables, w.auth, SESSION.owner);
        const app = mount(w.deps);
        await settle();
        const calls = w.callables.named('admin.session');

        w.documents.watchers.get('cities/bucharest')?.onError('permission-denied');
        await settle();

        expect(w.callables.named('admin.session')).toBe(calls + 1);
        expect(app.state.auth).toBe('admin');
    });

    it('happyPath_theSetupModuleGetsTheShellsServices', async () => {
        const w = world();
        undeployed(w.callables);
        const app = mount(w.deps);
        await settle();
        const shell = w.services();
        const states: number[] = [];
        shell.subscribe((state) => {
            states.push(state.setup.count);
        });

        app.intents.setup.bump();
        w.google.outcomes.push(new GoogleAuthError('popupBlocked'), access([GOOGLE_SCOPES.cloudBilling]));
        const refused = await shell.google.request('cloudBilling');
        const granted = await shell.google.request('cloudBilling');
        shell.track({ name: 'setup_step', step: 'billing', state: 'ok' });
        shell.notify({ key: 'adminSetup.import.done' });

        expect(app.state.setup.count).toBe(1);
        expect(states).toContain(1);
        expect(refused).toMatchObject({ granted: false, failure: 'popupBlocked' });
        expect(granted).toMatchObject({ granted: true, access: { scopes: [GOOGLE_SCOPES.cloudBilling] } });
        expect(shell.google.live('cloudBilling')?.token).toBe('ya29.e2e-owner-access-token');
        shell.google.drop();
        expect(shell.google.live('cloudBilling')).toBeNull();
        expect(app.state.notice).toMatchObject({ key: 'adminSetup.import.done' });
        expect(shell.config.projectId).toBe('demo-hcm');
        await expect(shell.serverReady()).resolves.toBe(false);
    });
});

describe('mount: telemetry, start-up mode and the Setup Assistant', () => {
    it('happyPath_telemetryReadsTheLiveLanguageWindowClassAndMode', async () => {
        const w = world();
        undeployed(w.callables);
        const views: TelemetryView[] = [];
        const app = mount({
            ...w.deps,
            telemetry: (view) => {
                views.push(view);
                return w.deps.telemetry(view);
            },
        });
        await settle();

        app.intents.setWindowClass('medium');

        expect(views[0]?.locale()).toBe('ro');
        expect(views[0]?.windowClass()).toBe('medium');
        expect(views[0]?.serverAnswers()).toBe(false);
    });

    it('happyPath_startUpModeAsksGoogleWhoOwnsTheProjectAndCanEnableResourceManager', async () => {
        const w = world();
        const fakes = createUpstreamFakes();
        fakes.fail('resource-manager', 'apiDisabled');
        undeployed(w.callables);
        const app = mount({ ...w.deps, fetch: fakes.fetch });
        await settle();

        w.google.outcomes.push(access([GOOGLE_SCOPES.cloudReadOnly], undefined, GOOGLE_TOKENS.owner));
        await app.intents.signIn();
        expect(app.state.gate.enableApi).toBe('cloudresourcemanager.googleapis.com');

        fakes.fail('resource-manager', null);
        w.google.outcomes.push(access([GOOGLE_SCOPES.cloudPlatform], undefined, GOOGLE_TOKENS.owner));
        await app.intents.enableApi();

        expect(fakes.callsTo('service-usage.batchEnable')).toHaveLength(1);
        expect(app.state).toMatchObject({ auth: 'bootstrap', mode: 'bootstrap' });
    });

    it('badPath_aRefusedScopeIsNamedInTheAdminsLanguageInTheSnackbarAndOnThePanels', async () => {
        const w = world();
        undeployed(w.callables);
        const app = mount(w.deps);
        await settle();

        w.google.outcomes.push(new GoogleAuthError('scopeDenied'));
        await expect(w.services().google.request('cloudBilling')).resolves.toMatchObject({ granted: false, failure: 'scopeDenied' });
        w.google.outcomes.push(new GoogleAuthError('scopeDenied'));
        await app.intents.claim();

        expect(app.state.notice).toMatchObject({
            key: 'adminShell.oauth.scopeDenied',
            params: { scope: 'Gestionează facturarea Google Cloud' },
        });
        expect(app.state.gate.issue).toMatchObject({ key: 'adminShell.oauth.scopeDenied', params: { scope: 'Vede datele Google Cloud' } });
    });

    it('badPath_aFailingStartIsLogged', async () => {
        const w = world();
        undeployed(w.callables);
        w.auth.onUserChanged = () => {
            throw new Error('auth unavailable');
        };

        mount(w.deps);
        await settle();

        expect(w.recording.records.map((record) => record.message)).toContain('admin start failed');
    });

    it('happyPath_withoutASetupModuleTheShellRunsAlone', async () => {
        const w = world();
        undeployed(w.callables);

        const app = mount({ ...w.deps, setup: NO_SETUP, languages: [], project: { projectId: 'demo-hcm', cities: [] } });
        await settle();

        expect(app.state.setup).toBeNull();
        expect(app.intents.setup).toBeNull();
        expect(app.state.locale).toBe('ro');
        expect(w.documents.watchers.size).toBe(0);
    });
});

describe('serverMemory', () => {
    it('happyPath_rememberedPerProject_badPath_anotherProjectsNoteSaysNothing', () => {
        const local = new MemoryStore();
        const memory = serverMemory(local, 'demo-hcm');

        expect(memory.known()).toBe(false);
        memory.remember();
        expect([memory.known(), local.get(SERVER_SEEN_KEY), serverMemory(local, 'other-project').known()]).toEqual([
            true,
            'demo-hcm',
            false,
        ]);
    });
});

describe('mount: the names of the admins, for the editors', () => {
    it('happyPath_theAdminsNamesAreAskedOnceAFailureAsksAgainAndSignOutForgetsThem', async () => {
        const w = world();
        w.auth.user = OWNER;
        deployed(w.callables, w.auth, SESSION.owner);
        const seen: ContentServices[] = [];
        const module: AreaModule<null, null> = {
            area: 'jobs',
            create: (services) => {
                seen.push(services);
                return {
                    ...{ state: null, subscribe: () => () => undefined, intents: null, open: () => undefined, close: () => undefined },
                    hasUnsavedChanges: () => false,
                    destroy: () => undefined,
                };
            },
        };
        const store = asContentStore(new FakeContentStore());
        const theme = (): ReturnType<ContentDeps['theme']> => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} });
        const app = mount({
            ...w.deps,
            content: { modules: { jobs: module as never }, store, theme, areas: NO_AREA_SERVICES, cityId: null },
        });
        await settle();
        expect(app.content.jobs).not.toBeNull();
        const services = nth(seen);

        // The first ask fails (the shell keeps no names and a later conflict asks again); the second answers.
        w.callables.fail('admins.list', failure('unavailable', 'apiError.unavailable'));
        services.people();
        await settle();
        const afterFailure = app.state.people;
        w.callables.answer('admins.list', () => ({
            admins: [
                {
                    uid: 'a1',
                    role: 'admin',
                    displayName: 'Ana Pop',
                    email: 'ana@e2e.test',
                    createdAt: '2026-10-01T09:00:00.000Z',
                    self: false,
                },
                { uid: 'a2', role: 'admin', email: 'ion@e2e.test', createdAt: '2026-10-01T09:00:00.000Z', self: false },
                { uid: 'a3', role: 'admin', createdAt: '2026-10-01T09:00:00.000Z', self: false },
            ],
            invites: [],
        }));
        services.people();
        services.people();
        await settle();

        expect(afterFailure).toEqual({});
        expect(app.state.people).toEqual({ a1: 'Ana Pop', a2: 'ion@e2e.test' });
        expect(w.callables.named('admins.list')).toBe(2);
        expect(services.readOnly()).toBe(false);
        await app.intents.signOut();
        expect(app.state.people).toEqual({});
        app.destroy();
    });
});
