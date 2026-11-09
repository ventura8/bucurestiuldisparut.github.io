/**
 * M25 (`docs/research/M25-landsat.md` §2, §5): Landsat in the Imagery area. One chip filters both Landsat datasets, a Landsat scene
 * names its dataset, and its version's approval card says its shift from Sentinel-2 and the city's cloud instead of a checkpoint error,
 * and why it waits when it is not clear.
 */
import type { LandsatReport } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { datasetText } from '../../../src/admin/imagery/imagery-text.js';
import { cleanup, deep, deepAll } from '../shell/fake-app.js';
import { click, defineImagery, imageryPage, imageryState, nth, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };
const LANDSAT_CHIP = 5;
const CLEAR: LandsatReport = { checked: true, offsetPx: 0.4, offsetM: 12, cityCloudPct: 2, resolutionM: 30, pansharpened: false };

function calls(area: { readonly calls: readonly string[] }): readonly string[] {
    return area.calls.filter((call) => call.startsWith('setFilters'));
}

async function card(report: LandsatReport) {
    const view = versionView({ landsat: report, georef: null, sensor: 'L5-TM' });
    return imageryPage(imageryState({ detail: VERSION, version: versionPage({}, view) }), { params: ['version', 'job-1966'] });
}

describe('<hcm-imagery-page>: Landsat', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_oneLandsatChipFiltersBothDatasets @S-A130-HAPPY', async () => {
        const { element, area } = await imageryPage();
        const chip = nth(element, '.filters hcm-chip', LANDSAT_CHIP) as HTMLElement & { label: string };

        click(chip);

        expect(chip.label).toBe('Landsat');
        expect(calls(area)).toEqual(['setFilters {"datasets":["landsat_tm_c2_l1","landsat_etm_c2_l1"]}']);
        expect([datasetText('en', 'landsat_tm_c2_l1'), datasetText('ro', 'landsat_etm_c2_l1')]).toEqual([
            'Landsat 4–5 TM',
            'Landsat 7 ETM+',
        ]);
    });

    it('badPath_theChosenLandsatChipTakesBothOutAndKeepsTheOthers @S-A130-BAD-CLOUDY', async () => {
        const filters = { ...imageryState().filters, datasets: ['corona2', 'landsat_tm_c2_l1', 'landsat_etm_c2_l1'] as const };
        const { element, area } = await imageryPage(imageryState({ filters }));
        const chip = nth(element, '.filters hcm-chip', LANDSAT_CHIP) as HTMLElement & { selected: boolean };

        const selected = chip.selected;
        click(chip);

        expect(selected).toBe(true);
        expect(calls(area)).toEqual(['setFilters {"datasets":["corona2"]}']);
    });

    it('happyPath_aClearSceneSaysItsShiftAndTheCitysCloud @S-A130-HAPPY', async () => {
        const { element } = await card(CLEAR);
        const shift = deep(element, '[data-landsat="clear"]');

        expect(shift.textContent).toContain('Off Sentinel-2 by 0.4 px (12 m)');
        expect(deep(element, '#approval-title').closest('section')?.textContent).toContain('Clouds over the city: 2%');
        expect(deepAll(element, '[data-rmse]')).toHaveLength(0);
        expect(await axeViolations(deep(element, '#approval-title').closest('section') ?? element)).toEqual([]);
    });

    it.each([
        ['off by more than a pixel', { ...CLEAR, offsetPx: 1.7, offsetM: 51 }, 'Off Sentinel-2 by 1.7 px (51 m)'],
        ['unmeasured', { checked: false, cityCloudPct: 0, resolutionM: 30, pansharpened: false }, 'could not be measured'],
    ] as const)('badPath_aSceneThatIsNotClearSaysWhyItWaits_%s @S-A130-BAD-OFFSET', async (_case, report: LandsatReport, words) => {
        const { element } = await card(report);

        expect(deep(element, '[data-landsat="held"]').textContent).toContain(words);
        expect(deep(element, '#approval-title').closest('section')?.textContent).toContain('Waits for your approval');
    });
});
