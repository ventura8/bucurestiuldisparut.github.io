import type { WantedBinding } from '../google/iam-policy.js';
import { projectNames, type ProjectConfig, type ServiceAccountId } from './project-config.js';

/**
 * What the provisioner creates and binds (`docs/research/M2b-interfaces.md` §3.4, §3.4.1; security review §1.1, M2
 * §4.3, `DECISIONS-for-review.md` §19b, CR-M2-5): the APIs, the secret shells, and the M2b rows of the role table. The
 * M3 rows (Cloud Run jobs, Artifact Registry, the public bucket's `previews/`) join with the raster pipeline.
 */

/** The APIs the `apis` item enables (`<name>.googleapis.com`). */
export const REQUIRED_APIS: readonly string[] = [
    'cloudresourcemanager',
    'serviceusage',
    'cloudbilling',
    'billingbudgets',
    'iam',
    'iamcredentials',
    'sts',
    'cloudfunctions',
    'run',
    'cloudbuild',
    'artifactregistry',
    'eventarc',
    'pubsub',
    'cloudscheduler',
    'cloudtasks',
    'secretmanager',
    'storage',
    'firebasestorage',
    'firebaseappcheck',
    'recaptchaenterprise',
    'firebaseinstallations',
    'monitoring',
    'logging',
    'clouderrorreporting',
    'orgpolicy',
    'apikeys',
    'analyticsadmin',
].map((name) => `${name}.googleapis.com`);

/** The Secret Manager shells; the values arrive through `setup.saveUsgs` and `setup.saveMapbox`. */
export const SECRET_IDS = ['usgs-username', 'usgs-app-token', 'mapbox-sk-bootstrap', 'mapbox-sk-tiles'] as const;

type SecretId = (typeof SECRET_IDS)[number];

/** The secrets the event functions and the raster job read. */
const READER_SECRETS: readonly SecretId[] = ['usgs-username', 'usgs-app-token', 'mapbox-sk-tiles'];

/** One IAM policy and the bindings it must hold. */
export interface PolicyBindings {
    readonly kind: 'project' | 'bucket' | 'secret' | 'serviceAccount';
    /** The project id, a bucket name, a secret id or a service account's e-mail address. */
    readonly resource: string;
    readonly bindings: readonly WantedBinding[];
}

/** The Google service agents the role table binds, from `generateServiceIdentity` and Cloud Storage's own read. */
export interface ServiceAgents {
    /** `service-<number>@gcp-sa-firebasestorage.iam.gserviceaccount.com` */
    readonly firebaseStorage: string;
    /** `service-<number>@gs-project-accounts.iam.gserviceaccount.com` */
    readonly cloudStorage: string;
}

function grants(member: string, roles: readonly string[]): WantedBinding[] {
    return roles.map((role) => ({ role, member }));
}

const FN_ADMIN_PROJECT_ROLES = [
    'roles/datastore.user',
    'roles/firebaseauth.admin',
    'roles/firebase.viewer',
    'roles/errorreporting.viewer',
    'roles/cloudtasks.enqueuer',
];
const FN_EVENTS_PROJECT_ROLES = ['roles/datastore.user', 'roles/eventarc.eventReceiver', 'roles/cloudtasks.enqueuer'];
const DEPLOYER_PROJECT_ROLES = [
    'roles/firebasehosting.admin',
    'roles/firebaserules.admin',
    'roles/datastore.indexAdmin',
    'roles/cloudfunctions.developer',
    'roles/cloudscheduler.admin',
    'roles/cloudtasks.queueAdmin',
    'roles/serviceusage.serviceUsageConsumer',
    'roles/firebase.viewer',
];
const FN_ADMIN_SECRET_ROLES = [
    'roles/secretmanager.secretAccessor',
    'roles/secretmanager.secretVersionAdder',
    'roles/secretmanager.secretVersionManager',
];

/** The project's bindings; the compute default account's builder role only when the organisation withholds it. */
function projectBindings(project: ProjectConfig, agents: ServiceAgents, noDefaultGrants: boolean): PolicyBindings {
    const names = projectNames(project);
    const compute = `serviceAccount:${project.projectNumber}-compute@developer.gserviceaccount.com`;
    return {
        kind: 'project',
        resource: project.projectId,
        bindings: [
            ...grants(names.member('fn-admin'), FN_ADMIN_PROJECT_ROLES),
            ...grants(names.member('fn-events'), FN_EVENTS_PROJECT_ROLES),
            ...grants(names.member('job-raster'), ['roles/datastore.user']),
            ...grants(names.member('gh-deployer'), DEPLOYER_PROJECT_ROLES),
            ...grants(`serviceAccount:${agents.firebaseStorage}`, ['roles/firebaserules.firestoreServiceAgent']),
            ...grants(`serviceAccount:${agents.cloudStorage}`, ['roles/pubsub.publisher']),
            ...(noDefaultGrants ? grants(compute, ['roles/cloudbuild.builds.builder']) : []),
        ],
    };
}

function bucketBindings(project: ProjectConfig): PolicyBindings[] {
    const names = projectNames(project);
    const writers = (accounts: readonly ServiceAccountId[]): WantedBinding[] =>
        accounts.flatMap((account) => grants(names.member(account), ['roles/storage.objectAdmin']));
    return [
        { kind: 'bucket', resource: names.privateBucket, bindings: writers(['fn-admin', 'fn-events', 'job-raster']) },
        { kind: 'bucket', resource: names.publicBucket, bindings: writers(['fn-admin', 'fn-events']) },
    ];
}

function secretBindings(project: ProjectConfig): PolicyBindings[] {
    const names = projectNames(project);
    return SECRET_IDS.map((secret) => ({
        kind: 'secret' as const,
        resource: secret,
        bindings: [
            ...grants(names.member('fn-admin'), FN_ADMIN_SECRET_ROLES),
            ...(READER_SECRETS.includes(secret)
                ? [names.member('fn-events'), names.member('job-raster')].flatMap((member) =>
                      grants(member, ['roles/secretmanager.secretAccessor']),
                  )
                : []),
        ],
    }));
}

/** `iam.serviceAccountUser` on the function accounts: each for itself (Cloud Tasks OIDC), the deployer for all three. */
function serviceAccountBindings(project: ProjectConfig): PolicyBindings[] {
    const names = projectNames(project);
    const user = (member: string): WantedBinding => ({ role: 'roles/iam.serviceAccountUser', member });
    const deployer = user(names.member('gh-deployer'));
    return [
        { kind: 'serviceAccount', resource: names.email('fn-admin'), bindings: [user(names.member('fn-admin')), deployer] },
        { kind: 'serviceAccount', resource: names.email('fn-events'), bindings: [user(names.member('fn-events')), deployer] },
        { kind: 'serviceAccount', resource: names.email('job-raster'), bindings: [deployer] },
    ];
}

/** Every policy the `iam` item keeps (§3.4.1), project first. */
export function roleTable(project: ProjectConfig, agents: ServiceAgents, noDefaultGrants: boolean): PolicyBindings[] {
    return [
        projectBindings(project, agents, noDefaultGrants),
        ...bucketBindings(project),
        ...secretBindings(project),
        ...serviceAccountBindings(project),
    ];
}
