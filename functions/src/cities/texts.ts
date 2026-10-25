/**
 * The About and privacy texts a new city starts with (`docs/research/M5-interfaces.md` §1.6): made from its name, in
 * Romanian and English, in the M1 starter kit's wording; Settings changes them later. The name is plain text, so its
 * Markdown markers are escaped (`\*`): a city called `*Iași*` is not shown in italics.
 */
import type { CityDoc } from '@hcm/shared';

type Name = CityDoc['name'];

/** `name` as literal Markdown text. */
export function markdownLiteral(name: string): string {
    return name.replace(/[\\*_[\]]/g, (marker) => `\\${marker}`);
}

/** The About text of a new city. */
export function aboutText(name: Name): NonNullable<CityDoc['about']> {
    const ro = markdownLiteral(name.ro);
    const en = markdownLiteral(name.en ?? name.ro);
    return {
        ro: `**${ro}** pe o hartă istorică: fotografii vechi, locuri și straturi istorice, făcută cu Historic City Map.`,
        en: `**${en}** on a historical map: old photos, places and historical layers, made with Historic City Map.`,
    };
}

/** The privacy notice of a new city: no cookies without consent, and what Mapbox receives. */
export function privacyText(): NonNullable<CityDoc['privacy']> {
    return {
        ro: 'Această hartă nu folosește cookie-uri fără acordul tău. Harta este afișată cu **Mapbox**: browserul tău trimite adresa IP către Mapbox.',
        en: 'This map uses no cookies without your consent. The map is drawn by **Mapbox**: your browser sends your IP address to Mapbox.',
    };
}
