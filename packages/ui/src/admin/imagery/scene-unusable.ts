/**
 * A scene's usefulness (the owner's report of 2026-11-13: "This scan is useless, too many clouds", a 1964 frame the whole-city plan
 * kept offering to buy): the warning of a frame its browse image shows probably cloudy over the city, on its card and its page, and
 * on its page **Not useful** with why (clouds, haze or blur, wrong area, other), or, once marked, what that did and Undo.
 */
import { CLOUDY_CITY_PERCENT, type Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { SceneItemPort, UnusableReasonPort } from './imagery-port.js';
import { numberText } from './imagery-text.js';
import { markRefusalOf, sceneRefusal } from './scene-refusal.js';
import { when } from './when.js';

const REASONS: readonly UnusableReasonPort[] = ['clouds', 'haze', 'area', 'other'];

/** The share of the city clouded, when the frame is probably cloudy over it. */
function cloudyShare(scene: SceneItemPort): number | null {
    return scene.cloudCity !== null && scene.cloudCity >= CLOUDY_CITY_PERCENT ? scene.cloudCity : null;
}

function percentText(locale: Locale, percent: number): string {
    return numberText(locale, percent, 0);
}

/** The card's chips: Not useful, or Probably cloudy over the city: N %. */
export function usefulnessTags(locale: Locale, scene: SceneItemPort): TemplateResult {
    if (scene.unusable !== null) {
        return html`<span class="tag" data-tone="error" data-state="unusable">${contentText(locale, 'adminContent.imagery.unusable.tag')}</span>`;
    }
    const share = cloudyShare(scene);
    return share === null
        ? EMPTY
        : html`<span class="tag" data-tone="wait" data-state="cloudy"
              >${contentText(locale, 'adminContent.imagery.cloudy.tag', { percent: percentText(locale, share) })}</span
          >`;
}

/** The page's warning of a frame probably cloudy over the city: what is wrong, why, what to do (before an import or a purchase). */
export function cloudyWarning(locale: Locale, scene: SceneItemPort): TemplateResult {
    const share = cloudyShare(scene);
    return share === null || scene.unusable !== null
        ? EMPTY
        : html`<div class="alert" role="note" data-state="cloudy-warning">
              <hcm-icon name="cloud"></hcm-icon>
              <div class="alert-body">
                  <p><strong>${contentText(locale, 'adminContent.imagery.cloudy.tag', { percent: percentText(locale, share) })}</strong></p>
                  <p>${contentText(locale, 'adminContent.imagery.cloudy.warning')}</p>
              </div>
          </div>`;
}

async function mark(context: ImageryContext, scene: SceneItemPort, reason: UnusableReasonPort | null): Promise<void> {
    await context.intents?.markUnusable(scene.id, reason);
}

/** The four reasons, each one click (the snackbar's Undo takes it back). */
function reasonButtons(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    const off = context.view.ordering !== null || context.readOnly;
    return html`<p>${contentText(locale, 'adminContent.imagery.unusable.hint')}</p>
        <div class="actions" role="group" aria-labelledby="scene-unusable">
            ${REASONS.map(
                (reason) =>
                    html`<hcm-button variant="outlined" ?disabled=${off} data-unusable=${reason} @click=${() => void mark(context, scene, reason)}
                        ><span class="visually-hidden">${contentText(locale, 'adminContent.imagery.unusable.prefix')} </span>${contentText(
                            locale,
                            `adminContent.imagery.unusable.${reason}`,
                        )}</hcm-button
                    >`,
            )}
        </div>`;
}

/** What the mark did, and Undo. */
function marked(context: ImageryContext, scene: SceneItemPort, reason: UnusableReasonPort): TemplateResult {
    const { locale } = context;
    return html`<p data-state="unusable-marked">
            ${contentText(locale, 'adminContent.imagery.unusable.state', {
                reason: contentText(locale, `adminContent.imagery.unusable.${reason}`),
            })}
        </p>
        <div class="actions">
            <hcm-button
                variant="tonal"
                icon="undo"
                ?disabled=${context.view.ordering !== null || context.readOnly}
                @click=${() => void mark(context, scene, null)}
                >${contentText(locale, 'adminContent.imagery.unusable.undo')}</hcm-button
            >
        </div>`;
}

/**
 * The page's section: Not useful? with the four reasons, or the mark and Undo. An imported scene has none (its layer is what to
 * reject or delete). Its refusal shows here, never on the order card.
 */
export function unusableSection(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    return when(
        scene.status !== 'imported',
        () =>
            html`<section class="section" data-scene-unusable>
                <h3 id="scene-unusable">${contentText(locale, 'adminContent.imagery.unusable.title')}</h3>
                ${scene.unusable === null ? reasonButtons(context, scene) : marked(context, scene, scene.unusable)}
                ${sceneRefusal(context, markRefusalOf(context.view), scene)}
            </section>`,
    );
}
