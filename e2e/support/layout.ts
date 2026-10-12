import type { Locator, Page } from '@playwright/test';

/**
 * Layout invariants of the tour and the responsive scenarios (docs/research/design-review-testability.md §4.3): no
 * horizontal overflow, no two `[data-layout-check]` boxes overlapping, no clipped text, touch targets of at least
 * 48 × 48 CSS px on compact, and controls that are really on top where they are drawn. Every check runs in the page
 * and walks into open shadow roots, where the viewer renders.
 */

export interface Box {
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Runs in the page: the visible boxes of the elements matching `selectors` (zero-size and hidden ones left out). */
function boxesInPage(selectors: readonly string[]): Box[] {
    const query = (selector: string): Element[] => {
        const found: Element[] = [];
        const visit = (root: Document | ShadowRoot): void => {
            found.push(...Array.from(root.querySelectorAll(selector)));
            for (const element of Array.from(root.querySelectorAll('*'))) {
                if (element.shadowRoot !== null) {
                    visit(element.shadowRoot);
                }
            }
        };
        visit(document);
        return found;
    };
    const name = (element: Element): string => {
        const label = element.getAttribute('data-layout-check');
        return label === null || label === '' ? `${element.tagName.toLowerCase()}.${element.className}` : label;
    };
    return selectors.flatMap((selector) =>
        query(selector)
            .filter((element) => element.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0 && rect.height > 0)
            .map(({ element, rect }) => ({ name: name(element), x: rect.x, y: rect.y, width: rect.width, height: rect.height })),
    );
}

/** The visible boxes of the elements matching `selectors`, shadow roots included. */
export async function visibleBoxes(page: Page, selectors: readonly string[]): Promise<Box[]> {
    return page.evaluate(boxesInPage, selectors);
}

/** The pairs of boxes that overlap by more than `slack` CSS px in both directions. */
export function overlaps(boxes: readonly Box[], slack = 1): string[] {
    const pairs: string[] = [];
    boxes.forEach((first, index) => {
        for (const second of boxes.slice(index + 1)) {
            const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
            const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
            if (width > slack && height > slack) {
                pairs.push(`${first.name} overlaps ${second.name}`);
            }
        }
    });
    return pairs;
}

/** Boxes that leave the viewport (a control pushed off screen). */
export function outsideViewport(boxes: readonly Box[], viewport: { readonly width: number; readonly height: number }): string[] {
    return boxes
        .filter((box) => box.x < -1 || box.y < -1 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1)
        .map(
            (box) =>
                `${box.name} at ${String(Math.round(box.x))},${String(Math.round(box.y))} ${String(Math.round(box.width))}x${String(Math.round(box.height))}`,
        );
}

/** Runs in the page: the document's horizontal overflow in CSS px (0 when nothing scrolls sideways). */
export async function horizontalOverflow(page: Page): Promise<number> {
    return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
}

/** Runs in the page: text elements whose content is cut (wider or taller than their box while overflow hides it). */
function clippedInPage(): string[] {
    const query = (root: Document | ShadowRoot, found: Element[]): Element[] => {
        found.push(...Array.from(root.querySelectorAll('*')));
        for (const element of Array.from(root.querySelectorAll('*'))) {
            if (element.shadowRoot !== null) {
                query(element.shadowRoot, found);
            }
        }
        return found;
    };
    const hasOwnText = (element: Element): boolean =>
        Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
    /** An icon's ligature is a decorative glyph in a clipped 1 em box (`hcm-icon`), not text a visitor reads. */
    const decorative = (element: Element): boolean => element.closest('[aria-hidden="true"]') !== null;
    /** Text for screen readers only (the kit's `.visually-hidden` live regions: a 1 px box clipped away) is never seen. */
    const screenReaderOnly = (element: Element): boolean => getComputedStyle(element).clipPath === 'inset(50%)';
    return query(document, [])
        .filter((element) => element instanceof HTMLElement && hasOwnText(element) && !decorative(element) && element.checkVisibility())
        .filter((element) => !screenReaderOnly(element))
        .filter((element) => {
            const html = element as HTMLElement;
            const style = getComputedStyle(html);
            const hides = (value: string): boolean => value === 'hidden' || value === 'clip';
            const clipsX = hides(style.overflowX) && html.scrollWidth > html.clientWidth + 1;
            const clipsY = hides(style.overflowY) && html.scrollHeight > html.clientHeight + 1;
            return (clipsX || clipsY) && !html.closest('.mapboxgl-ctrl-attrib');
        })
        .map((element) => `${element.tagName.toLowerCase()}: ${element.textContent.trim().slice(0, 40)}`);
}

export async function clippedTexts(page: Page): Promise<string[]> {
    return page.evaluate(clippedInPage);
}

/** Runs in the page: interactive elements smaller than `min` CSS px on either side (their touch target). */
function smallTargetsInPage(min: number): string[] {
    const found: Element[] = [];
    const visit = (root: Document | ShadowRoot): void => {
        found.push(
            ...Array.from(
                root.querySelectorAll('button, a[href], [role="slider"], [role="switch"], [role="radio"], [role="menuitem"], input'),
            ),
        );
        for (const element of Array.from(root.querySelectorAll('*'))) {
            if (element.shadowRoot !== null) {
                visit(element.shadowRoot);
            }
        }
    };
    visit(document);
    /** The box a pointer can hit: the element, or the touch-target pseudo-element the kit adds (class touch-target). */
    const targetSize = (element: Element): { width: number; height: number } => {
        const rect = element.getBoundingClientRect();
        if (!element.classList.contains('touch-target')) {
            return { width: rect.width, height: rect.height };
        }
        const after = getComputedStyle(element, '::after');
        const width = Number.parseFloat(after.width);
        const height = Number.parseFloat(after.height);
        return {
            width: Math.max(rect.width, Number.isFinite(width) ? width : 0),
            height: Math.max(rect.height, Number.isFinite(height) ? height : 0),
        };
    };
    /** A link inside a sentence is exempt from the target size (WCAG 2.5.8, inline); a link of a list is not. */
    const inline = (element: Element): boolean => element.tagName === 'A' && element.parentElement?.tagName === 'P';
    return found
        .filter((element) => element.checkVisibility({ visibilityProperty: true }) && !element.closest('[inert]'))
        .filter((element) => !element.closest('.mapboxgl-ctrl, .mapboxgl-canvas-container') && !inline(element))
        .filter((element) => {
            const size = targetSize(element);
            return size.width + 0.5 < min || size.height + 0.5 < min;
        })
        .map((element) => {
            const size = targetSize(element);
            const name = element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 30);
            return `${element.tagName.toLowerCase()} "${name}" ${String(Math.round(size.width))}x${String(Math.round(size.height))}`;
        });
}

export async function smallTouchTargets(page: Page, min = 48): Promise<string[]> {
    return page.evaluate(smallTargetsInPage, min);
}

/** Runs in the page: true when the centre of `element` hits the element itself (nothing covers it there). */
function onTopInPage(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    let hit: Element | null = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (inner === null || inner === hit) {
            break;
        }
        hit = inner;
    }
    for (let node: Node | null = hit; node !== null; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
        if (node === element) {
            return true;
        }
    }
    return false;
}

/** True when nothing covers the centre of `locator`'s element (a visitor's tap there reaches it). */
export async function isOnTop(locator: Locator): Promise<boolean> {
    return locator.evaluate(onTopInPage);
}

export interface FocusInfo {
    readonly tag: string;
    /** The accessible name as the element carries it (`aria-label`, else its text). */
    readonly name: string;
    readonly role: string;
    /** The tag of the shadow host the element lives in (`''` in the document). */
    readonly host: string;
    /** True when `:focus-visible` matches and an outline or a focus shadow is drawn. */
    readonly ringVisible: boolean;
}

/** Runs in the page: the element that has the keyboard focus, through every shadow root, and its focus ring. */
function focusInPage(): FocusInfo | null {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    if (active === null || active === document.body) {
        return null;
    }
    const style = getComputedStyle(active);
    const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
    const root = active.getRootNode();
    return {
        tag: active.tagName.toLowerCase(),
        name: (active.getAttribute('aria-label') ?? active.textContent).trim(),
        role: active.getAttribute('role') ?? '',
        host: root instanceof ShadowRoot ? root.host.tagName.toLowerCase() : '',
        ringVisible: active.matches(':focus-visible') && (outline || shadow),
    };
}

/** The focused element (null when nothing but the page has focus). */
export async function focused(page: Page): Promise<FocusInfo | null> {
    return page.evaluate(focusInPage);
}
