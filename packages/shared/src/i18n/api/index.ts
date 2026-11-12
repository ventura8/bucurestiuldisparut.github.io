import { uiText } from '../registry.js';
import type { UiLocale } from '../locales.js';
import { en } from './en.js';
import { ro, type ApiErrorCode } from './ro.js';

export type { ApiErrorCode, ApiMessages } from './ro.js';

const CATALOGUES = { ro, en } as const;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Every error code the backend reports, in catalogue order. */
export const API_ERROR_CODES = Object.keys(ro) as readonly ApiErrorCode[];

/** True for every `apiError.*` key of the API catalogues. */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
    return typeof value === 'string' && Object.hasOwn(ro, value);
}

/** A parenthesised aside around one placeholder, with the space before it: ` (problems found: {count})`. */
const ASIDE = / ?\([^(){}]*\{(\w+)\}[^(){}]*\)/g;

/**
 * The localized message of a backend error code, `{name}` placeholders filled from `params`. An aside whose placeholder has
 * no value is dropped (a pipeline's `apiError.invalidRequest` has no count: the banner showed a literal `{count}`,
 * 2026-11-09); any other unknown placeholder stays visible.
 */
export function translateApiError(locale: UiLocale, code: ApiErrorCode, params: Readonly<Record<string, string>> = {}): string {
    return (uiText(locale, code, CATALOGUES) ?? '')
        .replace(ASIDE, (aside: string, name: string) => (params[name] === undefined ? '' : aside))
        .replace(PLACEHOLDER, (placeholder: string, name: string) => params[name] ?? placeholder);
}
