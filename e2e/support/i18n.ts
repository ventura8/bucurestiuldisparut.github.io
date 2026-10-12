import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';
import { translate, type MessageKey } from '@hcm/shared';

/**
 * The i18n leak check of the tour (docs/research/design-review-testability.md §4.3): no raw message id on the page,
 * and in a Romanian page no text that only the English catalogue has. The key list is read from the Romanian
 * catalogue, the source of truth (`packages/shared/src/i18n/ro.ts`, one `'key': 'text',` entry per line, enforced by
 * the `i18n` gate); the texts come from `translate`.
 */

const CATALOGUE = readFileSync(resolve(import.meta.dirname, '../../packages/shared/src/i18n/ro.ts'), 'utf8');

/** Every message key, in catalogue order. */
const MESSAGE_KEYS: readonly MessageKey[] = [...CATALOGUE.matchAll(/^ {4}'([\w.-]+)': /gm)].map((match) => match[1] as MessageKey);

/** English texts without placeholders that differ from their Romanian text: shown in a Romanian page, they leaked. */
const ENGLISH_ONLY_TEXTS: ReadonlySet<string> = new Set(
    MESSAGE_KEYS.map((key) => [translate('en', key), translate('ro', key)] as const)
        .filter(([english, romanian]) => english !== romanian && !english.includes('{'))
        .map(([english]) => english),
);

/** Runs in the page: every visible text node and accessible name, open shadow roots included. */
function textsInPage(): string[] {
    const texts: string[] = [];
    const visit = (root: Document | ShadowRoot): void => {
        for (const element of Array.from(root.querySelectorAll('*'))) {
            const visible = element.checkVisibility();
            for (const node of Array.from(element.childNodes)) {
                if (visible && node.nodeType === Node.TEXT_NODE) {
                    texts.push((node.textContent ?? '').trim());
                }
            }
            if (visible) {
                texts.push(element.getAttribute('aria-label') ?? '', element.getAttribute('aria-valuetext') ?? '');
            }
            if (element.shadowRoot !== null) {
                visit(element.shadowRoot);
            }
        }
    };
    visit(document);
    return texts.filter((text) => text !== '');
}

/** The visible texts and accessible names of `page`. */
export async function pageTexts(page: Page): Promise<string[]> {
    return page.evaluate(textsInPage);
}

/** What leaked on `page`: raw message keys, and in Romanian the English-only texts. */
export async function i18nLeaks(page: Page, lang: 'ro' | 'en'): Promise<string[]> {
    const keys = new Set<string>(MESSAGE_KEYS);
    const texts = await pageTexts(page);
    return texts.filter((text) => keys.has(text) || (lang === 'ro' && ENGLISH_ONLY_TEXTS.has(text)));
}
