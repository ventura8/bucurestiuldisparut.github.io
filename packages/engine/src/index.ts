import './engine.css';

import { createLogger, resolveLocale, translate, type Locale, type LogSink } from '@hcm/shared';
import { defineHcmHello } from '@hcm/ui';

/** Engine release; the IIFE build exposes it as window.HistoricCityMap.ENGINE_VERSION. */
export const ENGINE_VERSION = '0.0.0';

/** Mapbox GL JS version the engine is written against; pages load exactly this one from api.mapbox.com. */
export const MAPBOX_GL_VERSION = '3.32.0';

export interface EngineInfo {
    readonly version: string;
    readonly mapboxGlVersion: string;
    readonly locale: Locale;
    readonly title: string;
}

export interface BootOptions {
    /** BCP 47 language of the page; anything other than English renders in Romanian. */
    readonly locale?: string;
    /** Log destination; defaults to the console sink of @hcm/shared. */
    readonly sink?: LogSink;
}

/** Registers the engine's custom elements and reports what was booted. M1 replaces this with the viewer. */
export function boot(options: BootOptions = {}): EngineInfo {
    const locale = resolveLocale(options.locale);
    defineHcmHello();
    const info: EngineInfo = {
        version: ENGINE_VERSION,
        mapboxGlVersion: MAPBOX_GL_VERSION,
        locale,
        title: translate(locale, 'engine.name'),
    };
    createLogger('engine', options.sink === undefined ? {} : { sink: options.sink }).info('booted', { version: ENGINE_VERSION, locale });
    return info;
}
