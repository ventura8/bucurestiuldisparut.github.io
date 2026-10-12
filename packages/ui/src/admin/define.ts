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
import { defineHcmAdminsPage, HCM_ADMINS_PAGE_TAG } from './shell/hcm-admins-page.js';
import { defineHcmPageOutlet, HCM_PAGE_OUTLET_TAG } from './shell/hcm-page-outlet.js';

/** Every tag the admin shell defines (setup-ui's elements are registered by its own `define…`). */
export const ADMIN_TAGS = [
    HCM_ADMIN_SHELL_TAG,
    HCM_ADMIN_NAV_TAG,
    HCM_ACCOUNT_MENU_TAG,
    HCM_PAGE_OUTLET_TAG,
    HCM_ADMINS_PAGE_TAG,
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
    defineHcmAdminsPage,
    defineHcmSignIn,
    defineHcmConsentNote,
    defineHcmClaimPanel,
    defineHcmJoinPanel,
    defineHcmBlockedPanel,
];

/** Registers the kit and the admin shell's elements in `registry`; calling it again is a no-op. */
export function defineAdminElements(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    for (const define of DEFINERS) {
        define(registry);
    }
}
