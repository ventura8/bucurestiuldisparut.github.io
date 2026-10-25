/**
 * The publishing section (M5, `docs/research/DECISIONS-for-review.md` §63a): whether visitors see the city
 * (`cities/{city}.published`). A city made with New city starts unpublished (`docs/research/M5-interfaces.md` §1.6), and
 * the server builds its public manifest only once it is published; switched off, the server takes the manifest down.
 * One switch and the section's Save.
 */
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import { cityHead, cityOf, sectionTitle, type SectionContext } from './section-parts.js';

export function publishSection(context: SectionContext): TemplateResult {
    const { locale } = context;
    const city = cityOf(context);
    const head = cityHead(context, sectionTitle(locale, 'publish'));
    if (city === null) {
        return head;
    }
    const label = contentText(locale, 'adminContent.settings.publish.label');
    return html`${head}
        <div class="switch-row">
            <span aria-hidden="true">${label}</span>
            <hcm-switch
                .checked=${city.published}
                ?disabled=${context.readOnly}
                label=${label}
                @hcm-change=${(event: Event) => {
                    context.intents?.editCity({ published: (event as CustomEvent<{ checked: boolean }>).detail.checked });
                }}
            ></hcm-switch>
        </div>
        <p class="note" data-published=${String(city.published)}>
            ${contentText(locale, city.published ? 'adminContent.settings.publish.on' : 'adminContent.settings.publish.off')}
        </p>
        <p class="note" data-publish-site>${contentText(locale, 'adminContent.settings.publish.site')}</p>`;
}
