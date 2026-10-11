import { createRecordingSink } from '@hcm/test-support';
import { describe, expect, it } from 'vitest';

import { ENGINE_VERSION, MAPBOX_GL_VERSION, boot } from '../src/index.js';

describe('boot', () => {
    it('happyPath_bootsInRomanianByDefault', () => {
        const recording = createRecordingSink();

        const info = boot({ sink: recording.sink });

        expect(info).toEqual({ version: ENGINE_VERSION, mapboxGlVersion: '3.32.0', locale: 'ro', title: 'Hartă istorică a orașului' });
        expect(recording.records).toEqual([
            { level: 'info', scope: 'engine', message: 'booted', data: { version: ENGINE_VERSION, locale: 'ro' } },
        ]);
    });

    it('happyPath_bootsInEnglishWhenThePageIsEnglish', () => {
        const info = boot({ locale: 'en-US', sink: createRecordingSink().sink });

        expect(info.title).toBe('Historical city map');
    });

    it('badPath_unsupportedLanguageFallsBackToRomanian', () => {
        expect(boot({ locale: 'fr', sink: createRecordingSink().sink }).locale).toBe('ro');
    });

    it('happyPath_registersTheEngineElements', () => {
        boot({ sink: createRecordingSink().sink });

        expect(customElements.get('hcm-hello')).toBeDefined();
    });

    it('happyPath_pinsTheMapboxCdnVersion', () => {
        expect(MAPBOX_GL_VERSION).toBe('3.32.0');
    });
});
