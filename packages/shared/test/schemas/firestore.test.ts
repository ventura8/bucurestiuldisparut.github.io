import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
    adminDocSchema,
    cityDocSchema,
    jobDocSchema,
    layerDocSchema,
    photoDocSchema,
    setupStatusDocSchema,
    timestampSchema,
    usgsSceneDocSchema,
} from '../../src/schemas/firestore.js';
import { validate, type ValidationResult } from '../../src/schemas/validation.js';

/** One entry point for every document schema (the tables below mix them). */
function check(schema: z.ZodType, doc: unknown): ValidationResult<unknown> {
    return validate(schema, doc);
}

/** What the Firestore SDKs return: a class instance whose `seconds`/`nanoseconds` are getters. */
class FakeTimestamp {
    readonly #seconds: number;
    readonly #nanoseconds: number;

    constructor(seconds: number, nanoseconds = 0) {
        this.#seconds = seconds;
        this.#nanoseconds = nanoseconds;
    }

    get seconds(): number {
        return this.#seconds;
    }

    get nanoseconds(): number {
        return this.#nanoseconds;
    }
}

const now = new FakeTimestamp(1_760_000_000);
const stamp = { updatedBy: 'uid-admin', updatedAt: now };

const docs = {
    city: {
        id: 'bucuresti',
        name: { ro: 'București dispărut' },
        bounds: { west: 25.93, south: 44.33, east: 26.25, north: 44.55 },
        center: { lat: 44.427037, lng: 26.085298 },
        zoom: 14.5,
        about: { ro: '**Despre**' },
        mapbox: { user: 'ventura86', publicToken: 'pk.test-viewer-token' },
        analytics: { measurementId: 'G-TEST1234' },
        published: false,
        createdAt: now,
        ...stamp,
    },
    photo: {
        title: { ro: 'Mihai Vodă', en: 'Mihai Vodă street' },
        year: 1978,
        license: 'unknown',
        location: { lat: 44.43, lng: 26.09 },
        links: [{ url: 'https://example.org/x', label: 'x' }],
        sourceUrl: 'https://example.org/source',
        published: false,
        processing: 'done',
        image: {
            web: 'https://storage.example.org/w.webp',
            thumb: 'https://storage.example.org/t.webp',
            sha256: 'a'.repeat(64),
            w: 10,
            h: 10,
        },
        exif: { Make: 'Zenit', FNumber: 8 },
        ...stamp,
    },
    layer: {
        year: 1966,
        label: { ro: 'Corona 1966' },
        kind: 'satellite',
        source: { type: 'mapbox', tilesetId: 'test-owner.kh4-1966' },
        minzoom: 10,
        maxzoom: 17,
        bounds: { west: 25.95, south: 44.35, east: 26.2, north: 44.5 },
        order: 1,
        opacity: 1,
        defaultVisible: true,
        status: 'awaiting_approval',
        published: false,
        provenance: {
            usgsEntityId: 'DS1035-1057DA023',
            usgsDataset: 'corona2',
            georef: { method: 'gcps', gcpCount: 12, checkpointRmseM: 8.5 },
        },
        mapbox: { tilesetId: 'test-owner.kh4-1966', publishedSourceSha: 'b'.repeat(64) },
    },
    job: {
        type: 'usgs-import',
        status: 'waiting_usgs',
        params: { entityId: 'DS1035' },
        createdBy: 'uid-admin',
        createdAt: now,
        retryAt: now,
        progress: 0.4,
    },
    scene: {
        entityId: 'DS1035-1057DA023',
        dataset: 'corona2',
        acquisitionDate: '1966-07-12',
        status: 'candidate',
        downloadAvailable: true,
        footprint: [
            { lat: 44, lng: 26 },
            { lat: 44.5, lng: 26 },
            { lat: 44.5, lng: 26.5 },
        ],
    },
    setup: { mapbox: { state: 'ok', checkedAt: now }, usgs: { state: 'missing' }, secretsRev: 3 },
    admin: { role: 'owner', email: 'owner@example.test', displayName: 'Owner', createdAt: now },
};

describe('Firestore documents: happy paths', () => {
    it.each([
        ['city', cityDocSchema, docs.city],
        ['photo', photoDocSchema, docs.photo],
        ['layer', layerDocSchema, docs.layer],
        ['job', jobDocSchema, docs.job],
        ['usgsScene', usgsSceneDocSchema, docs.scene],
        ['setupStatus', setupStatusDocSchema, docs.setup],
        ['admin', adminDocSchema, docs.admin],
    ] as const)('happyPath_%s', (_name, schema, doc) => {
        expect(check(schema, doc)).toMatchObject({ ok: true });
    });

    it('happyPath_aYearRange', () => {
        expect(check(photoDocSchema, { ...docs.photo, year: 1978, yearEnd: 1980 })).toMatchObject({ ok: true });
    });

    it('happyPath_aPlainTimestampObjectIsAccepted', () => {
        expect(timestampSchema.safeParse({ seconds: 1, nanoseconds: 2 }).success).toBe(true);
    });
});

describe('Firestore documents: bad paths', () => {
    it.each([
        ['a city without a stamp', cityDocSchema, { ...docs.city, updatedAt: undefined }, 'updatedAt', 'validation.required'],
        [
            'inverted city bounds',
            cityDocSchema,
            { ...docs.city, bounds: { west: 27, south: 44, east: 26, north: 45 } },
            'bounds',
            'validation.bounds',
        ],
        [
            'a secret token on the city',
            cityDocSchema,
            { ...docs.city, mapbox: { publicToken: 'sk.secret-scenario' } },
            'mapbox.publicToken',
            'validation.format',
        ],
        ['a photo without processing state', photoDocSchema, { ...docs.photo, processing: undefined }, 'processing', 'validation.required'],
        ['an unknown photo field', photoDocSchema, { ...docs.photo, html: '<b>x</b>' }, 'html', 'validation.unknownKey'],
        [
            'a photo end year without a year',
            photoDocSchema,
            { ...docs.photo, year: undefined, yearEnd: 1980 },
            'yearEnd',
            'validation.yearRange',
        ],
        [
            'a short image hash',
            photoDocSchema,
            { ...docs.photo, image: { ...docs.photo.image, sha256: 'abc' } },
            'image.sha256',
            'validation.format',
        ],
        ['an end year before the year', photoDocSchema, { ...docs.photo, year: 1981, yearEnd: 1980 }, 'yearEnd', 'validation.yearRange'],
        ['an unknown layer status', layerDocSchema, { ...docs.layer, status: 'live' }, 'status', 'validation.value'],
        [
            'an unknown georeferencing method',
            layerDocSchema,
            { ...docs.layer, provenance: { georef: { method: 'magic' } } },
            'provenance.georef.method',
            'validation.value',
        ],
        ['an unknown job type', jobDocSchema, { ...docs.job, type: 'delete-everything' }, 'type', 'validation.value'],
        ['a job progress over 1', jobDocSchema, { ...docs.job, progress: 2 }, 'progress', 'validation.tooBig'],
        [
            'a footprint of two points',
            usgsSceneDocSchema,
            { ...docs.scene, footprint: docs.scene.footprint.slice(0, 2) },
            'footprint',
            'validation.tooSmall',
        ],
        ['an unknown USGS dataset', usgsSceneDocSchema, { ...docs.scene, dataset: 'declassi' }, 'dataset', 'validation.value'],
        ['a secret in setup status', setupStatusDocSchema, { ...docs.setup, mapboxToken: 'sk.x' }, 'mapboxToken', 'validation.unknownKey'],
        ['an unknown service state', setupStatusDocSchema, { ...docs.setup, usgs: { state: 'pending' } }, 'usgs.state', 'validation.value'],
        ['an invalid admin e-mail', adminDocSchema, { ...docs.admin, email: 'not-an-address' }, 'email', 'validation.format'],
        ['a timestamp as a string', adminDocSchema, { ...docs.admin, createdAt: '2026-10-12' }, 'createdAt', 'validation.type'],
    ] as const)('badPath_%s', (_name, schema, doc, path, code) => {
        const result = check(schema, doc);

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });

    it.each([[null], [{ seconds: '1', nanoseconds: 0 }], [{ seconds: 1 }], [new Date()]])('badPath_timestamp_%j', (value) => {
        expect(timestampSchema.safeParse(value).success).toBe(false);
    });
});
