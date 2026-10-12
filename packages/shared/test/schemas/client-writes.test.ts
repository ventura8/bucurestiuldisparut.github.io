import { describe, expect, it } from 'vitest';

import { CLIENT_WRITES, type ClientCollection } from '../../src/schemas/client-writes.js';
import { jobDocSchema, usgsSceneDocSchema } from '../../src/schemas/firestore-ops.js';
import { cityDocSchema, layerDocSchema, photoDocSchema, poiCategoryDocSchema, poiDocSchema } from '../../src/schemas/firestore.js';

const SHAPES: Readonly<Record<ClientCollection, readonly string[]>> = {
    city: Object.keys(cityDocSchema.shape),
    photo: Object.keys(photoDocSchema.shape),
    layer: Object.keys(layerDocSchema.shape),
    poi: Object.keys(poiDocSchema.shape),
    poiCategory: Object.keys(poiCategoryDocSchema.shape),
    job: Object.keys(jobDocSchema.shape),
    usgsScene: Object.keys(usgsSceneDocSchema.shape),
};

const COLLECTIONS = Object.keys(CLIENT_WRITES) as ClientCollection[];

describe('CLIENT_WRITES', () => {
    it.each(COLLECTIONS)('happyPath_%s_namesOnlyFieldsOfItsDocument', (collection) => {
        const { create, update } = CLIENT_WRITES[collection];

        expect([...create, ...update].filter((field) => !SHAPES[collection].includes(field))).toEqual([]);
    });

    it.each(COLLECTIONS)('happyPath_%s_everyWriteCarriesTheStamp', (collection) => {
        const { create, update } = CLIENT_WRITES[collection];

        for (const fields of [create, update].filter((list) => list.length > 0)) {
            expect(fields).toEqual(expect.arrayContaining(['updatedBy', 'updatedAt']));
        }
    });

    it('badPath_serverOwnedFieldsAreNeverClientWritable', () => {
        const writable = (collection: ClientCollection) => [...CLIENT_WRITES[collection].create, ...CLIENT_WRITES[collection].update];

        expect(writable('city')).not.toEqual(expect.arrayContaining(['mapbox']));
        expect(writable('city').filter((field) => ['id', 'mapbox', 'analytics', 'engine', 'createdAt'].includes(field))).toEqual([]);
        expect(
            writable('photo').filter((field) =>
                ['image', 'exif', 'processingError', 'duplicateOf', 'suggested', 'original'].includes(field),
            ),
        ).toEqual([]);
        expect(writable('layer').filter((field) => ['source', 'status', 'mapbox', 'provenance', 'kind'].includes(field))).toEqual([]);
        expect(writable('job').filter((field) => ['executionName', 'lease', 'steps', 'error'].includes(field))).toEqual([]);
    });

    it('badPath_anUpdateNeverChangesWhatOnlyACreateSets', () => {
        expect(CLIENT_WRITES.photo.update.filter((field) => ['processing', 'createdAt', 'createdBy'].includes(field))).toEqual([]);
        expect(CLIENT_WRITES.poi.update.filter((field) => ['createdAt', 'createdBy'].includes(field))).toEqual([]);
        expect(CLIENT_WRITES.city.create).toEqual([]);
        expect(CLIENT_WRITES.layer.create).toEqual([]);
    });
});
