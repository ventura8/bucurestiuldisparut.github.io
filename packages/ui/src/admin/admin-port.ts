/**
 * What the admin's elements need from the admin app (`docs/research/M2b-interfaces.md` §1.7).
 *
 * `@hcm/ui` sits below `@hcm/admin` (dependency-cruiser `ui-below-apps`), so the elements cannot import its types. This
 * file mirrors them structurally, as `store-port.ts` does for the viewer: `mount` of `@hcm/admin` returns an `AdminApp`
 * assignable to `AdminAppPort`, which `packages/admin/test/app/admin-port.test.ts` checks at compile time. The elements
 * render `state` and call the intents; they never touch Firebase, Google or the address themselves.
 */
import type {
    AdminSetupKey,
    AdminShellKey,
    AdminsListResponse,
    ApiErrorCode,
    InviteResponse,
    Locale,
    RevokeRequest,
    ThemeTokens,
} from '@hcm/shared';

import type { ThemeMode } from '../theme/apply.js';
import type { SetupIntentsPort, SetupViewState } from './setup/setup-port.js';

export type AdminAuthStatePort =
    | 'starting'
    | 'configMissing'
    | 'signedOut'
    | 'signingIn'
    | 'probing'
    | 'bootstrap'
    | 'notOwner'
    | 'backendDown'
    | 'claimPending'
    | 'claiming'
    | 'joinPending'
    | 'notAdmin'
    | 'admin';

export type AdminRouteIdPort = 'setup' | 'photos' | 'pois' | 'layers' | 'jobs' | 'settings' | 'admins' | 'history' | 'crashes';

export interface AdminRoutePort {
    readonly id: AdminRouteIdPort;
    readonly params: readonly string[];
}

/** One destination of the navigation: its route, its icon, and whether the compact bar shows it (else "More"). */
export interface AdminDestinationPort {
    readonly id: AdminRouteIdPort;
    readonly icon: string;
    readonly compact: boolean;
}

/** A message key of any admin catalogue: the shell's, the Setup Assistant's or the API's error codes. */
export type AdminNoticeKey = AdminShellKey | AdminSetupKey | ApiErrorCode;

export interface AdminNoticeInputPort {
    readonly key: AdminNoticeKey;
    readonly params?: Readonly<Record<string, string>>;
}

export interface AdminNoticePort extends AdminNoticeInputPort {
    readonly id: number;
}

export interface AdminStatePort {
    readonly auth: AdminAuthStatePort;
    readonly mode: 'bootstrap' | 'normal' | null;
    readonly user: { readonly uid: string; readonly email: string | null; readonly displayName: string | null } | null;
    readonly role: 'owner' | 'admin' | null;
    readonly busy: boolean;
    readonly gate: { readonly reconsent: boolean; readonly issue: AdminNoticePort | null; readonly enableApi: string | null };
    readonly route: AdminRoutePort;
    readonly destinations: readonly AdminDestinationPort[];
    readonly locale: Locale;
    readonly theme: { readonly mode: ThemeMode; readonly city: ThemeTokens | null; readonly preview: ThemeTokens | null };
    readonly consent: 'unknown' | 'granted' | 'denied';
    readonly analytics: boolean;
    readonly windowClass: string;
    readonly notice: AdminNoticePort | null;
    readonly projectId: string;
    readonly authDomain: string;
    /** The Setup Assistant's state (setup-ui's `SetupViewState`), null before its controller exists or without one. */
    readonly setup: SetupViewState | null;
}

/** A call's result for a screen: the value, or the message to show. */
export type AdminOutcomePort<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AdminNoticeInputPort };

export interface AdminIntentsPort {
    signIn(): Promise<void>;
    signOut(): Promise<void>;
    claim(): Promise<void>;
    join(): Promise<void>;
    retry(): Promise<void>;
    enableApi(): Promise<void>;
    reload(): void;
    navigate(route: AdminRoutePort): void;
    setLocale(locale: Locale): void;
    setTheme(mode: ThemeMode): void;
    setConsent(consent: 'granted' | 'denied'): void;
    dismissNotice(): void;
    setWindowClass(windowClass: string): void;
    listAdmins(): Promise<AdminOutcomePort<AdminsListResponse>>;
    inviteAdmin(email: string): Promise<AdminOutcomePort<InviteResponse>>;
    revokeAdmin(request: RevokeRequest): Promise<AdminOutcomePort<{ readonly revoked: true }>>;
    /** The Setup Assistant's intents (setup-ui's `SetupIntentsPort`), null without one. */
    readonly setup: SetupIntentsPort | null;
}

export interface AdminAppPort {
    readonly state: AdminStatePort;
    subscribe(listener: (state: AdminStatePort) => void): () => void;
    readonly intents: AdminIntentsPort;
    /** The tag of a route's page element, once its module is loaded (null: no page). */
    loadPage(id: AdminRouteIdPort): Promise<string | null>;
}

/**
 * A page element (`registerAdminPage`): the shell creates it with the tag its loader names and sets `app` and `state`
 * on every change. Setup-ui's `<hcm-setup-page>` and M2c's pages implement this.
 */
export interface AdminPageElement extends HTMLElement {
    app: AdminAppPort | null;
    state: AdminStatePort | null;
}
