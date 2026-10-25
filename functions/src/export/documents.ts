/**
 * The two documents a static export writes for its owner (M5, `docs/research/M5-interfaces.md` §5.1, §5.2), Romanian
 * first and English second as the starter kit's README: `README.md` (what is inside, how to serve it, the viewer token,
 * the scans, then the kit's own README) and `RIGHTS.md` (every photo licensed for this map only). Names and titles are
 * the owner's plain text: whitespace is collapsed and Markdown's and HTML's special characters escaped, so a title can
 * never become a heading, a table column or markup in a renderer that shows the file.
 */
import type { Manifest, Photo } from '@hcm/shared';

const MARKDOWN_SPECIAL = /[\\`*_[\]<>|#]/g;

/** One line of the owner's text, safe inside a Markdown heading, list item or table cell. */
export function markdownLine(value: string): string {
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .replace(MARKDOWN_SPECIAL, (character) => `\\${character}`);
}

interface ReadmeInput {
    readonly manifest: Manifest;
    /** How many USGS scans are in `rasters/` (0: none were asked for, or none may travel). */
    readonly rasters: number;
    readonly kitReadme: string;
    readonly madeAt: Date;
}

function day(at: Date): string {
    return at.toISOString().slice(0, 10);
}

function romanian(input: ReadmeInput, name: string): string {
    const scans =
        input.rasters > 0
            ? `- \`rasters/\`: scanările USGS ale straturilor istorice (${String(input.rasters)}), în domeniul public, ca GeoTIFF-uri optimizate pentru cloud.`
            : '- scanările USGS nu sunt incluse (exportul le include doar la cerere).';
    return [
        '## Română',
        '',
        `Această arhivă conține tot ce îi trebuie hărții ${name} ca să funcționeze pe orice găzduire statică, fără Firebase:`,
        '',
        '- `index.html`: pagina hărții;',
        '- `city.json`: datele orașului (locurile, fotografiile, straturile istorice);',
        '- `engine/`: motorul hărții, servit de pe același site;',
        '- `photos/`: fotografiile publicate;',
        '- `RIGHTS.md`: fotografiile publicate cu permisiune doar pentru această hartă;',
        scans,
        '',
        '1. Serviți folderul de pe un server web (GitHub Pages, orice găzduire statică sau `npx serve`). Deschisă direct din',
        '   fișier (`file://`), pagina nu poate citi `city.json` și afișează o eroare.',
        '2. Tokenul Mapbox din `city.json` (`city.mapbox.publicToken`) este restricționat la adresa site-ului original. Pentru',
        '   o altă adresă, creați-vă propriul token public (`pk.`) în contul Mapbox și înlocuiți-l.',
        '3. Straturile istorice rămân trimiteri la tile-urile lor; un strat încărcat ca GeoTIFF nu își exportă scanarea, pentru',
        '   că drepturile ei nu sunt cunoscute.',
        '4. Fotografiile din `RIGHTS.md` nu pot fi republicate în altă parte fără acordul deținătorilor drepturilor.',
    ].join('\n');
}

function english(input: ReadmeInput, name: string): string {
    const scans =
        input.rasters > 0
            ? `- \`rasters/\`: the USGS scans of the historical layers (${String(input.rasters)}), in the public domain, as Cloud-Optimized GeoTIFFs.`
            : '- the USGS scans are not included (the export includes them only when asked).';
    return [
        '## English',
        '',
        `This archive holds everything the map ${name} needs to run on any static host, without Firebase:`,
        '',
        '- `index.html`: the map’s page;',
        '- `city.json`: the city’s data (places, photos, historical layers);',
        '- `engine/`: the map engine, served from the same site;',
        '- `photos/`: the published photos;',
        '- `RIGHTS.md`: the photos published with permission for this map only;',
        scans,
        '',
        '1. Serve the folder from a web server (GitHub Pages, any static host or `npx serve`). Opened straight from the file',
        '   (`file://`), the page cannot read `city.json` and shows an error.',
        '2. The Mapbox token in `city.json` (`city.mapbox.publicToken`) is restricted to the original site’s address. For',
        '   another address, create a public token (`pk.`) of your own in your Mapbox account and replace it.',
        '3. The historical layers stay references to their tiles; a layer uploaded as a GeoTIFF does not export its scan, because',
        '   its rights are not known.',
        '4. The photos in `RIGHTS.md` may not be republished elsewhere without their rights holders’ consent.',
    ].join('\n');
}

/** `README.md`: the export's preface in both languages, then the starter kit's README as it is. */
export function exportReadme(input: ReadmeInput): string {
    const name = markdownLine(input.manifest.city.name.ro);
    return [
        `# ${name}: export static / static export (${day(input.madeAt)})`,
        '',
        romanian(input, name),
        '',
        english(input, markdownLine(input.manifest.city.name.en)),
        '',
        '---',
        '',
        input.kitReadme.trimEnd(),
        '',
    ].join('\n');
}

function rightsRow(photo: Photo): string {
    const title = markdownLine(photo.title.ro);
    const holder = markdownLine(photo.rightsHolder ?? photo.author ?? '—');
    return `| \`${photo.id}\` | ${title} | ${holder} | ${photo.license} |`;
}

/** `RIGHTS.md`: the photos licensed for this map only, with their rights holders (none: it says so). */
export function rightsDocument(city: Manifest['city']['name'], photos: readonly Photo[]): string {
    const head = [
        '# Drepturi / Rights',
        '',
        `Fotografiile de mai jos sunt publicate cu permisiunea deținătorilor drepturilor doar pentru harta ${markdownLine(city.ro)}.`,
        'Nu le republicați în altă parte fără acordul lor.',
        '',
        `The photos below are published with their rights holders’ permission for the map ${markdownLine(city.en)} only.`,
        'Do not republish them elsewhere without their consent.',
        '',
    ];
    if (photos.length === 0) {
        return [...head, 'Nicio fotografie nu are această restricție. / No photo has this restriction.', ''].join('\n');
    }
    return [
        ...head,
        '| Fotografie / Photo | Titlu / Title | Drepturi / Rights holder | Licență / Licence |',
        '| --- | --- | --- | --- |',
        ...photos.map(rightsRow),
        '',
    ].join('\n');
}
