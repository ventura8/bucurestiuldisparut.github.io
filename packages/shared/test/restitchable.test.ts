/** M20 (DECISIONS-for-review.md §205): the shared rule of a series Locate again lays on its overview again. */
import { describe, expect, it } from 'vitest';

import { helpFlagsOf, restitchable } from '../src/index.js';

const LEFT_OUT = { help: { stitched: { method: 'overview' as const, leftOutCount: 3 } } };

describe('restitchable', () => {
    it('happyPath_aPublishedArchiveSeriesWithPiecesLeftOutOfItsOverviewMosaic @S-A122-HAPPY-RESTITCH', () => {
        expect(restitchable({ origin: 'archive', state: 'published', ...LEFT_OUT })).toBe(true);
    });

    it.each([
        [
            'nothing left out',
            { origin: 'archive', state: 'published', help: { stitched: { method: 'overview' as const, leftOutCount: 0 } } },
        ],
        ['another mosaic', { origin: 'archive', state: 'published', help: { stitched: { method: 'pieces' as const, leftOutCount: 3 } } }],
        ['no help', { origin: 'archive', state: 'published' }],
        ['a USGS frame', { origin: 'usgs', state: 'published', ...LEFT_OUT }],
        ['not published', { origin: 'archive', state: 'awaiting_approval', ...LEFT_OUT }],
    ])('badPath_not_%s @S-A122-BAD-RESTITCH-NOTHING-LEFT', (_name, version) => {
        expect(restitchable(version)).toBe(false);
    });

    it('helpFlagsOf_saysTheLayoutCheckAndTheStitchAgain', () => {
        expect(helpFlagsOf({ state: 'needs_gcps', help: { reason: 'layout-check' } })).toEqual({ layoutCheck: true, restitchable: false });
        expect(helpFlagsOf({ state: 'needs_gcps', help: { reason: 'no-scale' } })).toEqual({ layoutCheck: false, restitchable: false });
        expect(helpFlagsOf({ origin: 'archive', state: 'published', ...LEFT_OUT })).toEqual({ layoutCheck: false, restitchable: true });
    });
});
