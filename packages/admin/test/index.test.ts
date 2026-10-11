import { createRecordingSink } from '@hcm/test-support';
import { describe, expect, it } from 'vitest';

import { bootAdmin } from '../src/index.js';

describe('bootAdmin', () => {
    it('happyPath_bootsInRomanianByDefault', () => {
        const recording = createRecordingSink();

        expect(bootAdmin({ sink: recording.sink })).toEqual({ locale: 'ro', title: 'Administrare' });
        expect(recording.records).toEqual([{ level: 'info', scope: 'admin', message: 'booted', data: { locale: 'ro' } }]);
    });

    it('happyPath_bootsInEnglish', () => {
        expect(bootAdmin({ locale: 'en', sink: createRecordingSink().sink }).title).toBe('Administration');
    });

    it('badPath_unsupportedLanguageFallsBackToRomanian', () => {
        expect(bootAdmin({ locale: 'de-AT', sink: createRecordingSink().sink }).locale).toBe('ro');
    });

    it('happyPath_registersTheSharedElements', () => {
        bootAdmin({ sink: createRecordingSink().sink });

        expect(customElements.get('hcm-hello')).toBeDefined();
    });
});
