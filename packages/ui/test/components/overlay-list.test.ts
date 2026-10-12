import { translate, type Locale } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import {
    defineHcmOverlayList,
    type HcmOverlayList,
    type OverlayListGroup,
    type OverlayListItem,
} from '../../src/components/overlay-list.js';
import type { HcmSlider } from '../../src/components/slider.js';
import { cleanup, fixture, nextFrame, press, recordEvents, release, shadowPart } from '../helpers.js';

defineHcmOverlayList();

const ITEMS: readonly OverlayListItem[] = [
    { id: 'ortofoto-1945', kind: 'raster', label: 'Ortofoto 1945', visible: true, opacity: 0.8 },
    { id: 'plan-1911', kind: 'raster', label: 'Planul 1911', visible: false, opacity: 1 },
    { id: 'photos', kind: 'photos', label: 'Fotografii', visible: true, opacity: 1 },
    { id: 'cladiri', kind: 'poi', label: 'Clădiri dispărute', visible: true, opacity: 0.55, color: '#8B5E3C', icon: 'domain_disabled' },
];

function groups(locale: Locale): readonly OverlayListGroup[] {
    return [
        { kind: 'raster', label: translate(locale, 'layers.group.historical') },
        { kind: 'poi', label: translate(locale, 'layers.group.places') },
    ];
}

function list(locale: Locale, items: readonly OverlayListItem[] = ITEMS): Promise<HcmOverlayList> {
    return fixture<HcmOverlayList>(
        html`<hcm-overlay-list
            style="width: 360px"
            .items=${items}
            .groups=${groups(locale)}
            toggle-label=${translate(locale, 'layers.toggle')}
            opacity-label=${translate(locale, 'layers.opacity')}
            value-text=${translate(locale, 'layers.opacityValue')}
            changed-text=${translate(locale, 'layers.opacityChanged')}
            shown-text=${translate(locale, 'layers.shown')}
            hidden-text=${translate(locale, 'layers.hidden')}
        ></hcm-overlay-list>`,
    );
}

function sliderOf(element: HcmOverlayList, id: string): HcmSlider {
    return shadowPart(element, `[data-overlay="${id}"] hcm-slider`) as HcmSlider;
}

function liveRegion(element: HcmOverlayList): string {
    return shadowPart(element, '[role="status"]').textContent.trim();
}

describe('<hcm-overlay-list>', () => {
    afterEach(cleanup);

    it('happyPath_rowsUnderTheirGroupHeadingsInRomanian', async () => {
        const element = await list('ro');

        expect([...(element.shadowRoot?.querySelectorAll('h3') ?? [])].map((heading) => heading.textContent)).toEqual([
            'Straturi istorice',
            'Locuri',
        ]);
        await expect.element(page.getByRole('switch', { name: 'Afișează Ortofoto 1945' })).toBeChecked();
        await expect.element(page.getByRole('switch', { name: 'Afișează Planul 1911' })).not.toBeChecked();
        await expect.element(page.getByRole('slider', { name: 'Opacitate: Clădiri dispărute' })).toHaveAttribute('aria-valuetext', '55 %');
        expect(shadowPart(element, '[data-overlay="cladiri"] .value').textContent).toBe('55 %');
        expect(shadowPart(element, '[data-overlay="cladiri"] .swatch').style.getPropertyValue('--swatch')).toBe('#8B5E3C');
        expect(shadowPart(element, '[data-overlay="photos"] hcm-icon').getAttribute('name')).toBe('photo_library');
        expect(shadowPart(element, '[data-overlay="plan-1911"] hcm-icon').getAttribute('name')).toBe('map');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theSwitchReportsVisibilityAndAnnouncesItInEnglish', async () => {
        const element = await list('en');
        const changes = recordEvents(element, 'hcm-overlay-visibility');
        const leaked = recordEvents(element, 'hcm-change');

        await userEvent.click(page.getByRole('switch', { name: 'Show Planul 1911' }));
        await element.updateComplete;
        expect(liveRegion(element)).toBe('Planul 1911: shown');
        await userEvent.click(page.getByRole('switch', { name: 'Show Ortofoto 1945' }));
        await element.updateComplete;

        expect(changes).toEqual([
            { id: 'plan-1911', visible: true },
            { id: 'ortofoto-1945', visible: false },
        ]);
        expect(liveRegion(element)).toBe('Ortofoto 1945: hidden');
        expect(leaked).toEqual([]);
    });

    it('happyPath_keyboardFadesLiveAndAnnouncesOnRelease', async () => {
        const element = await list('en');
        const changes = recordEvents(element, 'hcm-overlay-opacity');
        const handle = shadowPart(sliderOf(element, 'ortofoto-1945'), '.handle');

        press(handle, 'ArrowLeft');
        press(handle, 'PageDown');
        release(handle, 'PageDown');
        await element.updateComplete;

        expect(changes).toEqual([
            { id: 'ortofoto-1945', opacity: 0.79, final: false },
            { id: 'ortofoto-1945', opacity: 0.69, final: false },
            { id: 'ortofoto-1945', opacity: 0.69, final: true },
        ]);
        expect(liveRegion(element)).toBe('Ortofoto 1945: opacity 69 %');
    });

    it('happyPath_draggingFadesPerFrame', async () => {
        const element = await list('ro');
        const changes = recordEvents<{ opacity: number; final: boolean }>(element, 'hcm-overlay-opacity');
        const track = shadowPart(sliderOf(element, 'photos'), '.track');
        const box = track.getBoundingClientRect();
        const at = (fraction: number): number => box.left + 8 + fraction * (box.width - 16);

        track.dispatchEvent(new PointerEvent('pointerdown', { clientX: at(0.5), button: 0, bubbles: true, composed: true }));
        await nextFrame();
        document.dispatchEvent(new PointerEvent('pointerup', { clientX: at(0.5) }));

        expect(changes).toEqual([
            { id: 'photos', opacity: 0.5, final: false },
            { id: 'photos', opacity: 0.5, final: true },
        ]);
    });

    it('badPath_keysPastTheEndsStayWithin0And100', async () => {
        const element = await list('en');
        const changes = recordEvents(element, 'hcm-overlay-opacity');
        const handle = shadowPart(sliderOf(element, 'plan-1911'), '.handle');

        press(handle, 'ArrowRight');
        press(handle, 'End');
        release(handle, 'End');

        expect(changes).toEqual([]);
        await expect.element(page.getByRole('slider', { name: 'Opacity: Planul 1911' })).toHaveAttribute('aria-valuenow', '100');
    });

    it('badPath_aHiddenOverlayKeepsItsSliderAndStaysHidden', async () => {
        const element = await list('en');
        const visibility = recordEvents(element, 'hcm-overlay-visibility');
        const opacity = recordEvents(element, 'hcm-overlay-opacity');
        const slider = page.getByRole('slider', { name: 'Opacity: Planul 1911' });

        await expect.element(slider).not.toHaveAttribute('aria-disabled');
        press(shadowPart(sliderOf(element, 'plan-1911'), '.handle'), 'Home');

        expect(opacity).toEqual([{ id: 'plan-1911', opacity: 0, final: false }]);
        expect(visibility).toEqual([]);
    });

    it('happyPath_newItemsFromTheAppAreShown', async () => {
        const element = await list('en');

        element.items = ITEMS.map((item) => (item.id === 'photos' ? { ...item, opacity: 0.3, visible: false } : item));
        await element.updateComplete;

        await expect.element(page.getByRole('slider', { name: 'Opacity: Fotografii' })).toHaveAttribute('aria-valuenow', '30');
        await expect.element(page.getByRole('switch', { name: 'Show Fotografii' })).not.toBeChecked();
    });

    it('badPath_noItemsAndNoGroupsRenderNothingButTheLiveRegion', async () => {
        const element = await fixture<HcmOverlayList>(html`<hcm-overlay-list></hcm-overlay-list>`);

        expect(element.shadowRoot?.querySelectorAll('li')).toHaveLength(0);
        expect(liveRegion(element)).toBe('');
    });

    it('badPath_aKindWithoutHeadingIsListedWithoutOne', async () => {
        const element = await list(
            'en',
            [ITEMS[2], ITEMS[3]].filter((item) => item !== undefined),
        );

        expect([...(element.shadowRoot?.querySelectorAll('h3') ?? [])].map((heading) => heading.textContent)).toEqual(['Places']);
        expect(element.shadowRoot?.querySelectorAll('ul')).toHaveLength(2);
    });
});
