/**
 * The one card the engine words itself (docs/ENGINE_API.md → Language): the engine bundles no catalogue, so when boot
 * failed before any language's texts could be fetched, not even Romanian's (a page opened from the disk, a blocked
 * folder), only these two lines can say so, each in its own language.
 */
import { hasCatalogue, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

/** Boot `failed` and the page has no texts in `locale`. */
export function wordless(failed: boolean, locale: ViewerLocale): boolean {
    return failed && !hasCatalogue(locale);
}

/** The card, in Romanian and English; its button reloads the page, the one retry every boot has. */
export function catalogueDown(): TemplateResult {
    const reload = (): void => {
        globalThis.location.reload();
    };
    return html`<div class="status">
        <div class="catalogue-down" role="alert">
            <p lang="ro">Harta nu s-a putut încărca.</p>
            <p lang="en">The map could not be loaded.</p>
            <hcm-button variant="tonal" icon="refresh" @click=${reload}
                ><span lang="ro">Reîncearcă</span> · <span lang="en">Retry</span></hcm-button
            >
        </div>
    </div>`;
}
