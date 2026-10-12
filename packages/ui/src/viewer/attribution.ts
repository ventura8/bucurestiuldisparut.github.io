/**
 * The map's legal line as the viewer mirrors it (Mapbox terms; docs/research/design-review-security-cost.md §5: the
 * Mapbox logo and the attribution stay visible, Material overlays never cover them). Mapbox GL draws both in the
 * bottom corners of the map; a modal sheet, the lightbox or About would cover them, so while one is open the viewer
 * hides Mapbox's own controls and shows the same logo and text in `<hcm-map-attribution>` above it.
 *
 * The text is read from Mapbox GL's attribution control in the map container (`watchAttribution`), so the mirror
 * credits exactly what the map credits: the style's sources and the visible historical layers, in the order Mapbox
 * shows them. Only https links stay links; everything else is text (Lit text nodes: no HTML from data).
 */
import { isHttpsUrl } from '@hcm/shared';

export interface AttributionPart {
    readonly text: string;
    /** An https address (the credit's page); absent for plain text. */
    readonly href?: string;
}

/** What every Mapbox basemap credits: shown while the map's control has nothing to read (not drawn yet, or empty). */
export const BASEMAP_ATTRIBUTION: readonly AttributionPart[] = [
    { text: '© Mapbox', href: 'https://www.mapbox.com/about/maps/' },
    { text: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
];

/** Where Mapbox's own logo links to. */
export const MAPBOX_HOME = 'https://www.mapbox.com/';

/**
 * The text of Mapbox GL's attribution control (its credits joined by ` | `); a control with nothing to credit keeps
 * its old text but marks itself `mapboxgl-attrib-empty` and hides.
 */
const INNER = '.mapboxgl-ctrl-attrib:not(.mapboxgl-attrib-empty) .mapboxgl-ctrl-attrib-inner';

function textPart(text: string): AttributionPart[] {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean === '' ? [] : [{ text: clean }];
}

function linkPart(anchor: HTMLAnchorElement): AttributionPart[] {
    const [part] = textPart(anchor.textContent);
    const href = anchor.getAttribute('href') ?? '';
    if (part === undefined) {
        return [];
    }
    return isHttpsUrl(href) ? [{ ...part, href }] : [part];
}

/** The parts of one node: a link, the text and links inside an element (`<strong>`, `<span>`), or a text (no comment). */
function partsOf(node: Node): AttributionPart[] {
    if (node instanceof HTMLAnchorElement) {
        return linkPart(node);
    }
    if (node instanceof Element) {
        return Array.from(node.childNodes).flatMap(partsOf);
    }
    return node instanceof Text ? textPart(node.data) : [];
}

/** The attribution Mapbox GL shows inside `root`, in its order; empty without a control or with an empty one. */
export function readAttribution(root: ParentNode): readonly AttributionPart[] {
    const inner = root.querySelector(INNER);
    return inner === null ? [] : Array.from(inner.childNodes).flatMap(partsOf);
}

function sameParts(first: readonly AttributionPart[], second: readonly AttributionPart[]): boolean {
    return JSON.stringify(first) === JSON.stringify(second);
}

/**
 * Calls `onChange` with the attribution inside `container` now and whenever Mapbox GL changes it (a layer shown or
 * hidden, the style loaded); returns the function that stops watching.
 */
export function watchAttribution(container: HTMLElement, onChange: (parts: readonly AttributionPart[]) => void): () => void {
    let current = readAttribution(container);
    onChange(current);
    const observer = new MutationObserver(() => {
        const next = readAttribution(container);
        if (!sameParts(current, next)) {
            current = next;
            onChange(next);
        }
    });
    observer.observe(container, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'href'],
    });
    return () => {
        observer.disconnect();
    };
}
