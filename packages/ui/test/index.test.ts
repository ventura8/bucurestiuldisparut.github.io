import { describe, expect, it } from 'vitest';

import * as ui from '../src/index.js';

describe('@hcm/ui public API', () => {
    it('happyPath_exportsElementsAndTokens', () => {
        expect(new Set(Object.keys(ui))).toEqual(
            new Set([
                'COMPACT_HEIGHT_MAX_PX',
                'HCM_HELLO_TAG',
                'HcmHello',
                'TOUCH_TARGET_MIN_PX',
                'WINDOW_CLASS_BREAKPOINTS',
                'defineHcmHello',
                'isCompactHeight',
                'windowClassFor',
            ]),
        );
    });
});

describe('@hcm/ui/dynamic-color', () => {
    it('happyPath_isASeparateEntryPoint', async () => {
        // A separate entry: @material/material-color-utilities imports without file extensions, which plain Node
        // (the engine's and admin's node tests, Cloud Functions) cannot resolve, so the main entry never loads it.
        const dynamicColor = await import('@hcm/ui/dynamic-color');

        expect(typeof dynamicColor.themeFromSeed).toBe('function');
    });
});
