/**
 * M22 (`docs/research/M22-help-calibrate.md` §13.2): the georeferencer's full screen. The page covers the window, so everything around
 * it (the navigation, the top bar) is made `inert` while it does, as a modal would: nothing hidden under it can be reached by Tab or a
 * screen reader. What it made inert, and only that, is given back when it ends.
 */

/** Every element beside `start` and beside each of its ancestors, across shadow roots, not already inert. */
export function surroundings(start: Element): Element[] {
    const found: Element[] = [];
    let node: Element | null = start;
    while (node !== null) {
        const parent: ParentNode | null = node.parentNode;
        const here: Element = node;
        found.push(...[...(parent?.children ?? [])].filter((child) => child !== here && !child.hasAttribute('inert')));
        node = parent instanceof ShadowRoot ? parent.host : node.parentElement;
    }
    return found;
}

export class FullScreenInert {
    #made: Element[] = [];

    /** On: everything around `host` inert; off: what was made inert given back. */
    cover(host: Element, on: boolean): void {
        for (const element of this.#made.splice(0)) {
            element.removeAttribute('inert');
        }
        if (on) {
            this.#made = surroundings(host);
            for (const element of this.#made) {
                element.setAttribute('inert', '');
            }
        }
    }
}
