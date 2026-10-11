import { describe, expect, it } from 'vitest';

import { GLOBAL_OPTIONS } from '../src/global-options.js';

describe('GLOBAL_OPTIONS', () => {
    it('happyPath_everythingRunsInUsCentral1WithAnInstanceCap', () => {
        expect(GLOBAL_OPTIONS).toEqual({ region: 'us-central1', maxInstances: 5 });
    });
});
