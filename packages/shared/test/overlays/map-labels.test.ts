import { describe, expect, it } from 'vitest';

import { en } from '../../src/i18n/map-labels/en.js';
import { basemapLabels, transitLabels, translateMapLabels } from '../../src/i18n/map-labels/index.js';

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

describe('transitLabels', () => {
    it('happyPath_transitStationsFollowThePointsOfInterest', () => {
        expect(transitLabels(undefined, false)).toBe(false);
        expect(transitLabels(undefined, true)).toBe(true);
        expect(transitLabels({ showPointOfInterestLabels: false }, false)).toBe(false);
        expect(transitLabels({ showPointOfInterestLabels: false }, true)).toBe(true);
    });

    it('happyPath_theCitysExplicitChoiceStandsAtItsDefault', () => {
        expect(transitLabels({ showTransitLabels: false }, true)).toBe(false);
        expect(transitLabels({ showPointOfInterestLabels: false, showTransitLabels: true }, false)).toBe(true);
        expect(transitLabels({ showTransitLabels: true }, true)).toBe(true);
    });

    it('badPath_aTurnedOffSwitchHidesThemEvenWhereTheCityShowsThem', () => {
        expect(transitLabels({ showTransitLabels: true }, false)).toBe(false);
        expect(transitLabels({ showTransitLabels: 'yes', showPointOfInterestLabels: 0 }, false)).toBe(false);
    });
});

describe('translateMapLabels', () => {
    it('happyPath_bothLanguages', () => {
        expect(translateMapLabels('ro', 'mapLabels.streets')).toBe('Numele străzilor');
        expect(translateMapLabels('en', 'mapLabels.streets')).toBe(en['mapLabels.streets']);
    });
});
