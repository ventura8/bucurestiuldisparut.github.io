/**
 * `<hcm-poi-editor>`: one place's editor (docs/research/M2c-interfaces.md §1.3, §5, §7.2; behaviours A32, A38): its
 * heading (which takes the focus when it opens), the save state, Save (off while nothing changed or something is wrong:
 * its description names the first problem), Discard, History, Redraw as…, Delete; the conflict and gone banners; the
 * shape (the drawing tools, what the map refused, the vertex list); the texts, years, links, photos and Published.
 * Fires `hcm-delete`, `hcm-redraw` with `{shape}` and `hcm-pick-photos`; everything else goes to the area's intents.
 */
import type { AdminContentKey, LngLat, Locale } from '@hcm/shared';
import { LitElement, html, nothing, type TemplateResult } from 'lit';

import { defineOnce, emit } from '../../components/internal.js';
import { LeftFields } from '../editing/number-fields.js';
import type { DrawToolPort } from '../map/hcm-draw-toolbar.js';
import { EMPTY } from '../shell/empty.js';
import {
    categoryField,
    descriptionFields,
    linkFields,
    photoFields,
    publishedField,
    titleFields,
    yearFields,
    type FieldContext,
} from './poi-fields.js';
import { issueText, localized, poiHistoryHref, poiText, refusalText, SHAPE_KEYS } from './poi-text.js';
import { poiStyles } from './poi-styles.js';
import type {
    CategoryItemPort,
    PhotoChoicePort,
    PlaceEditorPort,
    PoiDraftPort,
    PoiShapePort,
    PoisIntentsPort,
    VertexEditPort,
} from './pois-port.js';

export const HCM_POI_EDITOR_TAG = 'hcm-poi-editor';

const SHAPES: readonly PoiShapePort[] = ['point', 'linestring', 'polygon'];

/** Positions a shape needs at least (the vertex list keeps them). */
const MINIMUM: Readonly<Record<PoiShapePort, number>> = { point: 1, linestring: 2, polygon: 3 };

/** The save state's words: new, saving, unsaved or saved. */
function stateKey(draft: PoiDraftPort): Parameters<typeof poiText>[1] {
    if (draft.saving) {
        return 'adminContent.pois.state.saving';
    }
    if (draft.isNew) {
        return 'adminContent.pois.state.new';
    }
    return draft.dirty.length > 0 ? 'adminContent.pois.state.unsaved' : 'adminContent.pois.state.saved';
}

export class HcmPoiEditor extends LitElement {
    static override readonly properties = {
        editor: { attribute: false },
        categories: { attribute: false },
        photos: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        centreKnown: { attribute: false },
        mode: { state: true },
    };

    static override readonly styles = poiStyles;

    declare editor: PlaceEditorPort | null;
    declare categories: readonly CategoryItemPort[];
    declare photos: readonly PhotoChoicePort[];
    declare intents: PoisIntentsPort | null;
    /** Whether Add at centre has a centre to add (the city is read): the button waits until then. */
    declare centreKnown: boolean;
    declare locale: Locale;
    /** The drawing tool the admin picked last; a place opens drawing when it has no shape yet, else selecting. */
    declare mode: 'draw' | 'select';
    /** The years left since the place opened (they say their problem from then on). */
    readonly #left = new LeftFields(() => {
        this.requestUpdate();
    });
    /** The place the tools were last set for, and whether it had a shape then. */
    #shown: ShownPlace | null = null;

    constructor() {
        super();
        this.editor = null;
        this.categories = [];
        this.photos = [];
        this.intents = null;
        this.centreKnown = true;
        this.locale = 'en';
        this.mode = 'select';
    }

    /**
     * The tools follow the map's drawing session (`packages/admin/src/pois/map-session.ts`): a place without a shape opens
     * with Draw pressed, as the map draws its first clicks; one with a shape with Select. A point is finished by its click,
     * after which the map selects it: Select is pressed then too.
     */
    protected override willUpdate(): void {
        const shown = shownOf(this.editor);
        const mode = toolsFor(this.#shown, shown, this.editor?.shape);
        this.#shown = shown;
        if (mode !== null) {
            this.mode = mode;
        }
    }

    override render(): TemplateResult {
        const editor = this.editor;
        const draft = editor?.draft ?? null;
        if (editor === null || draft === null) {
            return EMPTY;
        }
        return html`<div class="pane form">
            ${this.#head(draft)} ${this.#banners(draft)} ${this.#shape(editor, draft)}
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.texts')}</legend>
                ${categoryField(this.#context(draft), this.categories)} ${titleFields(this.#context(draft))}
                ${descriptionFields(this.#context(draft))}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.years')}</legend>
                ${yearFields(this.#context(draft))}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.links')}</legend>
                ${linkFields(this.#context(draft))}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.photos')}</legend>
                ${photoFields(this.#context(draft), this.photos, () => {
                    emit(this, 'hcm-pick-photos');
                })}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.publishing')}</legend>
                ${publishedField(this.#context(draft))}
            </fieldset>
        </div>`;
    }

    #context(draft: PoiDraftPort): FieldContext {
        const edit = (patch: Parameters<FieldContext['edit']>[0]): void => {
            this.intents?.edit(patch);
        };
        return { locale: this.locale, value: draft.value, issues: draft.issues, edit, left: this.#left.forItem(draft.id) };
    }

    #title(draft: PoiDraftPort): string {
        const title = localized(this.locale, draft.value.title).trim();
        if (title !== '') {
            return title;
        }
        return poiText(this.locale, draft.isNew ? 'adminContent.pois.newPlace' : 'adminContent.pois.untitled');
    }

    /** The title, the save state, then Discard and Save at the trailing end, the order of the layers' and settings' save bar. */
    #head(draft: PoiDraftPort): TemplateResult {
        const [issue] = draft.issues;
        return html`<div class="editor-head">
                <h2 data-detail-heading tabindex="-1">${this.#title(draft)}</h2>
                <p class="state note" role="status">${poiText(this.locale, stateKey(draft))}</p>
                <hcm-button
                    class="discard"
                    variant="text"
                    ?disabled=${draft.dirty.length === 0 || draft.saving}
                    @click=${() => this.intents?.discard()}
                    >${poiText(this.locale, 'adminContent.common.discard')}</hcm-button
                >
                <hcm-button
                    class="save"
                    variant="filled"
                    ?disabled=${saveBlocked(draft)}
                    aria-describedby=${issue === undefined ? nothing : 'save-issue'}
                    @click=${() => void this.intents?.save()}
                    >${poiText(this.locale, 'adminContent.common.save')}</hcm-button
                >
            </div>
            ${this.#issue(issue)} ${this.#actions(draft)}`;
    }

    #issue(issue: PoiDraftPort['issues'][number] | undefined): TemplateResult {
        if (issue === undefined) {
            return EMPTY;
        }
        const text = poiText(this.locale, 'adminContent.pois.cannotSave', { issue: issueText(this.locale, issue) });
        return html`<p class="note" id="save-issue">${text}</p>`;
    }

    #actions(draft: PoiDraftPort): TemplateResult {
        const shapes = SHAPES.filter((shape) => shape !== this.editor?.shape);
        return html`<div class="actions" role="group" aria-label=${poiText(this.locale, 'adminContent.pois.actions')}>
            ${this.#history(draft)} ${shapes.map((shape) => this.#redrawButton(shape))} ${this.#deleteButton(draft)}
        </div>`;
    }

    #history(draft: PoiDraftPort): TemplateResult {
        return draft.isNew
            ? EMPTY
            : html`<a class="external" href=${poiHistoryHref(draft.id)}>${poiText(this.locale, 'adminContent.pois.history')}</a>`;
    }

    #redrawButton(shape: PoiShapePort): TemplateResult {
        const label = poiText(this.locale, 'adminContent.pois.redraw', {
            shape: poiText(this.locale, SHAPE_KEYS[shape]).toLocaleLowerCase(this.locale),
        });
        return html`<hcm-button
            variant="text"
            class=${['redraw', shape].join('-')}
            @click=${() => {
                emit(this, 'hcm-redraw', { shape });
            }}
            >${label}</hcm-button
        >`;
    }

    #deleteButton(draft: PoiDraftPort): TemplateResult {
        if (draft.isNew || draft.gone) {
            return EMPTY;
        }
        return html`<hcm-button
            variant="text"
            icon="delete"
            class="delete"
            @click=${() => {
                emit(this, 'hcm-delete');
            }}
            >${poiText(this.locale, 'adminContent.pois.delete')}</hcm-button
        >`;
    }

    #banners(draft: PoiDraftPort): TemplateResult {
        const goneBanner = draft.gone ? html`<p class="alert" role="alert">${poiText(this.locale, 'adminContent.pois.gone')}</p>` : EMPTY;
        return html`${this.#conflict(draft.conflict)} ${goneBanner}`;
    }

    #conflict(conflict: PoiDraftPort['conflict']): TemplateResult {
        if (conflict === null) {
            return EMPTY;
        }
        const fields = poiText(this.locale, 'adminContent.pois.conflictFields', { fields: conflict.fields.join(', ') });
        return html`<div class="alert" role="alert">
            <p>${poiText(this.locale, 'adminContent.pois.conflict')} ${fields}</p>
            <div class="actions">
                <hcm-button variant="tonal" class="keep-mine" @click=${() => this.intents?.keepMine()}
                    >${poiText(this.locale, 'adminContent.pois.keepMine')}</hcm-button
                >
                <hcm-button variant="text" class="take-theirs" @click=${() => this.intents?.takeTheirs()}
                    >${poiText(this.locale, 'adminContent.pois.takeTheirs')}</hcm-button
                >
            </div>
        </div>`;
    }

    #shape(editor: PlaceEditorPort, draft: PoiDraftPort): TemplateResult {
        const tools = toolState(editor, draft);
        return html`<fieldset>
            <legend>${poiText(this.locale, 'adminContent.pois.section.shape')}</legend>
            <hcm-draw-toolbar
                .shape=${editor.shape}
                .mode=${this.mode}
                .locale=${this.locale}
                ?can-delete=${tools.canDelete}
                ?can-undo=${tools.canUndo}
                .canAddCentre=${this.centreKnown}
                @hcm-tool=${(event: CustomEvent<{ readonly tool: DrawToolPort }>) => {
                    this.#tool(event.detail.tool, editor);
                }}
            ></hcm-draw-toolbar>
            <p class="note">${poiText(this.locale, hintKey(this.mode, editor.shape))}</p>
            <p class="note">${poiText(this.locale, 'adminContent.map.crosshair')}</p>
            <p class="alert-region" role="alert">${editor.refusal === null ? '' : refusalText(this.locale, editor.refusal)}</p>
            ${this.#missing(draft)}
            <hcm-vertex-list
                .positions=${tools.positions}
                .selected=${editor.vertex}
                .locale=${this.locale}
                @hcm-vertex=${(event: CustomEvent<VertexEditPort>) => this.intents?.editVertex(event.detail)}
                @hcm-vertex-select=${(event: CustomEvent<{ readonly index: number | null }>) => this.intents?.selectVertex(event.detail.index)}
            ></hcm-vertex-list>
        </fieldset>`;
    }

    #missing(draft: PoiDraftPort): TemplateResult {
        return draft.value.geometry === null
            ? html`<p class="note">${poiText(this.locale, 'adminContent.pois.field.geometryMissing')}</p>`
            : EMPTY;
    }

    #tool(tool: DrawToolPort, editor: PlaceEditorPort): void {
        const intents = this.intents;
        if (intents === null) {
            return;
        }
        if (tool === 'draw' || tool === 'select') {
            this.mode = tool;
        }
        TOOLS[tool](intents, editor);
    }
}

/** The open place, and whether it has a shape. */
interface ShownPlace {
    readonly id: string;
    readonly drawn: boolean;
}

function shownOf(editor: PlaceEditorPort | null): ShownPlace | null {
    const draft = editor?.draft ?? null;
    return draft === null ? null : { id: draft.id, drawn: draft.value.geometry !== null };
}

/** A point placed by its click since the last render: the map selects it then. */
function pointPlaced(previous: ShownPlace, shown: ShownPlace, shape: PoiShapePort | undefined): boolean {
    return shape === 'point' && !previous.drawn && shown.drawn;
}

/** The tool a place opens with: Draw until it has a shape. */
function openingTool(shown: ShownPlace): 'draw' | 'select' {
    return shown.drawn ? 'select' : 'draw';
}

/** The tool to press now: on a newly opened place, or once its point is placed; null keeps the admin's pick. */
function toolsFor(previous: ShownPlace | null, shown: ShownPlace | null, shape: PoiShapePort | undefined): 'draw' | 'select' | null {
    if (shown === null) {
        return null;
    }
    if (previous?.id !== shown.id) {
        return openingTool(shown);
    }
    return pointPlaced(previous, shown, shape) ? 'select' : null;
}

/** What each drawing tool asks of the area. */
const TOOLS: Readonly<Record<DrawToolPort, (intents: PoisIntentsPort, editor: PlaceEditorPort) => void>> = {
    draw: (intents) => {
        intents.setTool('draw');
    },
    select: (intents) => {
        intents.setTool('select');
    },
    'add-centre': (intents) => {
        intents.addAtCentre();
    },
    'undo-vertex': (intents) => {
        intents.undoLastVertex();
    },
    'delete-vertex': (intents, editor) => {
        if (editor.vertex !== null) {
            intents.editVertex({ kind: 'remove', index: editor.vertex });
        }
    },
};

/** Save is off while saving, after a delete elsewhere, with a problem, or with nothing to save. */
function saveBlocked(draft: PoiDraftPort): boolean {
    const nothingToSave = !draft.isNew && draft.dirty.length === 0;
    return draft.saving || draft.gone || draft.issues.length > 0 || nothingToSave;
}

function hintKey(mode: 'draw' | 'select', shape: PoiShapePort): AdminContentKey {
    return mode === 'draw' ? DRAW_HINTS[shape] : 'adminContent.map.drawHint.select';
}

const DRAW_HINTS: Readonly<Record<PoiShapePort, AdminContentKey>> = {
    point: 'adminContent.map.drawHint.point',
    linestring: 'adminContent.map.drawHint.linestring',
    polygon: 'adminContent.map.drawHint.polygon',
};

/** The positions the vertex list shows, and whether a position can be deleted or the last one removed. */
function toolState(
    editor: PlaceEditorPort,
    draft: PoiDraftPort,
): { readonly positions: readonly LngLat[]; readonly canDelete: boolean; readonly canUndo: boolean } {
    const drawn = draft.value.geometry !== null;
    const positions = drawn ? listed(draft) : editor.sketch;
    const minimum = drawn ? MINIMUM[editor.shape] : 0;
    return {
        positions,
        canDelete: editor.vertex !== null && positions.length > MINIMUM[editor.shape],
        canUndo: positions.length > minimum,
    };
}

/** The positions the vertex list shows of a drawn place. */
function listed(draft: PoiDraftPort): readonly LngLat[] {
    const geometry = draft.value.geometry;
    if (geometry === null) {
        return [];
    }
    if (geometry.type === 'Point') {
        return [geometry.coordinates];
    }
    return geometry.type === 'LineString' ? geometry.coordinates : (geometry.coordinates[0] ?? []).slice(0, -1);
}

/** Registers `<hcm-poi-editor>` once. */
export function defineHcmPoiEditor(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_POI_EDITOR_TAG, HcmPoiEditor);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-poi-editor': HcmPoiEditor;
    }
}
