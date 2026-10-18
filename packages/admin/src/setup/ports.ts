/**
 * The ports the Setup Assistant's state machine runs on (`docs/research/M2b-interfaces.md` §3). The machine is DOM-free
 * and tested in Node with fakes; the composition root (admin-shell's `mount`, §1.7) passes the real adapters:
 *
 * - `google`: admin-shell's `GoogleAuthPort` and `GoogleAccessStore` (§2.2, §2.3): live tokens in memory, the consent
 *   popup;
 * - `cloud`: google-clients' typed REST clients and the provisioner (§3.3 b–d, g; §3.4);
 * - `backend`: the `setup.*` and `telemetry.listGroups` callables (`M2-interfaces.md` §3.3, §3.4) and
 *   `setup.createCity` (CR-M2b-1);
 * - `importer`: google-clients' legacy import (§3.3 h);
 * - `host`: what admin-shell knows about the project, the probe and the claim (§1.4, §3.3 d2);
 * - `clock`, `visibility`, `session`, `log`: time, the tab's visibility, `sessionStorage`, the logger.
 */
import type {
    AnalyticsConfigResponse,
    ApiErrorCode,
    ListGroupsRequest,
    ListGroupsResponse,
    Logger,
    ProvisionItem,
    RecordCloudRequest,
    RotatePublicTokenRequest,
    RotatePublicTokenResponse,
    SaveMapboxRequest,
    SaveMapboxResponse,
    SaveUsgsRequest,
    SaveUsgsResponse,
    SelfTestResponse,
    ServiceState,
    SetupStatusView,
} from '@hcm/shared';

import type { GoogleScope } from '../google/scopes.js';
import type { SetupMessageKey } from './messages.js';

/**
 * Time for polls, countdowns and token expiry (admin-shell's `Clock`): the browser's timers, so Playwright's
 * `page.clock` drives them.
 */
export interface SetupClock {
    /** Epoch milliseconds. */
    now(): number;
    /** Runs `callback` once after `ms`; the returned handle cancels it. */
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

/** Whether the tab is visible (admin-shell's `PageVisibility`): every poll pauses while it is hidden (§1.5). */
export interface VisibilityPort {
    visible(): boolean;
    /** Calls `listener` on every visibility change; returns the function that stops listening. */
    onChange(listener: (visible: boolean) => void): () => void;
}

/** `sessionStorage`, with the try/catch inside (a blocked store reads as empty). */
export interface SessionStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
}

/** A Google OAuth access token (`ya29.…`), held in memory only, at most an hour (§2.3). */
export interface GoogleAccess {
    readonly token: string;
    /** The granted scope URLs (from tokeninfo). */
    readonly scopes: readonly string[];
    /** Epoch milliseconds. */
    readonly expiresAt: number;
}

/**
 * Google consent for the signed-in owner (admin-shell's `GoogleAuthPort` over its `GoogleAccessStore`, §2.2).
 * `request` rejects with an error whose `code` is the Firebase Auth code (`auth/popup-blocked`,
 * `auth/popup-closed-by-user`, `auth/cancelled-popup-request`, `auth/user-mismatch`, `auth/network-request-failed`)
 * or `hcm/scope-denied`, `hcm/wrong-account` for tokeninfo's verdicts.
 */
export interface SetupGoogleAuth {
    /** The live token whose scopes satisfy `scope`, or null (none, another user's, or dropped). */
    live(scope: GoogleScope): GoogleAccess | null;
    /** Opens Google's popup for `scope`; must run in the click's synchronous part (popup blockers). Null: closed. */
    request(scope: GoogleScope): Promise<GoogleAccess | null>;
    /** Forgets every token (a Google 401). */
    drop(): void;
}

/** An open Cloud Billing account the owner may link (its display name is shown, never stored). */
export interface BillingAccount {
    /** `billingAccounts/XXXXXX-XXXXXX-XXXXXX`. */
    readonly name: string;
    readonly displayName: string;
    /** ISO 4217, e.g. `USD`. */
    readonly currency: string;
}

export interface BillingObservation {
    /** The open account the project is linked to (Blaze), or null. */
    readonly linkedAccount: string | null;
    /** The open accounts the owner can link, in Google's order. */
    readonly accounts: readonly BillingAccount[];
}

/** The $5 budget of §3.3 (b) step 4: one per project, found by name, patched to the spec when it exists. */
interface BudgetSpec {
    readonly accountName: string;
    readonly amount: number;
    readonly currency: string;
}

/** One doctor item as the provisioner reports it. */
export interface ProvisionItemResult {
    readonly id: ProvisionItem;
    readonly state: ServiceState;
    readonly detail?: SetupMessageKey | undefined;
    readonly params?: Readonly<Record<string, string>> | undefined;
}

/** The Cloud Functions list against the registry (§3.3 d). */
export interface DeploymentObservation {
    readonly ready: number;
    readonly total: number;
    /** Deployed names whose state is `FAILED`. */
    readonly failed: readonly string[];
}

/**
 * Google Cloud from the browser with the owner's token (google-clients). Every method rejects with a `GoogleFailure`:
 * an error whose `kind` is `unauthorized`, `forbidden` (with `role`, or `api` for `SERVICE_DISABLED`), `notFound`,
 * `conflict`, `rateLimited`, `unavailable`, `invalid` or `orgPolicy` (with `constraint`).
 */
export interface SetupCloud {
    /** The APIs of `apis` (`<name>.googleapis.com`) that are not enabled (Service Usage). */
    disabledApis(access: GoogleAccess, apis: readonly string[]): Promise<readonly string[]>;
    enableApis(access: GoogleAccess, apis: readonly string[]): Promise<void>;
    observeBilling(access: GoogleAccess): Promise<BillingObservation>;
    linkBilling(access: GoogleAccess, accountName: string): Promise<void>;
    ensureBudget(access: GoogleAccess, budget: BudgetSpec): Promise<{ readonly budgetId: string }>;
    /** Plans and applies the items of `only` (null: every item), reporting each as it settles. */
    provision(
        access: GoogleAccess,
        only: readonly ProvisionItem[] | null,
        onItem: (item: ProvisionItemResult) => void,
    ): Promise<readonly ProvisionItemResult[]>;
    /** The read-only doctor over `only` (null: every item). */
    doctor(
        access: GoogleAccess,
        only: readonly ProvisionItem[] | null,
        onItem: (item: ProvisionItemResult) => void,
    ): Promise<readonly ProvisionItemResult[]>;
    deployment(access: GoogleAccess): Promise<DeploymentObservation>;
    /** Turns the GA4 web stream's history page views off and reads the setting back (`notFound`: no stream). */
    disablePageChanges(access: GoogleAccess): Promise<{ readonly pageChangesEnabled: boolean }>;
    /** Switches the `crash-alerts` alert policy on or off and reads it back. */
    setCrashAlerts(access: GoogleAccess, enabled: boolean): Promise<{ readonly enabled: boolean }>;
}

/** The callables behind the cards; failures are the Firebase SDK's `FunctionsError` (`code`, `details`). */
export interface SetupBackend {
    status(): Promise<SetupStatusView>;
    selfTest(): Promise<SelfTestResponse>;
    recordCloud(request: RecordCloudRequest): Promise<{ readonly status: SetupStatusView }>;
    /** `setup.createCity` with the bundled city seed (CR-M2b-1); idempotent. */
    createCity(): Promise<{ readonly created: boolean }>;
    saveMapbox(request: SaveMapboxRequest): Promise<SaveMapboxResponse>;
    saveUsgs(request: SaveUsgsRequest): Promise<SaveUsgsResponse>;
    /** Replaces a public token (the panic button, security review §1.3); the old one is deleted 10 minutes later. */
    rotatePublicToken(request: RotatePublicTokenRequest): Promise<RotatePublicTokenResponse>;
    analyticsConfig(request: { readonly cityId: string }): Promise<AnalyticsConfigResponse>;
    listGroups(request: ListGroupsRequest): Promise<ListGroupsResponse>;
}

export interface LegacyImportFailure {
    /** The photo document id (the record's stable slug). */
    readonly id: string;
    readonly detail: ApiErrorCode;
}

export interface LegacyImportProgress {
    /** Photos imported and processed. */
    readonly done: number;
    readonly total: number;
    readonly failed: readonly LegacyImportFailure[];
}

/** The legacy Bucharest import (google-clients, §3.3 h): idempotent by document id and `legacyId`. */
export interface SetupLegacyImport {
    /** What is already imported, without writing. */
    detect(): Promise<LegacyImportProgress>;
    run(onProgress: (progress: LegacyImportProgress) => void): Promise<LegacyImportProgress>;
}

/** What the shell knows (admin-shell): the project, the city, and the switch to normal mode. */
export interface SetupHost {
    readonly projectId: string;
    /** The project number (`infra/project.json`), for the Workload Identity provider's name. */
    readonly projectNumber: string;
    /** The Firebase `authDomain`: where Google's unverified-app screen says to continue (§2.4). */
    readonly authDomain: string;
    readonly cityId: string;
    /** The city's bounding box `[west, south, east, north]` for the USGS access request, or null. */
    readonly cityBBox: readonly [number, number, number, number] | null;
    /**
     * Step (d) found every function `ACTIVE`: probe `admin-session` (§1.4). True when the server answers; the shell then
     * claims (d2) and calls the controller's `setMode('normal')`.
     */
    serverDeployed(): Promise<boolean>;
}

export interface SetupDeps {
    readonly host: SetupHost;
    readonly google: SetupGoogleAuth;
    readonly cloud: SetupCloud;
    readonly backend: SetupBackend;
    readonly importer: SetupLegacyImport;
    readonly clock: SetupClock;
    readonly visibility: VisibilityPort;
    readonly session: SessionStore;
    readonly log: Logger;
}
