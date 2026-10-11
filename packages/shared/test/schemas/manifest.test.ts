import { describe, expect, it } from 'vitest';

import { MAX_LINKS } from '../../src/schemas/manifest.js';
import { parseManifestJson, validateManifest, type ValidationIssue } from '../../src/schemas/validation.js';
import { validCity, validLayer, validManifest, validPhoto } from '../fixtures/manifest.js';

type Path = readonly (string | number)[];

/** The valid manifest with the value at `path` replaced (`undefined` deletes the key). */
function patched(path: Path, value: unknown): Record<string, unknown> {
    const manifest = validManifest();
    let target: Record<string | number, unknown> = manifest;
    for (const key of path.slice(0, -1)) {
        target = target[key] as Record<string | number, unknown>;
    }
    const last = path.at(-1) ?? '';
    if (value === undefined) {
        // Deleting by a computed key is the point of this helper (a missing field).
        Reflect.deleteProperty(target, last);
    } else {
        target[last] = value;
    }
    return manifest;
}

function issuesOf(input: unknown): readonly ValidationIssue[] {
    const result = validateManifest(input);
    return result.ok ? [] : result.issues;
}

describe('manifest v1: happy paths', () => {
    it('happyPath_theFixtureIsValid', () => {
        expect(issuesOf(validManifest())).toEqual([]);
    });

    it('happyPath_textIsTrimmed', () => {
        const result = validateManifest(patched(['photos', 0, 'title'], { ro: '  Mihai Vodă  ' }));

        expect(result.ok && result.value.photos[0]?.title.ro).toBe('Mihai Vodă');
    });

    it('happyPath_minimalCityAndPhoto', () => {
        const city = { ...validCity(), credits: [] };
        Reflect.deleteProperty(city, 'engine');
        const photo = {
            id: 'p',
            title: { ro: 'T' },
            license: 'CC0',
            links: [],
            location: { lat: 44.4, lng: 26.1 },
            image: { web: 'w.webp', thumb: 't.webp', w: 1, h: 1 },
        };

        expect(issuesOf({ version: 1, city, layers: [], photos: [photo] })).toEqual([]);
    });

    it.each([
        [{ type: 'xyz', tiles: ['https://tiles.example.org/{z}/{x}/{y}.png'], tileSize: 512 }],
        [{ type: 'pmtiles', url: 'layers/kh4.pmtiles' }],
        [{ type: 'pmtiles', url: 'https://cdn.example.org/kh4.pmtiles' }],
    ])('happyPath_layerSource_%j_isValid', (source) => {
        expect(issuesOf(patched(['layers', 0, 'source'], source))).toEqual([]);
    });

    it('happyPath_httpsStyleUrl', () => {
        expect(issuesOf(patched(['city', 'basemap'], { style: 'https://styles.example.org/style.json' }))).toEqual([]);
    });

    it('happyPath_adjustmentsWithOneBound', () => {
        expect(issuesOf(patched(['layers', 0, 'adjustments'], { brightnessMax: 0.5 }))).toEqual([]);
        expect(issuesOf(patched(['layers', 0, 'adjustments'], { brightnessMin: 0.5 }))).toEqual([]);
    });

    it('happyPath_parsesJsonText', () => {
        expect(parseManifestJson(JSON.stringify(validManifest())).ok).toBe(true);
    });
});

/** One row per rule: what breaks, where, the value, and the localized issue it must produce. */
const RULES = [
    ['version', ['version'], 2, 'version', 'validation.value'],
    ['an unknown top-level key', ['extra'], true, 'extra', 'validation.unknownKey'],
    ['a missing English name', ['city', 'name', 'en'], undefined, 'city.name.en', 'validation.required'],
    ['an empty name', ['city', 'name', 'ro'], '   ', 'city.name.ro', 'validation.tooSmall'],
    ['a numeric name', ['city', 'name', 'ro'], 5, 'city.name.ro', 'validation.type'],
    ['an id with a space', ['city', 'id'], 'bucu resti', 'city.id', 'validation.format'],
    [
        'inverted bounds',
        ['city', 'bounds'],
        [
            [26.25, 44.33],
            [25.93, 44.55],
        ],
        'city.bounds',
        'validation.bounds',
    ],
    ['a zoom beyond 24', ['city', 'maxZoom'], 25, 'city.maxZoom', 'validation.tooBig'],
    ['a zoom outside its range', ['city', 'zoom'], 9, 'city.zoom', 'validation.zoomRange'],
    ['a centre outside the bounds', ['city', 'center'], [27, 44.4], 'city.center', 'validation.centerOutside'],
    ['an http link in About', ['city', 'about', 'ro'], '[x](http://example.org)', 'city.about.ro', 'validation.markdownLink'],
    ['a named seed colour', ['city', 'theme', 'seedColor'], 'brown', 'city.theme.seedColor', 'validation.format'],
    [
        'a token value that escapes',
        ['city', 'theme', 'tokens', 'light', '--md-sys-color-primary'],
        'red;x',
        'city.theme.tokens.light.--md-sys-color-primary',
        'validation.cssValue',
    ],
    [
        'a url() token value',
        ['city', 'theme', 'tokens', 'dark', '--md-sys-color-primary'],
        'url(x)',
        'city.theme.tokens.dark.--md-sys-color-primary',
        'validation.cssValue',
    ],
    [
        'an empty token set',
        ['city', 'theme', 'tokens', 'highContrastDark'],
        {},
        'city.theme.tokens.highContrastDark',
        'validation.required',
    ],
    ['a malformed style', ['city', 'basemap', 'style'], 'mapbox://styles/only-owner', 'city.basemap.style', 'validation.format'],
    ['a secret Mapbox token', ['city', 'mapbox', 'publicToken'], 'sk.secret-scenario', 'city.mapbox.publicToken', 'validation.format'],
    ['a Universal Analytics id', ['city', 'analytics', 'measurementId'], 'UA-1234-1', 'city.analytics.measurementId', 'validation.format'],
    [
        'an http error endpoint',
        ['city', 'analytics', 'errorEndpoint'],
        'http://errors.example.org',
        'city.analytics.errorEndpoint',
        'validation.httpsOnly',
    ],
    ['a two-part engine version', ['city', 'engine', 'minVersion'], '1.0', 'city.engine.minVersion', 'validation.format'],
    ['a javascript credit link', ['city', 'credits', 1, 'url'], 'javascript:alert(1)', 'city.credits[1].url', 'validation.httpsOnly'],
    ['a malformed tileset id', ['layers', 0, 'source', 'tilesetId'], 'no-owner', 'layers[0].source.tilesetId', 'validation.format'],
    [
        'a tile template without y',
        ['layers', 0, 'source'],
        { type: 'xyz', tiles: ['https://t.example.org/{z}/{x}.png'], tileSize: 256 },
        'layers[0].source.tiles[0]',
        'validation.tileTemplate',
    ],
    [
        'an odd tile size',
        ['layers', 0, 'source'],
        { type: 'xyz', tiles: ['https://t.example.org/{z}/{x}/{y}.png'], tileSize: 300 },
        'layers[0].source.tileSize',
        'validation.value',
    ],
    [
        'an unknown source type',
        ['layers', 0, 'source'],
        { type: 'wms', url: 'https://x.example.org' },
        'layers[0].source.type',
        'validation.value',
    ],
    [
        'a pmtiles path that climbs',
        ['layers', 0, 'source'],
        { type: 'pmtiles', url: '../x.pmtiles' },
        'layers[0].source.url',
        'validation.assetUrl',
    ],
    ['a zoom range upside down', ['layers', 0, 'minzoom'], 18, 'layers[0].maxzoom', 'validation.zoomRange'],
    ['a date of another year', ['layers', 0, 'date'], '1967-01-01', 'layers[0].date', 'validation.value'],
    ['an impossible date', ['layers', 0, 'date'], '1966-02-30', 'layers[0].date', 'validation.format'],
    [
        'inverted brightness',
        ['layers', 0, 'adjustments'],
        { brightnessMin: 0.9, brightnessMax: 0.1 },
        'layers[0].adjustments.brightnessMax',
        'validation.value',
    ],
    ['an unknown layer kind', ['layers', 0, 'kind'], 'drawing', 'layers[0].kind', 'validation.value'],
    ['an end year before the year', ['photos', 0, 'yearEnd'], 1970, 'photos[0].yearEnd', 'validation.yearRange'],
    ['the licence unknown', ['photos', 0, 'license'], 'unknown', 'photos[0].license', 'validation.value'],
    ['an http link', ['photos', 0, 'links', 0, 'url'], 'http://www.example.org/x', 'photos[0].links[0].url', 'validation.httpsOnly'],
    ['a protocol-relative image', ['photos', 0, 'image', 'web'], '//evil.example/x.webp', 'photos[0].image.web', 'validation.assetUrl'],
    ['a photo far outside the city', ['photos', 0, 'location'], { lat: 46, lng: 26.1 }, 'photos[0].location', 'validation.outsideCity'],
    ['a bearing over 360', ['photos', 0, 'bearing'], 361, 'photos[0].bearing', 'validation.tooBig'],
    ['a zero field of view', ['photos', 0, 'fov'], 0, 'photos[0].fov', 'validation.tooSmall'],
    ['a fractional width', ['photos', 0, 'image', 'w'], 10.5, 'photos[0].image.w', 'validation.type'],
] as const;

describe('manifest v1: every rule reports a localized code', () => {
    it.each(RULES)('badPath_%s', (_name, path, value, issuePath, code) => {
        expect(issuesOf(patched(path, value))).toContainEqual({ path: issuePath, code });
    });

    it('badPath_anEndYearWithoutAYear', () => {
        const manifest = patched(['photos', 0, 'year'], undefined);

        expect(issuesOf(manifest)).toEqual([{ path: 'photos[0].yearEnd', code: 'validation.yearRange' }]);
    });

    it('badPath_tooManyLinks', () => {
        const links = Array.from({ length: MAX_LINKS + 1 }, (_, index) => ({ url: `https://example.org/${String(index)}`, label: 'x' }));

        expect(issuesOf(patched(['photos', 0, 'links'], links))).toEqual([{ path: 'photos[0].links', code: 'validation.tooBig' }]);
    });

    it('badPath_tooManyStyleConfigEntries', () => {
        const config = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`key${String(index)}`, index]));

        expect(issuesOf(patched(['city', 'basemap', 'config'], config))).toEqual([
            { path: 'city.basemap.config', code: 'validation.tooBig' },
        ]);
    });

    it('badPath_duplicateIds', () => {
        const manifest = { ...validManifest(), layers: [validLayer(), validLayer()], photos: [validPhoto(), validPhoto()] };

        expect(issuesOf(manifest)).toEqual([
            { path: 'layers[1].id', code: 'validation.duplicateId' },
            { path: 'photos[1].id', code: 'validation.duplicateId' },
        ]);
    });

    it('badPath_prototypePollutionKeyIsRejected', () => {
        const text = JSON.stringify(validManifest()).replace('"id":"bucuresti"', '"id":"bucuresti","__proto__":{"polluted":true}');

        const result = parseManifestJson(text);

        expect(result.ok ? [] : result.issues).toEqual([{ path: 'city.__proto__', code: 'validation.unknownKey' }]);
        expect(Object.prototype).not.toHaveProperty('polluted');
    });

    it.each([['{"version":'], ['not json'], ['']])('badPath_invalidJson_%s', (text) => {
        expect(parseManifestJson(text)).toEqual({ ok: false, issues: [{ path: '', code: 'validation.json' }] });
    });

    it('badPath_notAnObject', () => {
        expect(issuesOf(null)).toEqual([{ path: '', code: 'validation.type' }]);
    });
});
