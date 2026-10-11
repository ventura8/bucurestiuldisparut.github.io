import './admin.css';

import { createLogger, resolveLocale, translate, type Locale, type LogSink } from '@hcm/shared';
import { defineHcmHello } from '@hcm/ui';

export interface AdminInfo {
    readonly locale: Locale;
    readonly title: string;
}

export interface AdminBootOptions {
    /** BCP 47 language of the admin UI; anything other than English renders in Romanian. */
    readonly locale?: string;
    /** Log destination; defaults to the console sink of @hcm/shared. */
    readonly sink?: LogSink;
}

/** Registers the admin's custom elements and reports the resolved UI language. M2 replaces this with the app shell. */
export function bootAdmin(options: AdminBootOptions = {}): AdminInfo {
    const locale = resolveLocale(options.locale);
    defineHcmHello();
    createLogger('admin', options.sink === undefined ? {} : { sink: options.sink }).info('booted', { locale });
    return { locale, title: translate(locale, 'admin.title') };
}
