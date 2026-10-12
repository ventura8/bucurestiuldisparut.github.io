import { afterEach, describe, expect, it, vi } from 'vitest';

import { readAttribution, watchAttribution, type AttributionPart } from '../../src/viewer/attribution.js';

/**
 * The attribution control as Mapbox GL 3.32 draws it in the map container: links and plain text (a layer's escaped
 * attribution) in `.mapboxgl-ctrl-attrib-inner`, `mapboxgl-attrib-empty` on the control when there is nothing to credit.
 */
function mapboxControl(inner: (element: HTMLElement) => void): { container: HTMLElement; control: HTMLElement; text: HTMLElement } {
    const container = document.createElement('div');
    const control = document.createElement('details');
    control.className = 'mapboxgl-ctrl mapboxgl-ctrl-attrib';
    const text = document.createElement('div');
    text.className = 'mapboxgl-ctrl-attrib-inner';
    inner(text);
    control.append(text);
    container.append(control);
    document.body.append(container);
    return { container, control, text };
}

function link(href: string | null, label: string): HTMLAnchorElement {
    const anchor = document.createElement('a');
    if (href !== null) {
        anchor.setAttribute('href', href);
    }
    anchor.textContent = label;
    return anchor;
}

function standard(text: HTMLElement): void {
    const improve = document.createElement('strong');
    improve.append(link('https://apps.mapbox.com/feedback/#/26.1/44.43/14', 'Improve this map'));
    text.append(
        link('https://www.mapbox.com/about/maps/', '© Mapbox'),
        ' ',
        link('https://www.openstreetmap.org/about/', '© OpenStreetMap'),
        '  ',
        improve,
        document.createComment('a comment is not credited'),
        ' USGS (e2e) <b>1966</b> ',
    );
}

describe('the map attribution mirror', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theLinksAndTextsMapboxShowsInItsOrder', () => {
        const { container } = mapboxControl(standard);

        expect(readAttribution(container)).toEqual<AttributionPart[]>([
            { text: '© Mapbox', href: 'https://www.mapbox.com/about/maps/' },
            { text: '© OpenStreetMap', href: 'https://www.openstreetmap.org/about/' },
            { text: 'Improve this map', href: 'https://apps.mapbox.com/feedback/#/26.1/44.43/14' },
            { text: 'USGS (e2e) <b>1966</b>' },
        ]);
    });

    it('badPath_onlyHttpsLinksStayLinksAndEmptyLinksAreDropped', () => {
        const { container } = mapboxControl((text) => {
            text.append(
                link('data:text/html,click', 'Click'),
                link('http://example.org/', 'Plain http'),
                link(null, 'No href'),
                link('https://x.example/', ' '),
            );
        });

        expect(readAttribution(container)).toEqual([{ text: 'Click' }, { text: 'Plain http' }, { text: 'No href' }]);
    });

    it('badPath_noControlOrAnEmptyOneHasNothingToRead', () => {
        const bare = document.createElement('div');
        const { container, control } = mapboxControl(standard);
        control.classList.add('mapboxgl-attrib-empty');

        expect(readAttribution(bare)).toEqual([]);
        expect(readAttribution(container)).toEqual([]);
    });

    it('happyPath_aChangeOfTheControlIsReportedOnceUntilStopped', async () => {
        const { container, text } = mapboxControl((inner) => {
            inner.append(link('https://www.mapbox.com/about/maps/', '© Mapbox'));
        });
        const heard: (readonly AttributionPart[])[] = [];
        const stop = watchAttribution(container, (parts) => heard.push(parts));

        text.append(' USGS (e2e)');
        await vi.waitFor(() => {
            expect(heard).toHaveLength(2);
        });
        container.classList.add('mapboxgl-interactive');
        text.setAttribute('title', 'unchanged text');
        await new Promise((resolve) => {
            requestAnimationFrame(resolve);
        });
        stop();
        text.append(' more');
        await new Promise((resolve) => {
            requestAnimationFrame(resolve);
        });

        expect(heard).toEqual([
            [{ text: '© Mapbox', href: 'https://www.mapbox.com/about/maps/' }],
            [{ text: '© Mapbox', href: 'https://www.mapbox.com/about/maps/' }, { text: 'USGS (e2e)' }],
        ]);
    });
});
