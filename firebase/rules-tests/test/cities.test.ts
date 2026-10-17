/**
 * cities/{city}: admins edit the settings (`CLIENT_WRITES.city.update`), validated like `cityDocSchema`; id, mapbox,
 * analytics, engine and createdAt are server-owned (client-writes.test.ts), cities are created and deleted by callables.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cityDoc, theme } from './support/documents.js';
import { createWorld, deleted, past, serverTime, stampedBy, verdict, type Data, type Verdict, type World } from './support/world.js';

const CITY_ID = 'rules-cities';

let world: World;
let sequence = 0;

/** A fresh copy of the complete city for each edit, so edits never depend on each other. */
async function seededCity(): Promise<string> {
    sequence += 1;
    const path = FIRESTORE_PATHS.city(`${CITY_ID}-${String(sequence)}`);
    await world.seed(path, cityDoc(CITY_ID));
    return path;
}

async function edit(changes: Data): Promise<Verdict> {
    const path = await seededCity();
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

beforeAll(async () => {
    world = await createWorld('cities');
});

afterAll(async () => {
    await world.close();
});

describe('update', () => {
    it.each([
        ['the smallest valid settings', { center: deleted(), zoom: deleted(), about: deleted(), theme: deleted(), basemap: deleted() }],
        ['an English name', { name: { ro: 'București', en: 'Bucharest' } }],
        ['zooms at their limits', { zoom: 0, minZoom: 0, maxZoom: 24 }],
        ['a Mapbox style', { basemap: { style: 'mapbox://styles/hcm-test/historic-1' } }],
        ['a basemap with 30 config properties', { basemap: { style: 'mapbox://styles/mapbox/standard', config: configOf(30) } }],
        ['200 tokens per scheme', { theme: { ...theme('#000000'), tokens: tokenSchemes(200) } }],
        ['50 credits', { credits: Array.from({ length: 50 }, () => ({ label: { ro: 'A', en: 'A' } })) }],
        ['a fully transparent photos overlay', { photosOverlay: { defaultOpacity: 0 } }],
        ['bounds around the globe', { bounds: { west: -180, south: -90, east: 180, north: 90 } }],
    ])('happyPath_adminSaves_%s', async (_label, changes) => {
        expect(await edit(changes)).toBe('allow');
    });

    it.each([
        ['a name without Romanian', { name: { en: 'Bucharest' } }],
        ['a name in another language', { name: { ro: 'București', fr: 'Bucarest' } }],
        ['a name that is not a map', { name: 'București' }],
        ['a name over 100 characters', { name: { ro: 'x'.repeat(101) } }],
        ['a blank name', { name: { ro: '   ' } }],
        ['an English name that is not text', { name: { ro: 'București', en: 42 } }],
        ['bounds that are not a map', { bounds: '25.9,44.3,26.3,44.6' }],
        ['bounds missing a side', { bounds: { west: 25.9, south: 44.3, east: 26.3 } }],
        ['bounds with an extra key', { bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6, up: 1 } }],
        ['bounds west of nothing', { bounds: { west: -181, south: 44.3, east: 26.3, north: 44.6 } }],
        ['bounds east of everything', { bounds: { west: 25.9, south: 44.3, east: 181, north: 44.6 } }],
        ['bounds below the pole', { bounds: { west: 25.9, south: -91, east: 26.3, north: 44.6 } }],
        ['bounds above the pole', { bounds: { west: 25.9, south: 44.3, east: 26.3, north: 91 } }],
        ['bounds with east before west', { bounds: { west: 26.3, south: 44.3, east: 25.9, north: 44.6 } }],
        ['bounds with north before south', { bounds: { west: 25.9, south: 44.6, east: 26.3, north: 44.3 } }],
        ['empty bounds', { bounds: { west: 26, south: 44, east: 26, north: 44.6 } }],
        ['a centre with altitude', { center: { lat: 44.43, lng: 26.1, alt: 80 } }],
        ['a centre off the globe', { center: { lat: 44.43, lng: 190 } }],
        ['a zoom of 25', { zoom: 25 }],
        ['a negative minimum zoom', { minZoom: -1 }],
        ['a maximum zoom that is text', { maxZoom: '18' }],
        ['an About text over 10000 characters', { about: { ro: 'x'.repeat(10_001) } }],
        ['a privacy text that is not a map', { privacy: 'Confidențialitate' }],
        ['credits that are not a list', { credits: { label: 'A' } }],
        ['51 credits', { credits: Array.from({ length: 51 }, () => ({ label: { ro: 'A', en: 'A' } })) }],
        ['a theme without tokens', { theme: { seedColor: '#875329' } }],
        ['a theme with an extra key', { theme: { ...theme('#875329'), css: 'body{}' } }],
        ['a seed colour that is not hex', { theme: theme('red') }],
        ['a theme missing a scheme', { theme: { seedColor: '#875329', tokens: { light: tokensOf(1), dark: tokensOf(1) } } }],
        ['a scheme without tokens', { theme: { ...theme('#875329'), tokens: { ...tokenSchemes(1), dark: {} } } }],
        ['a scheme of 201 tokens', { theme: { ...theme('#875329'), tokens: { ...tokenSchemes(1), highContrastDark: tokensOf(201) } } }],
        ['a light scheme that is a list', { theme: { ...theme('#875329'), tokens: { ...tokenSchemes(1), light: ['#000'] } } }],
        [
            'a high-contrast light scheme of 201 tokens',
            { theme: { ...theme('#875329'), tokens: { ...tokenSchemes(1), highContrastLight: tokensOf(201) } } },
        ],
        ['a basemap without a style', { basemap: { config: {} } }],
        ['a basemap with an extra key', { basemap: { style: 'mapbox://styles/mapbox/standard', sprite: 'x' } }],
        ['an http basemap style', { basemap: { style: 'http://example.org/style.json' } }],
        ['a basemap style that is not text', { basemap: { style: 42 } }],
        ['a basemap with 31 config properties', { basemap: { style: 'mapbox://styles/mapbox/standard', config: configOf(31) } }],
        ['a basemap config that is a list', { basemap: { style: 'mapbox://styles/mapbox/standard', config: ['a'] } }],
        ['a photos overlay opacity over 1', { photosOverlay: { defaultOpacity: 1.01 } }],
        ['a photos overlay with an extra key', { photosOverlay: { defaultOpacity: 0.5, visible: true } }],
        ['a published flag that is not a boolean', { published: 'yes' }],
        ['a missing published flag', { published: deleted() }],
        ['an unknown field', { html: '<script>alert(1)</script>' }],
    ])('badPath_adminCannotSave_%s', async (_label, changes) => {
        expect(await edit(changes)).toBe('deny');
    });

    it.each([
        ['another editor', { updatedBy: 'someone-else', updatedAt: serverTime() }],
        ['a client clock', { updatedBy: 'cities-admin', updatedAt: past() }],
        ['no stamp at all', {}],
    ])('badPath_editsMustBeStampedByTheEditorWithTheServerClock_%s', async (_label, stamp) => {
        const path = await seededCity();

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ published: false, ...stamp }),
            ),
        ).toBe('deny');
    });
});

function tokensOf(count: number): Data {
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [`--md-sys-color-token-${String(index)}`, '#000000']));
}

function tokenSchemes(count: number): Data {
    return { light: tokensOf(count), dark: tokensOf(count), highContrastLight: tokensOf(count), highContrastDark: tokensOf(count) };
}

function configOf(count: number): Data {
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [`option${String(index)}`, index]));
}
