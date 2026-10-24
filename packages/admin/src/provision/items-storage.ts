import { PRIVATE_BUCKET_LIFECYCLE } from '@hcm/shared';

import { ensureBindings, type WantedBinding } from '../google/iam-policy.js';
import type { Bucket } from '../google/storage.js';
import { isGoogleFailure } from '../google/failure.js';
import { at, matchesSpec, records, type JsonObject } from '../google/json.js';
import { eachInTurn, lacking, refused, type Observation, type ProvisionContext, type ProvisionItemSpec } from './item.js';

/**
 * The storage items (`docs/research/M2b-interfaces.md` §3.4 items 4–6, §3.4.2): Firebase Storage's default bucket (the
 * private one) and the public bucket with its public read, their CORS rules, and the private bucket's lifecycle. An
 * organisation policy that refuses `allUsers` leaves `buckets` invalid with its constraint named; the buckets themselves
 * are still created.
 */

/** `get` without `list` for everyone (security review §1.5); `objectViewer` when the legacy role is refused. */
const PUBLIC_READ: WantedBinding = { role: 'roles/storage.legacyObjectReader', member: 'allUsers' };
const PUBLIC_READ_FALLBACK: WantedBinding = { role: 'roles/storage.objectViewer', member: 'allUsers' };

/** What `buckets` may lack. */
const DEFAULT_BUCKET = 'default-bucket' as const;
const PUBLIC_BUCKET = 'public-bucket' as const;
const PUBLIC_READ_PART = 'public-read' as const;

const CORS_HEADERS = ['Content-Type', 'Range', 'Content-Range', 'ETag', 'Accept-Ranges'];

function corsRule(origins: readonly string[]): JsonObject[] {
    return [{ origin: origins, method: ['GET', 'HEAD'], responseHeader: CORS_HEADERS, maxAgeSeconds: 3600 }];
}

/**
 * The private bucket's lifecycle, `PRIVATE_BUCKET_LIFECYCLE` of `@hcm/shared` (CR-M3-6): `tmp/` after a day, `uploads/`
 * after a week, the raster pipeline's `work/` after two, `usgs-raw/` after a month and the cached `reference/` after 90 days.
 */
const LIFECYCLE: JsonObject = {
    rule: PRIVATE_BUCKET_LIFECYCLE.map(({ prefix, days }) => ({
        action: { type: 'Delete' },
        condition: { age: days, matchesPrefix: [prefix] },
    })),
};

/** The CORS rules of a bucket: the public one for every origin, the private one for the admin only. */
function corsFor(context: ProvisionContext, bucket: string): JsonObject[] {
    return corsRule(bucket === context.names.publicBucket ? ['*'] : context.names.adminOrigins);
}

function publiclyReadable(bindings: readonly { readonly role: string; readonly members: readonly string[] }[]): boolean {
    return bindings.some(
        (binding) => [PUBLIC_READ.role, PUBLIC_READ_FALLBACK.role].includes(binding.role) && binding.members.includes('allUsers'),
    );
}

/** The constraint that refuses `allUsers` on the project, if any. */
async function publicReadBlocker(context: ProvisionContext): Promise<string | undefined> {
    const findings = await context.findings();
    if (findings.domainRestricted) {
        return 'iam.allowedPolicyMemberDomains';
    }
    return findings.publicAccessPrevention ? 'storage.publicAccessPrevention' : undefined;
}

/** The public bucket, `taken` when another project owns its name (Google answers 403 for a bucket we cannot read). */
async function readPublicBucket(context: ProvisionContext): Promise<Bucket | undefined | 'taken'> {
    try {
        const bucket = await context.clients.storage.getBucket(context.names.publicBucket);
        return bucket === undefined || bucket.projectNumber === context.project.projectNumber ? bucket : 'taken';
    } catch (error) {
        return takenWhenForbidden(error);
    }
}

/** A 403 that does not name a disabled API: the bucket belongs to someone else. */
function takenWhenForbidden(error: unknown): 'taken' {
    if (isGoogleFailure(error, 'forbidden') && error.api === undefined) {
        return 'taken';
    }
    throw error;
}

/** What the public bucket lacks: itself and its public read, or only the read. */
async function publicBucketParts(context: ProvisionContext): Promise<readonly string[] | 'taken'> {
    const bucket = await readPublicBucket(context);
    if (bucket === undefined || bucket === 'taken') {
        return bucket ?? [PUBLIC_BUCKET, PUBLIC_READ_PART];
    }
    const policy = await context.clients.storage.bucketPolicy(bucket.name).read();
    return publiclyReadable(policy.bindings) ? [] : [PUBLIC_READ_PART];
}

/** The lacking parts, except a public read an organisation policy refuses: that one makes the item invalid. */
function bucketObservation(context: ProvisionContext, lacks: readonly string[], blocker: string | undefined): Observation {
    const creatable = blocker === undefined ? lacks : lacks.filter((part) => part !== PUBLIC_READ_PART);
    if (creatable.length === 0 && blocker !== undefined && lacks.includes(PUBLIC_READ_PART)) {
        return refused('adminSetup.provision.orgPolicy', { constraint: blocker });
    }
    return lacking(creatable, () => createParts(context, creatable));
}

/** Grants the public read; a refused legacy role (uniform access) falls back to `objectViewer` (**UNVERIFIED**). */
async function grantPublicRead(context: ProvisionContext): Promise<void> {
    const policy = context.clients.storage.bucketPolicy(context.names.publicBucket);
    try {
        await ensureBindings(policy, [PUBLIC_READ]);
    } catch (error) {
        if (!isGoogleFailure(error, 'invalid')) {
            throw error;
        }
        await ensureBindings(policy, [PUBLIC_READ_FALLBACK]);
    }
}

const BUCKET_PARTS = [DEFAULT_BUCKET, PUBLIC_BUCKET, PUBLIC_READ_PART] as const;

const CREATE_PART: Readonly<Record<(typeof BUCKET_PARTS)[number], (context: ProvisionContext) => Promise<unknown>>> = {
    [DEFAULT_BUCKET]: ({ clients, project }) => clients.storage.addDefaultBucket(project.projectNumber, project.region),
    [PUBLIC_BUCKET]: ({ clients, project, names }) =>
        clients.storage.createBucket(project.projectId, project.projectNumber, {
            name: names.publicBucket,
            location: project.region.toUpperCase(),
            storageClass: 'STANDARD',
            iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'inherited' },
        }),
    [PUBLIC_READ_PART]: grantPublicRead,
};

function createParts(context: ProvisionContext, lacks: readonly string[]): Promise<void> {
    return eachInTurn(
        BUCKET_PARTS.filter((part) => lacks.includes(part)),
        (part) => CREATE_PART[part](context),
    );
}

const buckets: ProvisionItemSpec = {
    id: 'buckets',
    after: ['apis', 'org-policies'],
    observe: async (context) => {
        const parts = await publicBucketParts(context);
        if (parts === 'taken') {
            return refused('apiError.conflict', { bucket: context.names.publicBucket });
        }
        const hasDefault = await context.clients.storage.hasDefaultBucket(context.project.projectNumber);
        return bucketObservation(context, [...(hasDefault ? [] : [DEFAULT_BUCKET]), ...parts], await publicReadBlocker(context));
    },
};

/** The buckets whose `field` does not match its spec (a missing bucket counts as not matching). */
async function bucketsDiffering(context: ProvisionContext, specs: ReadonlyMap<string, JsonObject>): Promise<string[]> {
    const names = [...specs.keys()];
    const found = await Promise.all(names.map((name) => context.clients.storage.getBucket(name)));
    return names.filter((name, index) => !matchesSpec(found[index]?.body, specs.get(name)));
}

const bucketCors: ProvisionItemSpec = {
    id: 'bucket-cors',
    after: ['buckets'],
    observe: async (context) => {
        const { privateBucket, publicBucket } = context.names;
        const specs = new Map([privateBucket, publicBucket].map((name) => [name, { cors: corsFor(context, name) }]));
        const differing = await bucketsDiffering(context, specs);
        return lacking(differing, () =>
            eachInTurn(differing, (name) => context.clients.storage.patchBucket(name, { cors: corsFor(context, name) })),
        );
    },
};

/** Soft delete is off for the private bucket (uploads and temporary files are not worth keeping deleted). */
function softDeleteOff(body: JsonObject | undefined): boolean {
    return Number(at(body, 'softDeletePolicy', 'retentionDurationSeconds') ?? 'x') === 0;
}

const bucketLifecycle: ProvisionItemSpec = {
    id: 'bucket-lifecycle',
    after: ['buckets'],
    observe: async ({ clients, names }) => {
        const bucket = await clients.storage.getBucket(names.privateBucket);
        const rules = records(at(bucket?.body, 'lifecycle', 'rule'));
        const right = matchesSpec({ rule: rules }, LIFECYCLE) && softDeleteOff(bucket?.body);
        return lacking(right ? [] : [names.privateBucket], () =>
            clients.storage.patchBucket(names.privateBucket, { lifecycle: LIFECYCLE, softDeletePolicy: { retentionDurationSeconds: '0' } }),
        );
    },
};

export const STORAGE_ITEMS: readonly ProvisionItemSpec[] = [buckets, bucketCors, bucketLifecycle];
