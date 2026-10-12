import { describe, expect, it } from 'vitest';

import { layoutFor } from '../../src/viewer/layout.js';

describe('layoutFor', () => {
    it('happyPath_compactUsesBottomSheetsAndAFullScreenAbout', () => {
        expect(layoutFor('compact', false)).toEqual({
            sheetMode: 'bottom',
            layersDocked: false,
            timeline: 'horizontal',
            aboutFullscreen: true,
        });
    });

    it('happyPath_mediumUsesModalSideSheets', () => {
        expect(layoutFor('medium', false)).toMatchObject({ sheetMode: 'side', layersDocked: false, aboutFullscreen: false });
    });

    it('happyPath_expandedAndLargeDockOneSupportingPane', () => {
        expect(layoutFor('expanded', false)).toMatchObject({ sheetMode: 'docked', layersDocked: false });
        expect(layoutFor('large', false)).toMatchObject({ sheetMode: 'docked', layersDocked: false });
    });

    it('happyPath_extraLargeDocksTheLayersPanelToo', () => {
        expect(layoutFor('extra-large', false)).toMatchObject({ sheetMode: 'docked', layersDocked: true });
    });

    it('badPath_compactHeightWinsOverAnyWidth', () => {
        for (const windowClass of ['compact', 'medium', 'expanded', 'extra-large'] as const) {
            expect(layoutFor(windowClass, true)).toEqual({
                sheetMode: 'side',
                layersDocked: false,
                timeline: 'vertical',
                aboutFullscreen: true,
            });
        }
    });
});
