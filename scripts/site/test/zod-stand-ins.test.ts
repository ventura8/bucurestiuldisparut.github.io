/** The admin's and the engine's resolution of zod's JSON Schema conversion and messages (DECISIONS-for-review.md §86, §93, §100a). */
import { describe, expect, it } from 'vitest';

import { zodStandIn, zodStandInsPlugin } from '../src/zod-stand-ins.js';

const CLASSIC = '/repo/node_modules/zod/v4/classic/schemas.js';
const ENGINE = { jsonSchema: '/stand-ins/json-schema.ts' } as const;
const ADMIN = { jsonSchema: '/stand-ins/json-schema.ts', messages: '/stand-ins/no-messages.ts' } as const;

describe('zodStandIn', () => {
    it('happyPath_theClassicSchemasConversionResolvesToTheStandInForBothBuilds', () => {
        expect(zodStandIn('../core/json-schema-processors.js', CLASSIC, ENGINE)).toBe('/stand-ins/json-schema.ts');
        expect(zodStandIn('../core/to-json-schema.js', CLASSIC, ADMIN)).toBe('/stand-ins/json-schema.ts');
    });

    it('happyPath_onlyABuildThatNamesAMessagesStandInLeavesOutZodsMessages', () => {
        expect(zodStandIn('../locales/en.js', CLASSIC, ADMIN)).toBe('/stand-ins/no-messages.ts');
        expect(zodStandIn('../locales/en.js', CLASSIC, ENGINE)).toBeNull();
    });

    it('badPath_anyOtherImportOrImporterKeepsZodsOwn', () => {
        expect(zodStandIn('../core/core.js', CLASSIC, ADMIN)).toBeNull();
        expect(zodStandIn('toString', CLASSIC, ADMIN)).toBeNull();
        expect(zodStandIn('../core/to-json-schema.js', '/repo/node_modules/zod/v4/core/api.js', ADMIN)).toBeNull();
        expect(zodStandIn('../core/to-json-schema.js', undefined, ADMIN)).toBeNull();
    });

    it('happyPath_thePluginResolvesBeforeTheBundler', () => {
        const plugin = zodStandInsPlugin(ENGINE);
        const resolve = plugin.resolveId as (source: string, importer: string | undefined) => string | null;

        expect(plugin.enforce).toBe('pre');
        expect(plugin.name).toBe('hcm-zod-stand-ins');
        expect(resolve('../core/to-json-schema.js', CLASSIC)).toBe('/stand-ins/json-schema.ts');
        expect(resolve('../locales/en.js', CLASSIC)).toBeNull();
    });
});
