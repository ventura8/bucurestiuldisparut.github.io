/**
 * The admin's entry (`docs/research/M2b-interfaces.md` §1.7): builds the real ports (the browser, the Firebase SDK,
 * Google's popup or, in the `e2e` build, the OAuth stand-in), registers the elements of `@hcm/ui/admin`, boots
 * (`app/boot.ts`) and hands the app to the page's `<hcm-admin-shell>`. Importing it in Node (the tests) does nothing:
 * the start needs a document.
 */
import './admin.css';

import { createLogger, type Logger } from '@hcm/shared';
import { installFonts, type FontFaceConstructor } from '@hcm/ui';
import { HCM_ADMINS_PAGE_TAG, SETUP_PAGE_TAGS, defineAdminElements, defineSetupElements, type HcmAdminShell } from '@hcm/ui/admin';

import { bootAdmin, type BootEnvironment } from './app/boot.js';
import { documentVisibility, webStorage, windowClock, windowLocation, type LocationWindow } from './app/browser.js';
import type { Clock, HashLocation, KeyValueStore } from './app/ports.js';
import type { AdminRuntime, FirebaseWebConfig } from './app/config.js';
import { errorEndpointFor, installErrorHooks, AdminErrorReporter } from './app/errors.js';
import type { AdminDeps, TelemetryView } from './app/mount.js';
import type { AdminProject, SetupModuleSpec } from './app/services.js';
import { setupModuleFor } from './app/setup-wiring.js';
import { AdminTelemetry, expireAnalyticsCookies } from './app/telemetry.js';
import { createGoogleAuth, type PopupSignIn } from './auth/google-auth.js';
import { createStandInPopup } from './auth/stand-in.js';
import { createAnalytics, type AnalyticsPort } from './firebase/analytics.js';
import { credentialSignIn, firebasePopup, firebasePorts } from './firebase/adapters.js';
import type { FirebasePorts } from './firebase/ports.js';
import type { ProjectConfig } from './provision/project-config.js';
import type { SetupModule } from './setup/module.js';
import type { SetupState } from './setup/state.js';
import { initFirebase, loadAnalyticsSdk, type FirebaseHandles } from './firebase/app.js';
import { firebaseSdk } from './firebase/sdk.js';
import { PageRegistry, type PageLoader } from './routing/pages.js';
import type { AdminRouteId } from './routing/routes.js';

export type { AdminApp, AdminDeps, AdminIntents } from './app/mount.js';
export type { SetupModuleSpec, ShellServices } from './app/services.js';

/** The pages besides Setup's: a later workstream registers its own (`registerAdminPage`). */
const PAGES = new PageRegistry();
PAGES.register('admins', () => Promise.resolve(HCM_ADMINS_PAGE_TAG));
for (const id of ['setup', 'crashes'] as const) {
    PAGES.register(id, () => {
        defineSetupElements();
        return Promise.resolve(SETUP_PAGE_TAGS[id]);
    });
}

/** Adds a page to the shell (imported lazily when its route opens). */
export function registerAdminPage(id: AdminRouteId, load: PageLoader): void {
    PAGES.register(id, load);
}

/** What the entry needs of `window` (the node tests pass a plain object). */
export interface AdminWindow extends LocationWindow {
    readonly document: Document;
    readonly navigator: Pick<Navigator, 'languages'>;
    readonly sessionStorage: Storage;
    readonly localStorage: Storage;
    readonly innerWidth: number;
    readonly innerHeight: number;
    fetch: typeof fetch;
    setTimeout: Window['setTimeout'];
    clearTimeout: Window['clearTimeout'];
    open: Window['open'];
}

/** The `?test=` of the address: the e2e test's partition for the OAuth stand-in (§2.6). */
function testIdOf(win: AdminWindow): string {
    return new URLSearchParams(win.location.search).get('test') ?? '';
}

/** Google's popup through Firebase, or the e2e stand-in's page. */
/** What only the `e2e` build carries: the OAuth stand-in; the Firebase emulators come with it. */
export interface E2eKit {
    readonly standInPopup: typeof createStandInPopup;
}

/**
 * The kit of the `e2e` build, null in production: the mode is a constant for the bundler, so the production bundle
 * carries no stand-in.
 */
export const E2E_KIT: E2eKit | null = import.meta.env.MODE === 'e2e' ? { standInPopup: createStandInPopup } : null;

function popupFor(win: AdminWindow, handles: FirebaseHandles, e2e: E2eKit | null, clock: Clock): PopupSignIn {
    if (e2e === null) {
        return firebasePopup(firebaseSdk, handles);
    }
    return e2e.standInPopup({
        open: (url) => win.open(url, 'hcm-oauth', 'popup,width=480,height=640'),
        onMessage: (listener) => {
            const onEvent = (event: MessageEvent): void => {
                listener({ origin: event.origin, source: event.source, data: event.data as unknown });
            };
            win.addEventListener('message', onEvent);
            return () => {
                win.removeEventListener('message', onEvent);
            };
        },
        clock,
        testId: testIdOf(win),
        signInWithCredential: credentialSignIn(firebaseSdk, handles),
    });
}

/** GA4 of the admin's own Firebase app, when the web configuration names a measurement id (else none, and no banner). */
export function analyticsFor(measurementId: string | undefined, app: FirebaseHandles['app'], parts: BrowserParts): AnalyticsPort | null {
    const location = parts.location;
    return measurementId === undefined
        ? null
        : createAnalytics({ app, load: loadAnalyticsSdk, log: parts.log, pageLocation: location.page.bind(location) });
}

/** The admin's telemetry: crash reports to the project's endpoint once the server answers, GA4 behind consent. */
export function telemetryFor(
    parts: BrowserParts,
    handles: Pick<FirebaseHandles, 'app'>,
    config: FirebaseWebConfig,
    release: string,
): AdminDeps<null, null>['telemetry'] {
    const { win, log, location, local } = parts;
    const analytics = analyticsFor(config.measurementId, handles.app, parts);
    return (view: TelemetryView): AdminTelemetry => {
        const endpoint = errorEndpointFor(config.projectId, parts.e2e !== null);
        const errors = new AdminErrorReporter({
            release,
            log,
            now: () => Date.now(),
            endpoint: () => (view.serverAnswers() ? endpoint : null),
            page: () => location.page(),
            viewport: () => ({ width: win.innerWidth, height: win.innerHeight }),
            context: () => ({ locale: view.locale(), windowClass: view.windowClass() }),
            post: (url, body) =>
                win.fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true, credentials: 'omit' }),
            exception: (description, fatal) => {
                analytics?.log('exception', { description, fatal });
            },
        });
        const clearCookies = (): void => {
            log.info('analytics cookies expired', { count: expireAnalyticsCookies(win.document, win.location.hostname).length });
        };
        const telemetry = new AdminTelemetry({ local, analytics, errors, clearCookies, log });
        installErrorHooks(win, errors);
        return telemetry;
    };
}

/** The browser parts made once per page: the boot and `mount` share them. */
export interface BrowserParts {
    readonly win: AdminWindow;
    /** The `e2e` build's kit (the emulators and the OAuth stand-in), or null. */
    readonly e2e: E2eKit | null;
    readonly log: Logger;
    readonly location: HashLocation;
    readonly local: KeyValueStore;
    readonly session: KeyValueStore;
    readonly clock: Clock;
}

export function browserParts(win: AdminWindow, e2e: E2eKit | null, log: Logger): BrowserParts {
    return {
        win,
        e2e,
        log,
        location: windowLocation(win),
        local: webStorage(() => win.localStorage, log),
        session: webStorage(() => win.sessionStorage, log),
        clock: windowClock(win),
    };
}

/** The project the shell reads when the page serves no `project.json`: the web configuration's, and this repository's city. */
export function projectOf(config: FirebaseWebConfig): AdminProject {
    return { projectId: config.projectId, cities: ['bucharest'] };
}

/** The Setup Assistant's state and intents as the entry mounts them (none without a project file). */
type EntrySetup = SetupState | null;
type EntryIntents = ReturnType<SetupModule['create']> | null;

/** No Setup Assistant: the page says Setup is not available. */
const NO_ASSISTANT: SetupModuleSpec<EntrySetup, EntryIntents> = { initial: null, create: () => null };

interface SetupParts {
    readonly parts: BrowserParts;
    readonly config: FirebaseWebConfig;
    readonly firebase: FirebasePorts;
    readonly fetch: typeof fetch;
}

/** The Setup Assistant over the project file (CR-M2b-15), or none without one. */
function setupFor(setup: SetupParts, project: ProjectConfig | null): SetupModuleSpec<EntrySetup, EntryIntents> {
    if (project === null) {
        setup.parts.log.warn('no project.json: the Setup Assistant is not available');
        return NO_ASSISTANT;
    }
    return setupModuleFor({
        ...{ config: setup.config, project, firebase: setup.firebase, fetch: setup.fetch, clock: setup.parts.clock, log: setup.parts.log },
        baseUrl: setup.parts.win.document.baseURI,
        nonce: globalThis.crypto.randomUUID.bind(globalThis.crypto),
    });
}

/** Every dependency of `mount` but the configuration, from the real browser and Firebase. */
export function browserDeps(parts: BrowserParts): BootEnvironment<EntrySetup, EntryIntents>['build'] {
    const { win, e2e, log, clock } = parts;
    return (config: FirebaseWebConfig, runtime: AdminRuntime, project: ProjectConfig | null) => {
        const handles = initFirebase(firebaseSdk, config, runtime, e2e !== null);
        const fetcher: typeof fetch = (input, init) => win.fetch(input, init);
        const firebase = firebasePorts(firebaseSdk, handles);
        return {
            ...{ project: project ?? projectOf(config), firebase, fetch: fetcher, clock, log },
            google: createGoogleAuth(popupFor(win, handles, e2e, clock), { fetch: fetcher, clock, log }),
            ...{ session: parts.session, local: parts.local, location: parts.location, visibility: documentVisibility(win.document) },
            languages: win.navigator.languages,
            pages: PAGES,
            telemetry: telemetryFor(parts, handles, config, runtime.release),
            setup: setupFor({ parts, config, firebase, fetch: fetcher }, project),
        };
    };
}

/** Boots the admin into `shell` (`<hcm-admin-shell>`). */
export async function startAdmin(parts: BrowserParts, shell: Pick<HcmAdminShell, 'app'>): Promise<void> {
    const app = await bootAdmin({
        fetch: (input, init) => parts.win.fetch(input, init),
        location: parts.location,
        local: parts.local,
        languages: parts.win.navigator.languages,
        log: parts.log,
        build: browserDeps(parts),
    });
    shell.app = app;
}

/** What the auto-start needs of the global scope (absent in Node). */
export interface AdminScope {
    readonly document?: Document;
    readonly customElements?: CustomElementRegistry;
    readonly FontFace?: FontFaceConstructor;
}

/**
 * Registers the elements, installs the kit's fonts (from `fonts/` next to the page) and, once the page is parsed, starts
 * the admin in its `<hcm-admin-shell>` (one is added to the body when the page has none).
 */
export function autoStart(scope: AdminScope, win: AdminWindow, e2e: E2eKit | null, log: Logger): void {
    const { document: doc, customElements: registry, FontFace: Face } = scope;
    if (doc === undefined || registry === undefined || Face === undefined) {
        return;
    }
    defineAdminElements(registry);
    installFonts(doc, 'fonts/', Face);
    const start = (): void => {
        const shell = doc.querySelector('hcm-admin-shell') ?? doc.body.appendChild(doc.createElement('hcm-admin-shell'));
        void startAdmin(browserParts(win, e2e, log), shell);
    };
    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}

autoStart(globalThis, globalThis, E2E_KIT, createLogger('admin'));
