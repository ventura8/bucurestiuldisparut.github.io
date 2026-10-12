import type { Locale } from '../index.js';
import { en } from './en.js';
import { ro, type ApiErrorCode, type ApiMessages } from './ro.js';

export type { ApiErrorCode, ApiMessages } from './ro.js';

const CATALOGUES: Readonly<Record<Locale, ApiMessages>> = { ro, en };

const PLACEHOLDER = /\{(\w+)\}/g;

/** Every error code the backend reports, in catalogue order. */
export const API_ERROR_CODES = Object.keys(ro) as readonly ApiErrorCode[];

/** True for every `apiError.*` key of the API catalogues. */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
    return typeof value === 'string' && Object.hasOwn(ro, value);
}

/** The localized message of a backend error code, `{name}` placeholders filled from `params` (unknown ones stay visible). */
export function translateApiError(locale: Locale, code: ApiErrorCode, params: Readonly<Record<string, string>> = {}): string {
    return CATALOGUES[locale][code].replace(PLACEHOLDER, (placeholder: string, name: string) => params[name] ?? placeholder);
}
