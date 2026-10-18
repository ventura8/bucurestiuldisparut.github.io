/**
 * firebase/firestore.indexes.json (no emulator: the emulator serves every query without indexes, production does
 * not). Every composite index names fields of its collection's zod schema, the admin's list queries have theirs, and
 * the large fields exempt from single-field indexing (texts, geometries, snapshots, theme tokens) exist and are never
 * part of a composite index.
 */
import { readFileSync } from 'node:fs';

import {
    cityDocSchema,
    historyEntryDocSchema,
    jobDocSchema,
    jobLogDocSchema,
    layerDocSchema,
    manifestStateDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    usgsSceneDocSchema,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

interface IndexField {
    readonly fieldPath: string;
    readonly order?: string;
    readonly arrayConfig?: string;
}

interface CompositeIndex {
    readonly collectionGroup: string;
    readonly queryScope: string;
    readonly fields: readonly IndexField[];
}

interface FieldOverride {
    readonly collectionGroup: string;
    readonly fieldPath: string;
    readonly indexes: readonly unknown[];
}

interface IndexFile {
    readonly indexes: readonly CompositeIndex[];
    readonly fieldOverrides: readonly FieldOverride[];
}

const config = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')) as IndexFile;

/** The collection ids (Firestore's `collectionGroup`) of the project and the schema of their documents. */
const SCHEMAS: Readonly<Record<string, { readonly shape: object }>> = {
    cities: cityDocSchema,
    photos: photoDocSchema,
    layers: layerDocSchema,
    pois: poiDocSchema,
    poiCategories: poiCategoryDocSchema,
    jobs: jobDocSchema,
    logs: jobLogDocSchema,
    usgsScenes: usgsSceneDocSchema,
    history: historyEntryDocSchema,
    manifests: manifestStateDocSchema,
};

function fieldsOf(collection: string): string[] {
    return Object.keys(SCHEMAS[collection]?.shape ?? {});
}

function describeField(field: IndexField): string {
    return `${field.fieldPath} ${field.order ?? field.arrayConfig ?? ''}`;
}

/** `photos: published ASCENDING, updatedAt DESCENDING`: an index as one readable line. */
function signature(index: CompositeIndex): string {
    return `${index.collectionGroup}: ${index.fields.map(describeField).join(', ')}`;
}

describe('composite indexes', () => {
    it.each(config.indexes.map((index) => [signature(index), index] as const))('happyPath_%s_namesSchemaFields', (_signature, index) => {
        const unknown = index.fields.filter((field) => !fieldsOf(index.collectionGroup).includes(field.fieldPath.split('.')[0] ?? ''));

        expect(unknown).toEqual([]);
        // History's recent changes are the one collection-group query (docs/research/M2c-interfaces.md §9.2, CR-M2c-6).
        expect([index.queryScope, index.collectionGroup === 'history' || index.queryScope === 'COLLECTION']).toEqual([
            expect.stringMatching(/^COLLECTION(_GROUP)?$/),
            true,
        ]);
        expect(index.fields.length).toBeGreaterThanOrEqual(2);
    });

    it.each([
        'photos: published ASCENDING, updatedAt DESCENDING',
        'photos: processing ASCENDING, updatedAt DESCENDING',
        'photos: license ASCENDING, updatedAt DESCENDING',
        'photos: rightsReview ASCENDING, updatedAt DESCENDING',
        'pois: category ASCENDING, updatedAt DESCENDING',
        'pois: published ASCENDING, updatedAt DESCENDING',
        'layers: published ASCENDING, order ASCENDING',
        'jobs: status ASCENDING, createdAt DESCENDING',
        'jobs: status ASCENDING, createdAt ASCENDING',
        'history: action ASCENDING, updatedAt DESCENDING',
    ])('happyPath_theAdminQueryHasItsIndex_%s', (wanted) => {
        expect(config.indexes.filter((index) => index.queryScope === 'COLLECTION').map(signature)).toContain(wanted);
    });

    it.each([
        'history: action ASCENDING, updatedAt DESCENDING',
        'history: entity ASCENDING, updatedAt DESCENDING',
        'history: entity ASCENDING, action ASCENDING, updatedAt DESCENDING',
    ])('happyPath_historysRecentChangesHaveTheirCollectionGroupIndex_%s', (wanted) => {
        expect(config.indexes.filter((index) => index.queryScope === 'COLLECTION_GROUP').map(signature)).toContain(wanted);
    });

    it('badPath_noIndexIsDeclaredTwice', () => {
        const signatures = config.indexes.map((index) => `${index.queryScope} ${signature(index)}`);

        expect(new Set(signatures).size).toBe(signatures.length);
    });
});

/** The single-field overrides that add an index instead of removing them all. */
const ADDED_FIELD_INDEXES = new Set(['history.updatedAt']);

describe('single-field exemptions', () => {
    it.each(
        config.fieldOverrides
            .filter((override) => !ADDED_FIELD_INDEXES.has(`${override.collectionGroup}.${override.fieldPath}`))
            .map((override) => [`${override.collectionGroup}.${override.fieldPath}`, override] as const),
    )('happyPath_%s_isASchemaFieldWithoutIndexes', (_name, override) => {
        expect(fieldsOf(override.collectionGroup)).toContain(override.fieldPath);
        expect(override.indexes).toEqual([]);
    });

    it('happyPath_historysUpdatedAtKeepsItsDefaultsAndGainsTheCollectionGroupOrder', () => {
        const override = config.fieldOverrides.find(
            (candidate) => `${candidate.collectionGroup}.${candidate.fieldPath}` === 'history.updatedAt',
        );

        expect(override?.indexes).toEqual([
            { order: 'ASCENDING', queryScope: 'COLLECTION' },
            { order: 'DESCENDING', queryScope: 'COLLECTION' },
            { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' },
            { order: 'DESCENDING', queryScope: 'COLLECTION_GROUP' },
        ]);
    });

    it('badPath_noCompositeIndexUsesAnExemptField', () => {
        const exempt = new Set(
            config.fieldOverrides
                .filter((override) => override.indexes.length === 0)
                .map((override) => `${override.collectionGroup}.${override.fieldPath}`),
        );
        const clashes = config.indexes.flatMap((index) =>
            index.fields.filter((field) => exempt.has(`${index.collectionGroup}.${field.fieldPath}`)).map(() => signature(index)),
        );

        expect(clashes).toEqual([]);
    });

    it('badPath_unknownCollectionsHaveNoFields', () => {
        expect(fieldsOf('gcps')).toEqual([]);
    });
});
