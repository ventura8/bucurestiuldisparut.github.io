/**
 * The admin's texts (`docs/research/M2b-interfaces.md` §1.6): a notice key may come from the shell's catalogue
 * (`adminShell.*`), the Setup Assistant's (`adminSetup.*`) or the API's error codes (`apiError.*`). The language and
 * theme choices reuse the viewer's words (`language.*`, `theme.*`, `consent.*`, through `translate`). Elements receive no
 * free text from the app: every message shown goes through here.
 */
import {
    isApiErrorCode,
    translateAdminSetup,
    translateAdminShell,
    translateApiError,
    type AdminSetupKey,
    type AdminShellKey,
    type Locale,
} from '@hcm/shared';

import type { AdminNoticeInputPort, AdminNoticeKey } from '../admin-port.js';

type Params = Readonly<Record<string, string>>;

/** A shell text. */
export function shellText(locale: Locale, key: AdminShellKey, params?: Params): string {
    return translateAdminShell(locale, key, params);
}

function isSetupKey(key: AdminNoticeKey): key is AdminSetupKey {
    return key.startsWith('adminSetup.');
}

/** Any admin message key, by its family. */
export function noticeText(locale: Locale, key: AdminNoticeKey, params?: Params): string {
    if (isApiErrorCode(key)) {
        return translateApiError(locale, key, params);
    }
    return isSetupKey(key) ? translateAdminSetup(locale, key, params) : shellText(locale, key, params);
}

/** A notice as text (none: empty). */
export function noticeOf(locale: Locale, notice: AdminNoticeInputPort | null): string {
    return notice === null ? '' : noticeText(locale, notice.key, notice.params);
}
