/**
 * The Setup Assistant's texts in the page's language: a {@link SetupMessage} from any of its three catalogues
 * (`adminSetup.*`, `adminShell.*`, `apiError.*`), dates, times and amounts through `Intl`. Rendered as text only.
 */
import {
    PROVISION_ITEMS,
    translateAdminSetup,
    translateAdminShell,
    translateApiError,
    type AdminSetupKey,
    type AdminShellKey,
    type Locale,
    type ProvisionItem,
} from '@hcm/shared';

import type { GoogleScopeName, SetupMessage, SetupMessageKey, SetupStepId } from './setup-port.js';

const SCOPE_NAMES: ReadonlySet<string> = new Set<GoogleScopeName>(['cloudReadOnly', 'cloudBilling', 'cloudPlatform', 'analyticsEdit']);

const STEP_NAMES: ReadonlySet<string> = new Set<SetupStepId>([
    'signIn',
    'billing',
    'provision',
    'deploy',
    'claim',
    'mapbox',
    'usgs',
    'analytics',
    'legacyImport',
]);

const ITEM_NAMES: ReadonlySet<string> = new Set<ProvisionItem>(PROVISION_ITEMS);

function isScopeName(value: string): value is GoogleScopeName {
    return SCOPE_NAMES.has(value);
}

function isStepName(value: string): value is SetupStepId {
    return STEP_NAMES.has(value);
}

function isItemName(value: string): value is ProvisionItem {
    return ITEM_NAMES.has(value);
}

function isSetupKey(key: SetupMessageKey): key is AdminSetupKey {
    return key.startsWith('adminSetup.');
}

function isShellKey(key: SetupMessageKey): key is AdminShellKey {
    return key.startsWith('adminShell.');
}

/** A scope by Google's own label of it (anything else as it is). */
function scopeLabel(locale: Locale, scope: string): string {
    return isScopeName(scope) ? translateAdminShell(locale, `adminShell.oauth.scope.${scope}`) : scope;
}

/** What a doctor item waits for: another item or a step, by its label (anything else as it is). */
function itemLabel(locale: Locale, item: string): string {
    if (isItemName(item)) {
        return translateAdminSetup(locale, `adminSetup.provision.item.${item}`);
    }
    return isStepName(item) ? translateAdminSetup(locale, `adminSetup.step.${item}`) : item;
}

/** A `scope` parameter is shown by Google's label of the scope, an `item` parameter by the item's or step's label. */
function localizedParams(locale: Locale, params: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
    const { scope, item } = params;
    return {
        ...params,
        ...(scope === undefined ? {} : { scope: scopeLabel(locale, scope) }),
        ...(item === undefined ? {} : { item: itemLabel(locale, item) }),
    };
}

/** The message in `locale`. */
export function setupText(locale: Locale, message: SetupMessage): string {
    const params = localizedParams(locale, message.params ?? {});
    const { key } = message;
    if (isSetupKey(key)) {
        return translateAdminSetup(locale, key, params);
    }
    return isShellKey(key) ? translateAdminShell(locale, key, params) : translateApiError(locale, key, params);
}

/** Shorthand for a Setup Assistant key. */
export function setupLabel(locale: Locale, key: AdminSetupKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminSetup(locale, key, params);
}

const INTL_LOCALES: Readonly<Record<Locale, string>> = { ro: 'ro-RO', en: 'en-GB' };

/** "12 oct. 2026" / "12 Oct 2026" (Bucharest time: the map's city). */
export function formatDate(locale: Locale, iso: string): string {
    return new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle: 'medium', timeZone: 'Europe/Bucharest' }).format(new Date(iso));
}

/** "12 oct. 2026, 14:05" / "12 Oct 2026, 14:05". */
export function formatDateTime(locale: Locale, iso: string): string {
    return new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Bucharest' }).format(
        new Date(iso),
    );
}

/** "5 USD" / "US$5": the budget in its currency, whole units. */
export function formatMoney(locale: Locale, amount: number, currency: string): string {
    return new Intl.NumberFormat(INTL_LOCALES[locale], {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}
