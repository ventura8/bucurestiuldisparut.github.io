/**
 * The admin app (`docs/research/M2b-interfaces.md` §1.7): `mount(deps)` wires the injected ports into the state, the
 * auth state machine, the address, the city theme and telemetry, and returns the `AdminApp` the shell element renders
 * (`<hcm-admin-shell>` of `@hcm/ui/admin` reads it through its structural `AdminAppPort`). DOM-free: the entry
 * (`../index.ts`) builds the real ports, the node tests pass fakes.
 */
import type { AdminsListResponse, InviteResponse, Locale, Logger, RevokeRequest, ThemeTokens } from '@hcm/shared';

import { AuthController } from '../auth/controller.js';
import { GoogleAccessStore } from '../auth/google-access.js';
import type { GoogleAuthPort } from '../auth/google-auth.js';
import { GoogleAccessService } from '../auth/google-service.js';
import { checkOwnership, enableService } from '../auth/ownership.js';
import type { FirebasePorts } from '../firebase/ports.js';
import type { PageRegistry } from '../routing/pages.js';
import type { AdminRoute, AdminRouteId } from '../routing/routes.js';
import { LANGUAGE_KEY, resolveAdminLocale } from '../state/locale.js';
import { NO_GATE, type AdminState, type NoticeInput, type ShellStateAccess, type ThemeMode } from '../state/state.js';
import { Store } from '../state/store.js';
import { CityTheme } from './city-theme.js';
import type { AdminRuntime, FirebaseWebConfig } from './config.js';
import { Navigation } from './navigation.js';
import { destinationOf } from '../routing/router.js';
import type { Clock, HashLocation, KeyValueStore, PageVisibility, Unsubscribe } from './ports.js';
import { guardCallables, outcomeOf, type AdminProject, type Outcome, type SetupModuleSpec, type ShellServices } from './services.js';
import type { AdminEvent, AdminTelemetry } from './telemetry.js';

/** `localStorage`: the theme the admin chose (`system` by default). */
export const THEME_KEY = 'hcm:admin:theme';

/** What crash reports need to know of the app while it runs. */
export interface TelemetryView {
    locale(): string;
    windowClass(): string;
    /** The server answers (normal mode): only then does the crash endpoint exist. */
    serverAnswers(): boolean;
}

export interface AdminDeps<Setup, SetupIntents> {
    /** §1.4 step 1. */
    readonly config: FirebaseWebConfig;
    /** §1.4 step 2. */
    readonly runtime: AdminRuntime;
    /** `infra/project.json` (§3.7). */
    readonly project: AdminProject;
    /** Auth, callables, Firestore, Storage (adapters in `packages/admin/src/firebase/`). */
    readonly firebase: FirebasePorts;
    /** Google consent (§2.2); the e2e build swaps only this port (§2.6). */
    readonly google: GoogleAuthPort;
    /** The Google REST clients' transport. */
    readonly fetch: typeof fetch;
    readonly clock: Clock;
    /** `sessionStorage` (try/catch inside). */
    readonly session: KeyValueStore;
    /** `localStorage`: the language, the theme, the analytics consent. */
    readonly local: KeyValueStore;
    readonly location: HashLocation;
    readonly log: Logger;
    readonly visibility: PageVisibility;
    /** `navigator.languages`. */
    readonly languages: readonly string[];
    /** The pages besides Setup's (`registerAdminPage`). */
    readonly pages: PageRegistry;
    readonly telemetry: (view: TelemetryView) => AdminTelemetry;
    /** The Setup Assistant (`NO_SETUP` until setup-ui's module is wired). */
    readonly setup: SetupModuleSpec<Setup, SetupIntents>;
}

export interface AdminIntents<SetupIntents> {
    signIn(): Promise<void>;
    signOut(): Promise<void>;
    claim(): Promise<void>;
    join(): Promise<void>;
    /** Try again (`backendDown`). */
    retry(): Promise<void>;
    /** Enables the Google API the sign-in panel names, then checks again. */
    enableApi(): Promise<void>;
    reload(): void;
    navigate(route: AdminRoute): void;
    setLocale(locale: Locale): void;
    setTheme(mode: ThemeMode): void;
    /** Settings' live preview of a seed colour's tokens; null returns to the city's. */
    previewTheme(tokens: ThemeTokens | null): void;
    setConsent(consent: 'granted' | 'denied'): void;
    dismissNotice(): void;
    setWindowClass(windowClass: string): void;
    /** `#/admins` (A02). */
    listAdmins(): Promise<Outcome<AdminsListResponse>>;
    inviteAdmin(email: string): Promise<Outcome<InviteResponse>>;
    revokeAdmin(request: RevokeRequest): Promise<Outcome<{ readonly revoked: true }>>;
    readonly setup: SetupIntents;
}

export interface AdminApp<Setup, SetupIntents> {
    readonly state: AdminState<Setup>;
    subscribe(listener: (state: AdminState<Setup>) => void): Unsubscribe;
    readonly intents: AdminIntents<SetupIntents>;
    /** The tag of a route's page element, once loaded (null: none). */
    loadPage(id: AdminRouteId): Promise<string | null>;
    /** Crash reporting for the entry's global hooks and the elements' error boundaries. */
    readonly telemetry: AdminTelemetry;
    destroy(): void;
}

/** The stored theme (`system` for anything else). */
export function themeModeOf(value: string | null): ThemeMode {
    return value === 'light' || value === 'dark' ? value : 'system';
}

function initialState<Setup>(deps: AdminDeps<Setup, unknown>): AdminState<Setup> {
    return {
        auth: 'starting',
        mode: null,
        user: null,
        role: null,
        busy: false,
        gate: NO_GATE,
        route: { id: 'setup', params: [] },
        destinations: [destinationOf('setup')],
        locale: resolveAdminLocale(deps.location.search(), deps.local.get(LANGUAGE_KEY), deps.languages),
        theme: { mode: themeModeOf(deps.local.get(THEME_KEY)), city: null, preview: null },
        consent: 'unknown',
        analytics: false,
        windowClass: 'compact',
        notice: null,
        projectId: deps.config.projectId,
        authDomain: deps.config.authDomain,
        setup: deps.setup.initial,
    };
}

function shellAccess<Setup>(store: Store<AdminState<Setup>>): ShellStateAccess {
    let notices = 0;
    return {
        get: () => store.state,
        update: (patch) => {
            store.update(patch);
        },
        notice: (input) => {
            notices += 1;
            return { ...input, id: notices };
        },
    };
}

interface Parts<Setup> {
    readonly store: Store<AdminState<Setup>>;
    readonly shell: ShellStateAccess;
    readonly controller: AuthController;
    readonly google: GoogleAccessService;
    readonly navigation: Navigation;
    readonly telemetry: AdminTelemetry;
    readonly firebase: FirebasePorts;
}

function servicesFor<Setup>(deps: AdminDeps<Setup, unknown>, parts: Parts<Setup>): ShellServices<Setup> {
    const notify = (notice: NoticeInput): void => {
        parts.store.update({ notice: parts.shell.notice(notice) });
    };
    return {
        ...{ config: deps.config, runtime: deps.runtime, project: deps.project, fetch: deps.fetch, clock: deps.clock },
        ...{ session: deps.session, visibility: deps.visibility, log: deps.log, firebase: parts.firebase },
        google: {
            request: async (scope) => {
                const outcome = await parts.google.request(scope);
                if (!outcome.granted) {
                    notify(outcome.notice);
                }
                return outcome;
            },
            live: (scope, minRemainingMs) => parts.google.live(scope, minRemainingMs),
            drop: () => {
                parts.google.drop();
            },
        },
        getState: () => parts.store.state,
        subscribe: (listener) => parts.store.subscribe(listener),
        setSetup: (setup) => {
            parts.store.update({ setup });
        },
        notify,
        track: (event) => {
            parts.telemetry.track(event);
        },
        serverReady: () => parts.controller.serverReady(),
    };
}

function shellIntents<Setup>(deps: AdminDeps<Setup, unknown>, parts: Parts<Setup>): Omit<AdminIntents<never>, 'setup'> {
    const { controller, store } = parts;
    const callables = parts.firebase.callables;
    const update = (patch: Partial<AdminState<Setup>>): void => {
        store.update(patch);
    };
    return {
        signIn: () => controller.signIn(),
        signOut: () => controller.signOut(),
        claim: () => controller.claim(),
        join: () => controller.join(),
        retry: () => controller.retry(),
        enableApi: () => controller.enableApi(),
        reload: () => {
            deps.location.reload();
        },
        navigate: (route) => {
            parts.navigation.navigate(route);
        },
        setLocale: (locale) => {
            deps.local.set(LANGUAGE_KEY, locale);
            update({ locale });
        },
        setTheme: (mode) => {
            deps.local.set(THEME_KEY, mode);
            update({ theme: { ...store.state.theme, mode } });
        },
        previewTheme: (preview) => {
            update({ theme: { ...store.state.theme, preview } });
        },
        setConsent: (consent) => {
            parts.telemetry.setConsent(consent);
            update({ consent });
        },
        dismissNotice: () => {
            update({ notice: null });
        },
        setWindowClass: (windowClass) => {
            update({ windowClass });
        },
        listAdmins: () => outcomeOf(() => callables.call('admins.list', {})),
        inviteAdmin: (email) => outcomeOf(() => callables.call('admins.invite', { email })),
        revokeAdmin: (request) => outcomeOf(() => callables.call('admins.revoke', request)),
    };
}

/** Builds the app and starts it (the probe, then Firebase Auth's user); returns at once. */
export function mount<Setup, SetupIntents>(deps: AdminDeps<Setup, SetupIntents>): AdminApp<Setup, SetupIntents> {
    const store = new Store<AdminState<Setup>>(initialState(deps), deps.log);
    const shell = shellAccess(store);
    const telemetry = deps.telemetry({
        locale: () => store.state.locale,
        windowClass: () => store.state.windowClass,
        serverAnswers: () => store.state.mode === 'normal',
    });
    store.update({ consent: telemetry.consent, analytics: telemetry.available });
    const google = new GoogleAccessService({
        port: deps.google,
        store: new GoogleAccessStore(() => deps.clock.now()),
        currentUser: () => deps.firebase.auth.currentUser(),
        locale: () => store.state.locale,
    });
    const projectId = deps.config.projectId;
    const controller = new AuthController({
        ...{ auth: deps.firebase.auth, callables: deps.firebase.callables, google, shell, session: deps.session, log: deps.log },
        ownership: (token) => checkOwnership(deps.fetch, projectId, token),
        enableApi: (token, api) => enableService(deps.fetch, projectId, token, api),
    });
    const denied = (): void => {
        void controller.accessDenied();
    };
    const firebase: FirebasePorts = { ...deps.firebase, callables: guardCallables(deps.firebase.callables, denied) };
    const track = (event: AdminEvent): void => {
        telemetry.track(event);
    };
    const navigation = new Navigation({ shell, location: deps.location, session: deps.session, pages: deps.pages, track });
    const cityTheme = new CityTheme({ documents: deps.firebase.documents, shell, cityId: deps.project.cities[0] ?? null, denied });
    const stopWatching = store.subscribe((state) => {
        navigation.stateChanged(state);
        cityTheme.stateChanged(state);
    });
    const parts: Parts<Setup> = { store, shell, controller, google, navigation, telemetry, firebase };
    const intents: AdminIntents<SetupIntents> = { ...shellIntents(deps, parts), setup: deps.setup.create(servicesFor(deps, parts)) };
    controller.start().catch((error: unknown) => {
        deps.log.error('admin start failed', { error: String(error) });
    });
    return {
        get state() {
            return store.state;
        },
        subscribe: (listener) => store.subscribe(listener),
        intents,
        loadPage: (id) => deps.pages.load(id),
        telemetry,
        destroy: () => {
            stopWatching();
            controller.stop();
            navigation.stop();
            cityTheme.stop();
        },
    };
}
