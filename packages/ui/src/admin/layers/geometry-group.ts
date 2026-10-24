/**
 * The layer editor's Image and geometry group (`docs/research/M3-interfaces.md` §10.5; CR-M3-7): the chip of a newer
 * version under way (its page), **Replace the image** (the Imagery area's upload for this layer), **Georeference again**
 * (the georeferencer on the current version; a linked layer has no scan, and says so), and **Crop**, whose tool comes in
 * the lazy `layer-geometry` chunk (`<hcm-layer-crop>`) on the first click.
 */
import type { LayerDoc, Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { when, withValue } from '../imagery/when.js';
import { contentText, noticeText } from '../shell/text.js';
import type { CropStatePort } from './geometry/crop-port.js';
import type { LayersIntentsPort } from './layers-port.js';

export interface GeometryContext {
    readonly locale: Locale;
    readonly intents: LayersIntentsPort | null;
    readonly readOnly: boolean;
    /** The open Crop, or null. */
    readonly crop: CropStatePort | null;
}

function pendingChip(locale: Locale, layer: LayerDoc): TemplateResult {
    return withValue(
        layer.pendingVersion,
        (version) =>
            html`<p>
                <a class="tag touch-target" data-tone="wait" href=${['#/imagery/version', version].join('/')}
                    >${contentText(locale, 'adminContent.imagery.layer.pending')}</a
                >
            </p>`,
    );
}

function georefItem(locale: Locale, layer: LayerDoc): TemplateResult {
    const version = layer.currentVersion;
    return version === undefined
        ? html`<li class="note" data-state="no-scan">${noticeText(locale, 'apiError.imagery.noScan')}</li>`
        : html`<li>
              <a class="external" href=${['#/georef', version].join('/')}>${contentText(locale, 'adminContent.imagery.layer.regeoref')}</a>
          </li>`;
}

function cropTool(context: GeometryContext, crop: CropStatePort): TemplateResult {
    const { intents } = context;
    const actions = {
        redraw: () => intents?.redrawCrop(),
        addCorner: () => intents?.addCropCorner(),
        save: () => void intents?.saveCrop(),
        close: () => intents?.closeCrop(),
    };
    return html`<hcm-layer-crop
        .locale=${context.locale}
        .view=${crop}
        .actions=${actions}
        ?read-only=${context.readOnly}
    ></hcm-layer-crop>`;
}

function cropButton(context: GeometryContext): TemplateResult {
    return html`<div class="actions">
        <hcm-button variant="outlined" icon="crop" ?disabled=${context.readOnly} @click=${() => void context.intents?.crop()}
            >${contentText(context.locale, 'adminContent.imagery.layer.crop')}</hcm-button
        >
    </div>`;
}

/** Crop for a layer with a scan: the tool while it is open, else its button. */
function cropControls(context: GeometryContext, layer: LayerDoc): TemplateResult {
    const crop = context.crop;
    return when(layer.currentVersion !== undefined, () => (crop === null ? cropButton(context) : cropTool(context, crop)));
}

export function geometryGroup(context: GeometryContext, id: string, layer: LayerDoc): TemplateResult {
    const { locale } = context;
    return html`<section class="group" data-group="geometry">
        <h3>${contentText(locale, 'adminContent.layers.geometry')}</h3>
        <p class="note">${contentText(locale, 'adminContent.layers.geometryNote')}</p>
        ${pendingChip(locale, layer)}
        <ul class="links">
            <li>
                <a class="external" href=${['#/imagery/replace', id].join('/')}
                    >${contentText(locale, 'adminContent.imagery.layer.replace')}</a
                >
            </li>
            ${georefItem(locale, layer)}
        </ul>
        ${cropControls(context, layer)}
    </section>`;
}
