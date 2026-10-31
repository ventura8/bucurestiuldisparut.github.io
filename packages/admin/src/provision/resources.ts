import { INSTALLER_ACCOUNT, PIPELINE_REPOSITORY, VERTEX_DRAFTS_PERMISSIONS, VERTEX_DRAFTS_ROLE_ID } from '@hcm/shared';

import { customRoleName, type CustomRoleSpec } from '../google/iam.js';
import type { WantedBinding } from '../google/iam-policy.js';
import { projectNames, type ProjectConfig, type ServiceAccountId } from './project-config.js';

/**
 * What the provisioner creates and binds (`docs/research/M2b-interfaces.md` §3.4, §3.4.1; security review §1.1, M2
 * §4.3, `DECISIONS-for-review.md` §19b, CR-M2-5): the APIs, the secret shells, and the role table, with the M3 rows of
 * `docs/research/M3-interfaces.md` §9.4 (CR-M3-6): the event functions run the raster job's executions, and the raster
 * job reads the USGS secrets only (publishing, and so the Mapbox secret, stays in the functions).
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
    // M4 (docs/research/M4-interfaces.md §4.4, CR-M4-5): Vertex AI for the translation drafts, FCM's sends and the browser's
    // token registration for web push.
    'aiplatform',
    'fcm',
    'fcmregistrations',
    // M6 (docs/research/M6-interfaces.md §1.6, CR-M6-2): the in-app installer's firebase-tools checks these are on; a new
    // Firebase project has them, a self-hosted one may not (UNVERIFIED).
    'firebasehosting',
    'firebaserules',
    'firestore',
].map((name) => `${name}.googleapis.com`);

/** The Secret Manager shells; the values arrive through `setup.saveUsgs` and `setup.saveMapbox`. */
export const SECRET_IDS = ['usgs-username', 'usgs-app-token', 'mapbox-sk-bootstrap', 'mapbox-sk-tiles'] as const;

type SecretId = (typeof SECRET_IDS)[number];

/** The secrets the event functions read (the dispatcher, the publisher, the tick, the upload trigger). */
const EVENTS_SECRETS: readonly SecretId[] = ['usgs-username', 'usgs-app-token', 'mapbox-sk-tiles'];

/** The secrets the raster job reads: USGS only, never a Mapbox secret (M3 §9.4). */
const RASTER_SECRETS: readonly SecretId[] = ['usgs-username', 'usgs-app-token'];

/** One IAM policy and the bindings it must hold. */
export interface PolicyBindings {
    readonly kind: 'project' | 'bucket' | 'secret' | 'serviceAccount' | 'repository';
    /** The project id, a bucket name, a secret id, a service account's e-mail address or an Artifact Registry repository. */
    readonly resource: string;
    readonly bindings: readonly WantedBinding[];
}

/** The Google service agents the role table binds, from `generateServiceIdentity` and Cloud Storage's own read. */
export interface ServiceAgents {
    /** `service-<number>@gcp-sa-firebasestorage.iam.gserviceaccount.com` */
    readonly firebaseStorage: string;
    /** `service-<number>@gs-project-accounts.iam.gserviceaccount.com` */
    readonly cloudStorage: string;
    /**
     * M6 (finding 12, `docs/research/M6-interfaces.md` §1.6): `service-<number>@gcp-sa-pubsub.iam.gserviceaccount.com`,
     * generated before the first install with Eventarc's (whose roles Google grants it when it is made), so neither is
     * still propagating when the event triggers deploy.
     */
    readonly pubsub: string;
    /**
     * The Compute Engine default account (`<number>-compute@developer.gserviceaccount.com`) when the project has one: a
     * first functions deploy wants it to invoke and receive events (firebase-tools' `ensureServiceAgentRoles`), and the
     * installer may read the project's policy but never write it. Undefined: nothing is bound to it.
     */
    readonly computeDefault: string | undefined;
}

function grants(member: string, roles: readonly string[]): WantedBinding[] {
    return roles.map((role) => ({ role, member }));
}

/**
 * M4 (`docs/research/M4-interfaces.md` §4.4, CR-M4-5): `assist.translateDraft` and the setup self-test call Vertex AI;
 * `notify.registerDevice` and `notify.sendTest` send through FCM. UNVERIFIED (§10): that `firebasecloudmessaging.admin` is
 * the narrowest role holding `cloudmessaging.messages.create`.
 */

/**
 * The project's custom roles, made by the `iam` item before the role table binds them (`DECISIONS-for-review.md` §57g):
 * Vertex AI's predefined `roles/aiplatform.user` would also let the functions' account start billable custom jobs and
 * deploy endpoints; the drafts and the self-test only call `generateContent` and `countTokens` of a publisher model.
 */
export interface CustomRoleEntry {
    readonly id: string;
    readonly spec: CustomRoleSpec;
}

/**
 * M6 (`docs/research/M6-interfaces.md` §1.2, CR-M6-2): what the in-app installer needs beyond its predefined roles.
 * `roles/run.admin` would let it replace any Cloud Run service's code, `roles/resourcemanager.projectIamAdmin` grant
 * anything, `roles/artifactregistry.repoAdmin` on the project delete repositories (DECISIONS-for-review.md §67).
 */
const INSTALLER_ROLE_ID = 'hcmInstaller';
const INSTALLER_PERMISSIONS: readonly string[] = [
    'run.services.get',
    'run.services.getIamPolicy',
    'run.services.setIamPolicy',
    'run.jobs.create',
    'run.jobs.get',
    'run.jobs.update',
    'run.operations.get',
    'resourcemanager.projects.getIamPolicy',
    'artifactregistry.repositories.get',
    'artifactregistry.repositories.update',
];

export const CUSTOM_ROLES: readonly CustomRoleEntry[] = [
    {
        id: VERTEX_DRAFTS_ROLE_ID,
        spec: {
            title: 'Historic City Map: Vertex AI drafts',
            description: 'generateContent and countTokens of the pinned Gemini model, for the RO-EN translation drafts',
            includedPermissions: VERTEX_DRAFTS_PERMISSIONS,
        },
    },
    {
        id: INSTALLER_ROLE_ID,
        spec: {
            title: 'Historic City Map: in-app installer',
            description:
                'Cloud Run invokers and jobs, the project policy read, the pipeline repository: what hcm-installer needs beyond its roles',
            includedPermissions: INSTALLER_PERMISSIONS,
        },
    },
];
/**
 * M6 (finding 17 of `docs/research/manual-test-2026-10-25.md`): Eventarc delivers the Firestore, Storage and Pub/Sub
 * events with the function's own account, Cloud Scheduler calls `ops.tick` and `imagery.tick` with an OIDC token of
 * theirs and a task queue's tasks carry the enqueuer's: each needs `run.routes.invoke`. Project-wide, as granted by hand
 * on 2026-10-25 (both accounts only ever call this project's functions; per service is §67b).
 */
const INVOKER_ROLE = 'roles/run.invoker';
const FCM_SENDER_ROLE = 'roles/firebasecloudmessaging.admin';
const FN_ADMIN_PROJECT_ROLES = [
    'roles/datastore.user',
    'roles/firebaseauth.admin',
    'roles/firebase.viewer',
    'roles/errorreporting.viewer',
    'roles/cloudtasks.enqueuer',
    FCM_SENDER_ROLE,
    INVOKER_ROLE,
];
/**
 * M3: the dispatcher starts and follows the raster job's executions (`run.jobs.runWithOverrides`, `run.executions.get`).
 * M4: `notify.onEvent` pushes the notifications through FCM.
 */
const FN_EVENTS_PROJECT_ROLES = [
    'roles/datastore.user',
    'roles/eventarc.eventReceiver',
    'roles/cloudtasks.enqueuer',
    'roles/run.jobsExecutorWithOverrides',
    'roles/run.viewer',
    FCM_SENDER_ROLE,
    INVOKER_ROLE,
];
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
/**
 * M6 (`docs/research/M6-interfaces.md` §1.2): the in-app installer's builds (`hcm-installer@`), project-wide; the custom
 * role `hcmInstaller`, the repository's writer role and the accounts it deploys as are bound apart.
 */
const INSTALLER_PROJECT_ROLES = [
    'roles/cloudfunctions.developer',
    'roles/firebaserules.admin',
    'roles/datastore.indexAdmin',
    'roles/cloudscheduler.admin',
    'roles/cloudtasks.queueAdmin',
    'roles/serviceusage.serviceUsageConsumer',
    'roles/firebase.viewer',
    'roles/firebasehosting.admin',
    // A build that runs as a user-specified account writes its log to Cloud Logging only.
    'roles/logging.logWriter',
];
const FN_ADMIN_SECRET_ROLES = [
    'roles/secretmanager.secretAccessor',
    'roles/secretmanager.secretVersionAdder',
    'roles/secretmanager.secretVersionManager',
];

/**
 * What a first functions deploy wants of the service agents (firebase-tools' `ensureServiceAgentRoles`): the Pub/Sub
 * agent may mint tokens, the compute default account may invoke and receive events. Bound here, so the installer, which
 * reads the project's policy but may not write it, finds them in place (M6-interfaces §1.2).
 */
function firstDeployBindings(agents: ServiceAgents): WantedBinding[] {
    const compute =
        agents.computeDefault === undefined
            ? []
            : grants(`serviceAccount:${agents.computeDefault}`, [INVOKER_ROLE, 'roles/eventarc.eventReceiver']);
    return [...grants(`serviceAccount:${agents.pubsub}`, ['roles/iam.serviceAccountTokenCreator']), ...compute];
}

/** The project's bindings; the compute default account's builder role only when the organisation withholds it. */
function projectBindings(project: ProjectConfig, agents: ServiceAgents, noDefaultGrants: boolean): PolicyBindings {
    const names = projectNames(project);
    const compute = `serviceAccount:${project.projectNumber}-compute@developer.gserviceaccount.com`;
    return {
        kind: 'project',
        resource: project.projectId,
        bindings: [
            ...grants(names.member('fn-admin'), [...FN_ADMIN_PROJECT_ROLES, customRoleName(project.projectId, VERTEX_DRAFTS_ROLE_ID)]),
            ...grants(names.member('fn-events'), FN_EVENTS_PROJECT_ROLES),
            ...grants(names.member('job-raster'), ['roles/datastore.user']),
            ...grants(names.member('gh-deployer'), DEPLOYER_PROJECT_ROLES),
            ...grants(names.member(INSTALLER_ACCOUNT), [...INSTALLER_PROJECT_ROLES, customRoleName(project.projectId, INSTALLER_ROLE_ID)]),
            ...grants(`serviceAccount:${agents.firebaseStorage}`, ['roles/firebaserules.firestoreServiceAgent']),
            ...grants(`serviceAccount:${agents.cloudStorage}`, ['roles/pubsub.publisher']),
            ...firstDeployBindings(agents),
            ...(noDefaultGrants ? grants(compute, ['roles/cloudbuild.builds.builder']) : []),
        ],
    };
}

/** M6 (§1.2): the installer pushes the pipeline's image to the repository `hcm`, and only there. */
function repositoryBindings(project: ProjectConfig): PolicyBindings {
    return {
        kind: 'repository',
        resource: PIPELINE_REPOSITORY,
        bindings: grants(projectNames(project).member(INSTALLER_ACCOUNT), ['roles/artifactregistry.writer']),
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

/** Who reads `secret` besides the admin functions: the event functions, the raster job (USGS only). */
function secretReaders(project: ProjectConfig, secret: SecretId): WantedBinding[] {
    const names = projectNames(project);
    const readers = [
        ...(EVENTS_SECRETS.includes(secret) ? [names.member('fn-events')] : []),
        ...(RASTER_SECRETS.includes(secret) ? [names.member('job-raster')] : []),
    ];
    return readers.flatMap((member) => grants(member, ['roles/secretmanager.secretAccessor']));
}

function secretBindings(project: ProjectConfig): PolicyBindings[] {
    const names = projectNames(project);
    return SECRET_IDS.map((secret) => ({
        kind: 'secret' as const,
        resource: secret,
        bindings: [...grants(names.member('fn-admin'), FN_ADMIN_SECRET_ROLES), ...secretReaders(project, secret)],
    }));
}

/**
 * `iam.serviceAccountUser` on the function accounts: each for itself (Cloud Tasks OIDC), the deployer for all of them.
 * `fn-crash@` runs the public crash endpoint and holds no role anywhere (`DECISIONS-for-review.md` §42f): only the
 * deployers may act as it, to deploy the function. M6 (§1.2): the in-app installer deploys as each of them too, never
 * project-wide.
 */
function serviceAccountBindings(project: ProjectConfig): PolicyBindings[] {
    const names = projectNames(project);
    const user = (member: string): WantedBinding => ({ role: 'roles/iam.serviceAccountUser', member });
    const deployers = [user(names.member('gh-deployer')), user(names.member(INSTALLER_ACCOUNT))];
    // M5 (CR-M5-8): `export.download` signs its address as `fn-admin` itself (IAM signBlob), which needs this role on itself.
    const signer: WantedBinding = { role: 'roles/iam.serviceAccountTokenCreator', member: names.member('fn-admin') };
    return [
        { kind: 'serviceAccount', resource: names.email('fn-admin'), bindings: [user(names.member('fn-admin')), signer, ...deployers] },
        { kind: 'serviceAccount', resource: names.email('fn-events'), bindings: [user(names.member('fn-events')), ...deployers] },
        { kind: 'serviceAccount', resource: names.email('fn-crash'), bindings: deployers },
        { kind: 'serviceAccount', resource: names.email('job-raster'), bindings: deployers },
    ];
}

/** Every policy the `iam` item keeps (§3.4.1), project first. */
export function roleTable(project: ProjectConfig, agents: ServiceAgents, noDefaultGrants: boolean): PolicyBindings[] {
    return [
        projectBindings(project, agents, noDefaultGrants),
        ...bucketBindings(project),
        ...secretBindings(project),
        ...serviceAccountBindings(project),
        repositoryBindings(project),
    ];
}
