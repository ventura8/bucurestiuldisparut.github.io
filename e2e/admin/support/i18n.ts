import {
    translateAdminSetup,
    translateAdminShell,
    translateApiError,
    type AdminSetupKey,
    type AdminShellKey,
    type ApiErrorCode,
} from '@hcm/shared';

/**
 * The admin's texts as the user reads them (docs/research/M2b-interfaces.md §1.6): specs find controls by role and
 * their catalogue text, in the project's language, never by a hard-coded string.
 */

/** A shell text (`adminShell.*`): navigation, sign-in, the claim, Google's permissions. */
export function shellText(lang: 'ro' | 'en', key: AdminShellKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminShell(lang, key, params);
}

/** A Setup Assistant text (`adminSetup.*`). */
export function setupText(lang: 'ro' | 'en', key: AdminSetupKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminSetup(lang, key, params);
}

/** A server error's message (`apiError.*`), as a card shows the reason a callable gave. */
export function apiText(lang: 'ro' | 'en', code: ApiErrorCode, params: Readonly<Record<string, string>> = {}): string {
    return translateApiError(lang, code, params);
}
