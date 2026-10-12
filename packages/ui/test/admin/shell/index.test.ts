import { describe, expect, it } from 'vitest';

import * as admin from '../../../src/admin/index.js';

describe('@hcm/ui/admin', () => {
    it('happyPath_exposesTheShellsElementsAndHelpers', () => {
        expect(new Set(Object.keys(admin))).toEqual(
            new Set([
                'ADMIN_TAGS',
                'SETUP_PAGE_TAGS',
                'defineSetupElements',
                'AdminPanel',
                'HCM_ACCOUNT_MENU_TAG',
                'HCM_ADMINS_PAGE_TAG',
                'HCM_ADMIN_NAV_TAG',
                'HCM_ADMIN_SHELL_TAG',
                'HCM_BLOCKED_PANEL_TAG',
                'HCM_CLAIM_PANEL_TAG',
                'HCM_CONSENT_NOTE_TAG',
                'HCM_JOIN_PANEL_TAG',
                'HCM_PAGE_OUTLET_TAG',
                'HCM_SIGN_IN_TAG',
                'HcmAccountMenu',
                'HcmAdminNav',
                'HcmAdminShell',
                'HcmAdminsPage',
                'HcmBlockedPanel',
                'HcmClaimPanel',
                'HcmConsentNote',
                'HcmJoinPanel',
                'HcmPageOutlet',
                'HcmSignIn',
                'adminBase',
                'defineAdminElements',
                'issueTemplate',
                'noticeOf',
                'noticeText',
                'panelStyles',
                'shellLayout',
                'shellText',
                'themeTokensOf',
            ]),
        );
        expect(admin.ADMIN_TAGS).toContain(admin.HCM_ADMIN_SHELL_TAG);
    });
});
