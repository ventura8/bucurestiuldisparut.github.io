import { describe, expect, it } from 'vitest';

import * as functions from '../src/index.js';

describe('deployed functions', () => {
    it('happyPath_exportsOnlyTheSetupStatusCallable', () => {
        expect(Object.keys(functions)).toEqual(['setup']);
        expect(Object.keys(functions.setup)).toEqual(['status']);
    });
});
