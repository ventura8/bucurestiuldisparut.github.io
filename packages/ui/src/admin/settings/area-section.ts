/**
 * The area section (`docs/research/M2c-interfaces.md` §8.5; behaviour A19): the four edges of the city's bounds, the
 * start view and the zoom limits as number fields, and the photos and places smaller bounds would leave out, each a
 * link to its editor (S-A19-BAD-BOUNDS-EXCLUDE-CONTENT). The rectangle drawn on the page's map and **Use this view**
 * (the store's `useView`) come with the settings page's `hcm-admin-map`, once the admin tier mocks the map (CR-M2c-7).
 */
import type { CityDoc } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { field, issueAt } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import { cityHead, cityOf, sectionTitle, type SectionContext } from './section-parts.js';
import type { AreaNumberFieldPort, OutsidePort } from './settings-port.js';

type FieldKey = Parameters<typeof contentText>[1];

const BOUNDS: readonly { readonly name: AreaNumberFieldPort; readonly key: FieldKey }[] = [
    { name: 'west', key: 'adminContent.settings.west' },
    { name: 'east', key: 'adminContent.settings.east' },
    { name: 'south', key: 'adminContent.settings.south' },
    { name: 'north', key: 'adminContent.settings.north' },
];

const VIEW: readonly { readonly name: AreaNumberFieldPort; readonly key: FieldKey }[] = [
    { name: 'lat', key: 'adminContent.settings.centerLat' },
    { name: 'lng', key: 'adminContent.settings.centerLng' },
    { name: 'zoom', key: 'adminContent.settings.zoom' },
    { name: 'minZoom', key: 'adminContent.settings.minZoom' },
    { name: 'maxZoom', key: 'adminContent.settings.maxZoom' },
];

/** A number as the field shows it ('' for none or a number being typed wrong). */
function shown(value: number | undefined): string {
    return value === undefined || Number.isNaN(value) ? '' : String(value);
}

function valueOf(city: CityDoc, name: AreaNumberFieldPort): number | undefined {
    const values: Readonly<Record<AreaNumberFieldPort, number | undefined>> = {
        ...city.bounds,
        lat: city.center?.lat,
        lng: city.center?.lng,
        zoom: city.zoom,
        minZoom: city.minZoom,
        maxZoom: city.maxZoom,
    };
    return values[name];
}

/** Where an area field's problem sits in the city document. */
function pathOf(name: AreaNumberFieldPort): string {
    const paths: Readonly<Record<AreaNumberFieldPort, string>> = {
        ...{ west: 'bounds', east: 'bounds', south: 'bounds', north: 'bounds' },
        ...{ lat: 'center', lng: 'center', zoom: 'zoom', minZoom: 'minZoom', maxZoom: 'maxZoom' },
    };
    return paths[name];
}

function numberField(
    context: SectionContext,
    city: CityDoc,
    spec: { readonly name: AreaNumberFieldPort; readonly key: FieldKey },
): TemplateResult {
    const issues = context.view.citySection.draft.issues;
    return field(context.locale, {
        id: `area-${spec.name}`,
        label: contentText(context.locale, spec.key),
        value: shown(valueOf(city, spec.name)),
        issue: issueAt(issues, pathOf(spec.name)),
        inputMode: 'decimal',
        onInput: (text) => {
            context.intents?.setNumber(spec.name, text);
        },
    });
}

function outsideItem(context: SectionContext, item: OutsidePort): TemplateResult {
    const key = item.kind === 'photo' ? 'adminContent.settings.outsidePhoto' : 'adminContent.settings.outsidePoi';
    const href = ['#', item.kind === 'photo' ? 'photos' : 'pois', item.id].join('/');
    return html`<li><a href=${href}>${contentText(context.locale, key, { title: item.title })}</a></li>`;
}

function outsideList(context: SectionContext, outside: readonly OutsidePort[]): TemplateResult | typeof nothing {
    const { locale } = context;
    return outside.length === 0
        ? nothing
        : html`<div class="alert" role="alert">
              <hcm-icon name="warning"></hcm-icon>
              <div class="alert-body">
                  <span>${contentText(locale, 'adminContent.settings.outside')}</span>
                  <ul>
                      ${outside.map((item) => outsideItem(context, item))}
                  </ul>
              </div>
          </div>`;
}

export function areaSection(context: SectionContext): TemplateResult {
    const { locale } = context;
    const city = cityOf(context);
    if (city === null) {
        return html`<h2 tabindex="-1" data-detail-heading>${sectionTitle(locale, 'area')}</h2>`;
    }
    const state = context.view.citySection;
    return html`${cityHead(context, sectionTitle(locale, 'area'))}
        <section class="group">
            <h3>${contentText(locale, 'adminContent.settings.bounds')}</h3>
            <p class="note">${contentText(locale, 'adminContent.settings.boundsHelp')}</p>
            <div class="fields">${BOUNDS.map((spec) => numberField(context, city, spec))}</div>
            <p class="note status" role="status">${state.checking ? contentText(locale, 'adminContent.settings.checking') : ''}</p>
            ${outsideList(context, state.outside)}
        </section>
        <section class="group">
            <h3>${contentText(locale, 'adminContent.settings.startView')}</h3>
            <div class="fields">${VIEW.map((spec) => numberField(context, city, spec))}</div>
        </section>`;
}
