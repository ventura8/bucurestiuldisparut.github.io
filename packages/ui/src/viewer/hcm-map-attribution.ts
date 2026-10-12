/**
 * `<hcm-map-attribution>`: the Mapbox logo and the map's attribution where a modal surface would cover Mapbox GL's own
 * (scenario V18; `attribution.ts`): the viewer's legal bar below a modal sheet or the lightbox, and the foot of About.
 * The logo is Mapbox's own (`a.mapboxgl-ctrl-logo` of mapbox-gl.css, linked in this shadow root) in a 48 px target;
 * the text is the map's attribution as `watchAttribution` read it, or the basemap's credits while there is none. Links
 * open in a new tab and only https addresses become links.
 */
import { DEFAULT_LOCALE, translate, type Locale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { BASEMAP_ATTRIBUTION, MAPBOX_HOME, type AttributionPart } from './attribution.js';
import { EMPTY } from './empty.js';
import { externalLink } from './markdown.js';
import { baseStyles } from './shared-styles.js';

export const HCM_MAP_ATTRIBUTION_TAG = 'hcm-map-attribution';

/** mapbox-gl.css, whose `a.mapboxgl-ctrl-logo` draws the wordmark (the page's copy cannot reach a shadow root). */
function stylesheet(url: string): TemplateResult {
    return url === '' ? EMPTY : html`<link rel="stylesheet" href=${url} />`;
}

function partTemplate(part: AttributionPart, index: number): TemplateResult {
    const separator = index === 0 ? '' : ' ';
    return part.href === undefined ? html`${separator}${part.text}` : html`${separator}${externalLink(part.href, part.text)}`;
}

export class HcmMapAttribution extends LitElement {
    static override readonly properties = {
        parts: { attribute: false },
        locale: { type: String },
        cssUrl: { attribute: false },
    };

    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                column-gap: 16px;
                box-sizing: border-box;
                min-block-size: 48px;
                color: var(--md-sys-color-on-surface-variant, CanvasText);
                font-size: var(--md-sys-typescale-body-small-size, 0.75rem);
                line-height: var(--md-sys-typescale-body-small-line-height, 1rem);
                letter-spacing: var(--md-sys-typescale-body-small-tracking, 0.025rem);
            }

            /* Mapbox's wordmark (88 x 23, from mapbox-gl.css) centred in a 48 px tall touch target. */
            :host a.mapboxgl-ctrl-logo {
                flex: none;
                inline-size: 88px;
                block-size: 48px;
                margin: 0;
                background-position: 0 50%;
                background-size: 88px 23px;
            }

            .attribution {
                flex: 1 1 10rem;
                padding-block: 4px;
                text-align: end;
                overflow-wrap: anywhere;
            }

            .attribution a {
                color: inherit;
                text-decoration: underline;
            }
        `,
    ];

    /** The map's attribution (`readAttribution`); empty shows the basemap's credits. */
    declare parts: readonly AttributionPart[];
    declare locale: Locale;
    /** mapbox-gl.css (the logo's image); empty in tests. */
    declare cssUrl: string;

    constructor() {
        super();
        this.parts = [];
        this.locale = DEFAULT_LOCALE;
        this.cssUrl = '';
    }

    override render(): TemplateResult {
        const parts = this.parts.length === 0 ? BASEMAP_ATTRIBUTION : this.parts;
        return html`${stylesheet(this.cssUrl)}
            <a
                class="mapboxgl-ctrl-logo"
                href=${MAPBOX_HOME}
                target="_blank"
                rel="noopener nofollow"
                aria-label=${translate(this.locale, 'map.logo')}
            ></a>
            <p class="attribution" data-layout-check="map-attribution">${parts.map(partTemplate)}</p>`;
    }
}

/** Registers `<hcm-map-attribution>` once; calling it again is a no-op. */
export function defineHcmMapAttribution(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_MAP_ATTRIBUTION_TAG) === undefined) {
        registry.define(HCM_MAP_ATTRIBUTION_TAG, HcmMapAttribution);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-map-attribution': HcmMapAttribution;
    }
}
