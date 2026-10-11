import { describe, expect, it } from 'vitest';

import * as shared from '../src/index.js';

describe('@hcm/shared public API', () => {
    it('happyPath_exportsLoggingAndI18n', () => {
        expect(new Set(Object.keys(shared))).toEqual(
            new Set(['DEFAULT_LOCALE', 'LOCALES', 'REDACTED', 'consoleSink', 'createLogger', 'redact', 'resolveLocale', 'translate']),
        );
    });
});
