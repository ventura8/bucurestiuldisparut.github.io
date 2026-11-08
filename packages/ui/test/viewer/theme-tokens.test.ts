/**
 * The viewer's styles name the M3 tokens without a fallback (`shared-styles.ts`): `<hcm-map-viewer>` applies the theme
 * before its first render. This proves every `--md-sys-*` and `--md-ref-*` name a viewer source uses is one the theme
 * sets, so none is ever left without a value (a typo or a token the theme lacks would draw nothing).
 */
import { describe, expect, it } from 'vitest';

import { BASELINE_THEME } from '../../src/theme/baseline.js';
import { themeRules } from '../../src/theme/apply.js';

const SOURCES = import.meta.glob<string>('../../src/viewer/**/*.ts', { query: '?raw', import: 'default', eager: true });

/** Every `--md-sys-*` / `--md-ref-*` name a source reads with `var(...)`. */
function usedTokens(): ReadonlySet<string> {
    const names = Object.values(SOURCES).flatMap((source) =>
        [...source.matchAll(/var\((--md-(?:sys|ref)-[a-z0-9-]+)/g)].map((match) => match[1]),
    );
    return new Set(names.filter((name): name is string => name !== undefined));
}

describe('the viewer and the theme tokens', () => {
    it('happyPath_everyTokenTheViewerNamesIsSetByTheTheme', () => {
        for (const mode of ['light', 'dark'] as const) {
            const set = new Set(Object.keys(themeRules(BASELINE_THEME, mode, false)[0]?.declarations ?? {}));
            const missing = [...usedTokens()].filter((name) => !set.has(name));

            expect(missing).toEqual([]);
        }
    });

    it('badPath_theScanFindsTheTokens', () => {
        // A scan that found nothing would pass the check above vacuously.
        expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
        expect(usedTokens().has('--md-sys-color-on-surface')).toBe(true);
        expect(usedTokens().has('--md-ref-typeface-plain')).toBe(true);
    });
});
