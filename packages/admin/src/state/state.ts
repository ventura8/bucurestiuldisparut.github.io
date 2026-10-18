/**
 * The admin's state (`docs/research/M2b-interfaces.md` §1.7): one immutable object the shell renders, replaced on every
 * change (`store.ts`). `setup` is the Setup Assistant's own part (setup-ui), opaque to the shell.
 */
import type { AdminContentKey, AdminSetupKey, AdminShellKey, ApiErrorCode, Locale, ThemeTokens } from '@hcm/shared';

import type { AdminAuthState, AdminMode } from '../auth/auth-state.js';
import type { AuthUser } from '../firebase/ports.js';
import type { AdminRoute, AdminRouteId } from '../routing/routes.js';

export type ThemeMode = 'light' | 'dark' | 'system';

export type ConsentState = 'unknown' | 'granted' | 'denied';

type AdminRole = 'owner' | 'admin';

/** A message key of any admin catalogue: the shell's, the Setup Assistant's, the editors' or the API's error codes. */
export type NoticeKey = AdminShellKey | AdminSetupKey | AdminContentKey | ApiErrorCode;

export interface NoticeInput {
    readonly key: NoticeKey;
    readonly params?: Readonly<Record<string, string>>;
    /** The snackbar's action (an editor's Undo for ten seconds, `docs/research/M2c-interfaces.md` §9.5). */
    readonly action?: { readonly key: AdminContentKey; run(): void };
}

/** A message the snackbar (or a panel) shows; `id` changes with every notice, so the same text shows again. */
interface AdminNotice extends NoticeInput {
    readonly id: number;
}

interface AdminThemeState {
    readonly mode: ThemeMode;
    /** The city's precomputed tokens (`cities/{city}.theme.tokens`) once read; the kit's baseline before. */
    readonly city: ThemeTokens | null;
    /** A live preview (Settings' seed colour) shown over the city's until it is cleared. */
    readonly preview: ThemeTokens | null;
}

/** What the sign-in, claim and join panels show besides their action. */
export interface AdminGate {
    /** The sign-in asks again for the read-only Cloud scope: a reload in start-up mode left no Google token. */
    readonly reconsent: boolean;
    /** The panel's message (a closed popup, a refused claim). */
    readonly issue: AdminNotice | null;
    /** The sign-in panel offers to enable this Google API first (Resource Manager disabled, §3.3 a). */
    readonly enableApi: string | null;
}

/** One destination of the navigation (`ADMIN_ROUTE_SPECS`). */
export interface AdminDestination {
    readonly id: AdminRouteId;
    /** A Material Symbols name of the bundled subset. */
    readonly icon: string;
    /** One of the compact navigation bar's own destinations (the rest sit under "More"). */
    readonly compact: boolean;
}

/**
 * Leaving an edit that is not saved (`docs/research/M2c-interfaces.md` §2.4): the shell asks "Discard your changes?"
 * before it opens `route`, or before it signs out.
 */
type AdminLeaving = { readonly kind: 'route'; readonly route: AdminRoute } | { readonly kind: 'signOut' };

export interface AdminState<Setup = unknown> {
    readonly auth: AdminAuthState;
    /** Null until the probe has answered. */
    readonly mode: AdminMode | null;
    readonly user: AuthUser | null;
    readonly role: AdminRole | null;
    /** A join or claim click is running. */
    readonly busy: boolean;
    readonly gate: AdminGate;
    readonly route: AdminRoute;
    /** The navigation's destinations, in order (Setup only in start-up mode). */
    readonly destinations: readonly AdminDestination[];
    readonly locale: Locale;
    readonly theme: AdminThemeState;
    readonly consent: ConsentState;
    /** A GA4 measurement id exists, so the consent banner may ask. */
    readonly analytics: boolean;
    /** The shell's width class (`compact`, `medium`, ...), for crash reports. */
    readonly windowClass: string;
    readonly notice: AdminNotice | null;
    /** The unsaved-changes question while it is asked, else null. */
    readonly leaving: AdminLeaving | null;
    /**
     * The admin's access was removed while an editor held unsaved changes (`DECISIONS-for-review.md` §35e): the open page
     * stays, read-only (every write is refused at once), under a banner until sign-out (S-A20-BAD-REVOKED-WHILE-EDITING).
     */
    readonly revoked: boolean;
    /** From the web configuration: the project the texts name, the domain of Google's unverified-app screen. */
    readonly projectId: string;
    readonly authDomain: string;
    readonly setup: Setup;
}

export const NO_GATE: AdminGate = { reconsent: false, issue: null, enableApi: null };

/** The shell's part of the state: everything but the Setup Assistant's own. */
export type ShellState = Omit<AdminState, 'setup'>;

/** Read and change the shell's part of the state (the auth controller, the router, telemetry). */
export interface ShellStateAccess {
    get(): ShellState;
    update(patch: Partial<ShellState>): void;
    /** A notice with a fresh id. */
    notice(input: NoticeInput): AdminNotice;
}
