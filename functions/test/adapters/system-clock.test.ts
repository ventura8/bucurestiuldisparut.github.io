import { describe, expect, it } from 'vitest';

import { systemClock } from '../../src/adapters/system-clock.js';

describe('systemClock', () => {
    it('happyPath_readsTheCurrentTime', () => {
        const before = Date.now();

        const now = systemClock.now().getTime();

        expect(now).toBeGreaterThanOrEqual(before);
        expect(now).toBeLessThanOrEqual(Date.now());
    });
});
