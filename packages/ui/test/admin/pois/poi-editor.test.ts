import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HcmPoiEditor } from '../../../src/admin/pois/hcm-poi-editor.js';
import { withText, yearOf } from '../../../src/admin/pois/poi-fields.js';
import type { PlaceEditorPort, PoisIntentsPort } from '../../../src/admin/pois/pois-port.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount, updated } from '../shell/fake-app.js';
import { area, CATEGORIES, draft, editor, VALUE, type PoisArea } from './fixtures.js';

async function mounted(
    port: PlaceEditorPort,
    locale: 'ro' | 'en' = 'en',
): Promise<{ readonly element: HcmPoiEditor; readonly store: PoisArea }> {
    const store = area();
    const element = await mount<HcmPoiEditor>(
        html`<hcm-poi-editor
            .editor=${port}
            .categories=${CATEGORIES}
            .photos=${[{ id: 'p1', title: { ro: 'Lipscani' }, year: 1930, thumb: null }]}
            .intents=${store.intents}
            .locale=${locale}
        ></hcm-poi-editor>`,
        900,
    );
    return { element, store };
}

/**
 * Types into a text field (`input`: the draft follows every key, so Save works without leaving the field), or sets a
 * year or an option (`change`: a half-typed number is not a year).
 */
function type(element: HTMLElement, selector: string, value: string): void {
    const field = deep(element, selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    field.value = value;
    const committed = field instanceof HTMLSelectElement || field.type === 'number';
    field.dispatchEvent(new Event(committed ? 'change' : 'input'));
}

function press(element: HTMLElement): void {
    deep(element, 'button').click();
}

function asked(store: PoisArea, name: keyof PoisIntentsPort): readonly string[] {
    return store.named(name);
}

describe('<hcm-poi-editor>: the form', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_everyFieldEditsTheDraft', async () => {
        const { element, store } = await mounted(
            editor({
                draft: draft({
                    value: { ...VALUE, description: { ro: 'Text' }, links: [{ url: 'https://a.ro/', label: 'A' }], photoIds: ['p1', 'p9'] },
                }),
            }),
        );

        type(element, '#category', 'parcuri');
        type(element, '#title-ro', 'Biserica Stavropoleos');
        type(element, '#title-en', '');
        type(element, '#description-en', 'An **old** church');
        type(element, '#description-ro', '');
        type(element, '#yearStart', '1890');
        type(element, '#yearEnd', '');
        type(element, '#link-url-1', 'https://b.ro/');
        type(element, '#link-label-1', 'B');
        press(deep(element, '.link-row hcm-icon-button'));
        press(deep(element, '.add-link'));
        press(deep(element, '.chosen hcm-icon-button'));
        press(deep(element, 'hcm-switch'));

        expect(asked(store, 'edit')).toEqual([
            'edit {"category":"parcuri"}',
            'edit {"title":{"ro":"Biserica Stavropoleos","en":"Stavropoleos Church"}}',
            'edit {"title":{"ro":"Stavropoleos"}}',
            'edit {"description":{"ro":"Text","en":"An **old** church"}}',
            'edit {}',
            'edit {"yearStart":1890}',
            'edit {}',
            'edit {"links":[{"url":"https://b.ro/","label":"A"}]}',
            'edit {"links":[{"url":"https://a.ro/","label":"B"}]}',
            'edit {"links":[]}',
            'edit {"links":[{"url":"https://a.ro/","label":"A"},{"url":"https://","label":""}]}',
            'edit {"photoIds":["p9"]}',
            'edit {"published":false}',
        ]);
        expect(deepText(element)).toContain('Lipscani');
        expect(deepText(element)).toContain('p9');
        expect(deepAll(element, '.preview strong').map((strong) => strong.textContent)).toEqual([]);
    });

    it('happyPath_theDescriptionIsPreviewedAsTextNotHtml', async () => {
        const { element } = await mounted(
            editor({ draft: draft({ value: { ...VALUE, description: { ro: 'O **biserică** <img src=x onerror=alert(1)>', en: '' } } }) }),
        );

        expect(deepAll(element, '.preview strong').map((strong) => strong.textContent)).toEqual(['biserică']);
        expect(deepAll(element, '.preview img')).toEqual([]);
        expect(deepText(element)).toContain('<img src=x onerror=alert(1)>');
        expect(deepText(element)).toContain('Nothing to preview.');
    });

    it('badPath_problemsShowAtTheirFieldsAndSaveSaysWhy', async () => {
        const { element, store } = await mounted(
            editor({
                draft: draft({
                    dirty: ['title'],
                    issues: [
                        { path: 'title.ro', code: 'validation.tooSmall' },
                        { path: 'links[0].url', code: 'validation.httpsOnly' },
                        { path: 'yearEnd', code: 'validation.yearRange' },
                        { path: 'category', code: 'validation.reference' },
                        { path: 'description.ro', code: 'validation.markdownLink' },
                    ],
                    value: { ...VALUE, title: { ro: '' }, links: [{ url: 'mailto:ana@a.ro', label: 'A' }] },
                }),
            }),
        );

        const save = deep(element, 'hcm-button.save') as HTMLElement & { disabled: boolean };
        expect(save.disabled).toBe(true);
        expect(save.getAttribute('aria-describedby')).toBe('save-issue');
        expect(deep(element, '#save-issue').textContent).toContain('Cannot save:');
        expect(deep(element, '#title-ro').getAttribute('aria-invalid')).toBe('true');
        expect(deep(element, '#title-ro').getAttribute('aria-describedby')).toBe('title-ro-error');
        expect(deep(element, '#link-url-1').getAttribute('aria-invalid')).toBe('true');
        expect(deep(element, '#yearEnd').getAttribute('aria-describedby')).toBe('yearEnd-error years-hint');
        expect(deep(element, '#description-ro').getAttribute('aria-describedby')).toBe('description-ro-error markdown-hint');
        expect(deep(element, 'h2').textContent).toBe('Untitled place');
        press(save);
        expect(asked(store, 'save')).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aNewPlaceSavesAtOnceAndOffersNoDelete', async () => {
        const { element, store } = await mounted(
            editor({
                draft: draft({ isNew: true, base: null, dirty: ['title'], value: { ...VALUE, title: { ro: '' }, geometry: null } }),
                shape: 'polygon',
            }),
            'ro',
        );

        press(deep(element, 'hcm-button.save'));
        press(deep(element, 'hcm-button.discard'));

        expect(asked(store, 'save')).toEqual(['save']);
        expect(asked(store, 'discard')).toEqual(['discard']);
        expect(deep(element, 'h2').textContent).toBe('Loc nou');
        expect(deepText(element)).toContain('Nesalvat încă');
        expect(deepText(element)).toContain('Desenează locul pe hartă');
        expect(deepAll(element, 'hcm-button.delete')).toEqual([]);
        expect(deepAll(element, 'a.external')).toEqual([]);
    });

    it('happyPath_theSaveStateFollowsTheDraft', async () => {
        const { element } = await mounted(editor({ draft: draft({ dirty: ['title'], saving: true }) }));
        expect(deepText(element)).toContain('Saving…');

        element.editor = editor({ draft: draft({ dirty: ['title'] }) });
        await updated(element);
        expect(deepText(element)).toContain('Unsaved changes');
        element.editor = editor();
        await updated(element);
        expect(deepText(element)).toContain('Saved');
        element.editor = editor({ draft: null });
        await updated(element);

        expect(deepAll(element, 'hcm-button')).toEqual([]);
    });
});

describe('<hcm-poi-editor>: actions and banners', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_historyRedrawAndDeleteAreOffered', async () => {
        const { element } = await mounted(editor());
        const fired: string[] = [];
        for (const type of ['hcm-redraw', 'hcm-delete', 'hcm-pick-photos']) {
            element.addEventListener(type, (event) => fired.push(`${type} ${JSON.stringify((event as CustomEvent).detail ?? null)}`));
        }

        press(deep(element, 'hcm-button.redraw-linestring'));
        press(deep(element, 'hcm-button.redraw-polygon'));
        press(deep(element, 'hcm-button.delete'));
        press(deep(element, 'hcm-button.choose-photos'));

        expect(deep(element, 'a.external').getAttribute('href')).toBe('#/history/poi/stavropoleos');
        expect(deepAll(element, 'hcm-button.redraw-point')).toEqual([]);
        expect(fired).toEqual([
            'hcm-redraw {"shape":"linestring"}',
            'hcm-redraw {"shape":"polygon"}',
            'hcm-delete {}',
            'hcm-pick-photos {}',
        ]);
    });

    it('badPath_aConflictIsResolvedAndADeletedPlaceCannotBeSaved', async () => {
        const { element, store } = await mounted(
            editor({ draft: draft({ dirty: ['title'], conflict: { by: 'other-uid', fields: ['title', 'links'] } }) }),
        );

        expect(deepText(element)).toContain('Fields you both changed: title, links');
        press(deep(element, 'hcm-button.keep-mine'));
        press(deep(element, 'hcm-button.take-theirs'));
        element.editor = editor({ draft: draft({ dirty: ['title'], gone: true }) });
        await updated(element);

        expect(asked(store, 'keepMine')).toEqual(['keepMine']);
        expect(asked(store, 'takeTheirs')).toEqual(['takeTheirs']);
        expect(deepText(element)).toContain('This place was deleted meanwhile.');
        expect((deep(element, 'hcm-button.save') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        expect(deepAll(element, 'hcm-button.delete')).toEqual([]);
    });
});

describe('<hcm-poi-editor>: the shape', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theToolsDrawSelectAddAndRemoveVertices', async () => {
        const area = {
            type: 'Polygon',
            coordinates: [
                [
                    [26.1, 44.43],
                    [26.11, 44.43],
                    [26.11, 44.44],
                    [26.1, 44.44],
                    [26.1, 44.43],
                ],
            ],
        } as const;
        const { element, store } = await mounted(
            editor({ shape: 'polygon', vertex: 1, draft: draft({ value: { ...VALUE, geometry: area } }) }),
        );
        const toolbar = deep(element, 'hcm-draw-toolbar');

        for (const tool of ['draw', 'add-centre', 'delete-vertex', 'undo-vertex', 'select']) {
            press(deep(toolbar, `hcm-icon-button.${tool}`));
        }
        await updated(element);

        expect(asked(store, 'setTool')).toEqual(['setTool "draw"', 'setTool "select"']);
        expect(asked(store, 'addAtCentre')).toEqual(['addAtCentre']);
        expect(asked(store, 'editVertex')).toEqual(['editVertex {"kind":"remove","index":1}']);
        expect(asked(store, 'undoLastVertex')).toEqual(['undoLastVertex']);
        expect(deepAll(deep(element, 'hcm-vertex-list'), 'li')).toHaveLength(4);
        expect(deepText(element)).toContain('Drag the shape or its positions');
    });

    it('happyPath_theVertexListEditsAndChoosesPositionsAndTheRefusalIsAnnounced', async () => {
        const { element, store } = await mounted(editor({ refusal: 'outside' }));
        const list = deep(element, 'hcm-vertex-list');

        list.dispatchEvent(new CustomEvent('hcm-vertex', { detail: { kind: 'remove', index: 0 } }));
        list.dispatchEvent(new CustomEvent('hcm-vertex-select', { detail: { index: 0 } }));

        expect(asked(store, 'editVertex')).toEqual(['editVertex {"kind":"remove","index":0}']);
        expect(asked(store, 'selectVertex')).toEqual(['selectVertex 0']);
        expect(deep(element, '.alert-region').textContent).toBe('That position is outside the city.');
    });

    it('badPath_withoutAChosenPositionDeleteDoesNothingAndASketchIsListed', async () => {
        const { element, store } = await mounted(
            editor({ shape: 'linestring', sketch: [[26.1, 44.43]], draft: draft({ value: { ...VALUE, geometry: null } }) }),
        );
        const toolbar = deep(element, 'hcm-draw-toolbar') as HTMLElement & { canDelete: boolean; canUndo: boolean };
        toolbar.dispatchEvent(new CustomEvent('hcm-tool', { detail: { tool: 'delete-vertex' } }));
        press(deep(toolbar, 'hcm-icon-button.draw'));
        await updated(element);

        expect(asked(store, 'editVertex')).toEqual([]);
        expect([toolbar.canDelete, toolbar.canUndo]).toEqual([false, true]);
        expect(deepAll(deep(element, 'hcm-vertex-list'), 'li')).toHaveLength(1);
        expect(deepText(element)).toContain('the line appears from the second');
    });

    it('happyPath_aLineIsListedPositionByPosition', async () => {
        const { element } = await mounted(
            editor({
                shape: 'linestring',
                draft: draft({
                    value: {
                        ...VALUE,
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [26.1, 44.43],
                                [26.11, 44.43],
                            ],
                        },
                    },
                }),
            }),
        );

        expect(deepAll(deep(element, 'hcm-vertex-list'), 'li')).toHaveLength(2);
    });

    it('badPath_anEditorWithoutIntentsIgnoresTheTools', async () => {
        const { element } = await mounted(editor());
        element.intents = null;
        await updated(element);

        deep(element, 'hcm-draw-toolbar').dispatchEvent(new CustomEvent('hcm-tool', { detail: { tool: 'draw' } }));

        expect(element.mode).toBe('select');
    });
});

describe('the editor fields: helpers', () => {
    it('happyPath_textsAndYearsAreReadAsTyped', () => {
        expect(withText(undefined, 'en', 'Church')).toEqual({ ro: '', en: 'Church' });
        expect(withText({ ro: 'Biserică', en: 'Church' }, 'en', '')).toEqual({ ro: 'Biserică' });
        expect(yearOf(' 1890 ')).toBe(1890);
    });

    it('badPath_aYearThatIsNotAWholeNumberIsNone', () => {
        expect(yearOf('')).toBeUndefined();
        expect(yearOf('18.5')).toBeUndefined();
    });
});
