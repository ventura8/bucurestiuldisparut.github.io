import { describe, expect, it } from 'vitest';

import { en } from '../../src/i18n/map-labels/en.js';
import { basemapLabels, translateMapLabels } from '../../src/i18n/map-labels/index.js';

describe('basemapLabels', () => {
    it('happyPath_aKindTheConfigDoesNotSetIsDrawn', () => {
        expect(basemapLabels({})).toEqual({ streets: true, pois: true });
        expect(basemapLabels({ config: { lightPreset: 'day' } })).toEqual({ streets: true, pois: true });
    });

    it('happyPath_theCitysConfigTurnsThemOff', () => {
        expect(basemapLabels({ config: { showRoadLabels: false } })).toEqual({ streets: false, pois: true });
        expect(basemapLabels({ config: { showPointOfInterestLabels: false } })).toEqual({ streets: true, pois: false });
    });

    it('badPath_aValueThatIsNotABooleanFalseChangesNothing', () => {
        expect(basemapLabels({ config: { showRoadLabels: 'false', showPointOfInterestLabels: 0 } })).toEqual({ streets: true, pois: true });
    });
});

describe('translateMapLabels', () => {
    it('happyPath_bothLanguages', () => {
        expect(translateMapLabels('ro', 'mapLabels.streets')).toBe('Străzi');
        expect(translateMapLabels('en', 'mapLabels.streets')).toBe(en['mapLabels.streets']);
    });
});
