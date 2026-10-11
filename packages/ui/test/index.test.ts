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
