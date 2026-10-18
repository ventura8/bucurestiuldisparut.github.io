/**
 * Registers the admin's elements and the kit elements they render (idempotent per registry). Only `@hcm/admin`'s entry
 * calls it; the public viewer never imports `@hcm/ui/admin`, so no admin element or text reaches its bundle.
 */
import { defineUiKit } from '../components/define.js';
import { defineHcmBlockedPanel, HCM_BLOCKED_PANEL_TAG } from './auth/hcm-blocked-panel.js';
import { defineHcmClaimPanel, HCM_CLAIM_PANEL_TAG } from './auth/hcm-claim-panel.js';
import { defineHcmConsentNote, HCM_CONSENT_NOTE_TAG } from './auth/hcm-consent-note.js';
import { defineHcmJoinPanel, HCM_JOIN_PANEL_TAG } from './auth/hcm-join-panel.js';
import { defineHcmSignIn, HCM_SIGN_IN_TAG } from './auth/hcm-sign-in.js';
import { defineHcmAccountMenu, HCM_ACCOUNT_MENU_TAG } from './shell/hcm-account-menu.js';
import { defineHcmAdminNav, HCM_ADMIN_NAV_TAG } from './shell/hcm-admin-nav.js';
import { defineHcmAdminShell, HCM_ADMIN_SHELL_TAG } from './shell/hcm-admin-shell.js';
import { defineHcmPageOutlet, HCM_PAGE_OUTLET_TAG } from './shell/hcm-page-outlet.js';
import { defineEditingElements } from './editing/define.js';
// The M2c editors' pages (docs/research/M2c-interfaces.md §11.2): one marked section per area; a workstream adds its
// imports, its tags to `EDITOR_PAGE_TAGS` and its definer to `EDITOR_DEFINERS` inside its own sections only.
// [section photos] owner: photos
import { definePhotosElements } from './photos/define.js';
import { HCM_PHOTOS_PAGE_TAG } from './photos/hcm-photos-page.js';
// [end photos]
// [section pois] owner: pois
import { definePoisElements } from './pois/define.js';
import { HCM_POIS_PAGE_TAG } from './pois/hcm-pois-page.js';
// [end pois]
// [section layers] owner: layers-settings
import { defineLayersElements } from './layers/define.js';
import { HCM_LAYERS_PAGE_TAG } from './layers/hcm-layers-page.js';
// [end layers]
// [section settings] owner: layers-settings
import { defineSettingsElements } from './settings/define.js';
import { HCM_SETTINGS_PAGE_TAG } from './settings/hcm-settings-page.js';
// [end settings]
// [section ops] owner: ops-screens (admins, history, jobs, crash reports, the dashboard)
import { defineHcmAdminsPage, HCM_ADMINS_PAGE_TAG } from './admins/hcm-admins-page.js';
import { defineHcmCrashesListPage, HCM_CRASHES_LIST_PAGE_TAG } from './crashes/hcm-crashes-list-page.js';
import { defineHcmHistoryPage, HCM_HISTORY_PAGE_TAG } from './history/hcm-history-page.js';
import { defineHcmHomePage, HCM_HOME_PAGE_TAG } from './home/hcm-home-page.js';
import { defineHcmJobsPage, HCM_JOBS_PAGE_TAG } from './jobs/hcm-jobs-page.js';
// [end ops]

/** The editors' page tags by route (the admin's page registry names them; `defineAdminElements` registers them). */
export const EDITOR_PAGE_TAGS = {
    // [section photos] owner: photos
    photos: HCM_PHOTOS_PAGE_TAG,
    // [end photos]
    // [section pois] owner: pois
    pois: HCM_POIS_PAGE_TAG,
    // [end pois]
    // [section layers] owner: layers-settings
    layers: HCM_LAYERS_PAGE_TAG,
    // [end layers]
    // [section settings] owner: layers-settings
    settings: HCM_SETTINGS_PAGE_TAG,
    // [end settings]
    // [section ops] owner: ops-screens
    home: HCM_HOME_PAGE_TAG,
    admins: HCM_ADMINS_PAGE_TAG,
    history: HCM_HISTORY_PAGE_TAG,
    jobs: HCM_JOBS_PAGE_TAG,
    crashes: HCM_CRASHES_LIST_PAGE_TAG,
    // [end ops]
} as const;

const EDITOR_DEFINERS: readonly ((registry: CustomElementRegistry) => void)[] = [
    // [section photos] owner: photos
    definePhotosElements,
    // [end photos]
    // [section pois] owner: pois
    definePoisElements,
    // [end pois]
    // [section layers] owner: layers-settings
    defineLayersElements,
    // [end layers]
    // [section settings] owner: layers-settings
    defineSettingsElements,
    // [end settings]
    // [section ops] owner: ops-screens
    defineHcmHomePage,
    defineHcmAdminsPage,
    defineHcmHistoryPage,
    defineHcmJobsPage,
    defineHcmCrashesListPage,
    // [end ops]
];

/** Every tag the admin shell defines (setup-ui's elements are registered by its own `define…`). */
export const ADMIN_TAGS = [
    HCM_ADMIN_SHELL_TAG,
    HCM_ADMIN_NAV_TAG,
    HCM_ACCOUNT_MENU_TAG,
    HCM_PAGE_OUTLET_TAG,
    HCM_SIGN_IN_TAG,
    HCM_CONSENT_NOTE_TAG,
    HCM_CLAIM_PANEL_TAG,
    HCM_JOIN_PANEL_TAG,
    HCM_BLOCKED_PANEL_TAG,
] as const;

const DEFINERS: readonly ((registry: CustomElementRegistry) => void)[] = [
    defineHcmAdminShell,
    defineHcmAdminNav,
    defineHcmAccountMenu,
    defineHcmPageOutlet,
    defineHcmSignIn,
    defineHcmConsentNote,
    defineHcmClaimPanel,
    defineHcmJoinPanel,
    defineHcmBlockedPanel,
];

/** Registers the kit, the admin shell's elements, the editing kit and the editors' pages; calling it again is a no-op. */
export function defineAdminElements(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    defineEditingElements(registry);
    for (const define of [...DEFINERS, ...EDITOR_DEFINERS]) {
        define(registry);
    }
}
