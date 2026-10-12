// The admin's elements (`@hcm/ui/admin`, docs/research/M2b-interfaces.md §1.7): imported only by @hcm/admin, never by the
// engine, so the public viewer's bundle carries no admin element or text.
export { ADMIN_TAGS, defineAdminElements } from './define.js';
export { HCM_BLOCKED_PANEL_TAG, HcmBlockedPanel } from './auth/hcm-blocked-panel.js';
export { HCM_CLAIM_PANEL_TAG, HcmClaimPanel } from './auth/hcm-claim-panel.js';
export { HCM_CONSENT_NOTE_TAG, HcmConsentNote } from './auth/hcm-consent-note.js';
export type { GoogleScopePort } from './auth/hcm-consent-note.js';
export { HCM_JOIN_PANEL_TAG, HcmJoinPanel } from './auth/hcm-join-panel.js';
export { HCM_SIGN_IN_TAG, HcmSignIn } from './auth/hcm-sign-in.js';
export { AdminPanel, issueTemplate } from './auth/panel.js';
export { HCM_ACCOUNT_MENU_TAG, HcmAccountMenu } from './shell/hcm-account-menu.js';
export { HCM_ADMIN_NAV_TAG, HcmAdminNav } from './shell/hcm-admin-nav.js';
export type { AdminNavVariant } from './shell/hcm-admin-nav.js';
export { HCM_ADMIN_SHELL_TAG, HcmAdminShell, shellLayout, themeTokensOf } from './shell/hcm-admin-shell.js';
export type { ShellLayout } from './shell/hcm-admin-shell.js';
export { HCM_ADMINS_PAGE_TAG, HcmAdminsPage } from './shell/hcm-admins-page.js';
export { HCM_PAGE_OUTLET_TAG, HcmPageOutlet } from './shell/hcm-page-outlet.js';
export { adminBase, panelStyles } from './shell/admin-styles.js';
export { noticeOf, noticeText, shellText } from './shell/text.js';
// setup-ui's pages (`setup`, `crashes`), which the admin's page registry loads.
export { SETUP_PAGE_TAGS, defineSetupElements } from './setup/define.js';
export type {
    AdminAppPort,
    AdminAuthStatePort,
    AdminDestinationPort,
    AdminIntentsPort,
    AdminNoticeInputPort,
    AdminNoticeKey,
    AdminNoticePort,
    AdminOutcomePort,
    AdminPageElement,
    AdminRouteIdPort,
    AdminRoutePort,
    AdminStatePort,
} from './admin-port.js';
