import { httpsOriginSchema } from '@hcm/shared';
import { z } from 'zod';

import { serviceAccountEmail } from '../google/iam.js';

/**
 * `infra/project.json` (`docs/research/M2b-interfaces.md` §3.7): the committed, public facts of the Google Cloud project
 * the admin provisions (ids, region, the cities, the viewer's origins, and the GitHub repository whose `master` deploys
 * through Workload Identity Federation). Bundled into the admin build; the provisioner refuses to run when its
 * `projectId` is not the web configuration's. The numeric GitHub ids are what `gh api users/<owner> --jq .id` and
 * `gh api repos/<owner>/<repo> --jq .id` print.
 */

const ID = /^[a-z][a-z0-9-]{4,29}$/;

const projectConfigSchema = z.strictObject({
    projectId: z.string().regex(ID),
    projectNumber: z.string().regex(/^\d{6,20}$/),
    region: z.string().regex(/^[a-z]+-[a-z]+\d$/),
    cities: z
        .array(z.string().regex(/^[a-z0-9-]{2,32}$/))
        .min(1)
        .max(20),
    viewerOrigins: z.array(httpsOriginSchema).min(1).max(10),
    github: z.strictObject({
        owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
        ownerId: z.number().int().positive(),
        repo: z.string().regex(/^[\w.-]{1,100}$/),
        repoId: z.number().int().positive(),
        branch: z.string().regex(/^[\w./-]{1,100}$/),
        environment: z.string().regex(/^[\w-]{1,100}$/),
    }),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** The configuration, or undefined when the file is not one. */
export function parseProjectConfig(value: unknown): ProjectConfig | undefined {
    const parsed = projectConfigSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

/** The service accounts the provisioner creates (security review §1.1), with their display names. */
export const SERVICE_ACCOUNTS = {
    'fn-admin': 'Functions: admin, setup, telemetry, ops',
    'fn-events': 'Functions: events (history, publish, photos)',
    'fn-crash': 'Functions: the public crash endpoint (no role)',
    'job-raster': 'Cloud Run Job: raster pipeline',
    'gh-deployer': 'GitHub Actions deploy (Workload Identity)',
} as const;

export type ServiceAccountId = keyof typeof SERVICE_ACCOUNTS;

export const SERVICE_ACCOUNT_IDS = Object.keys(SERVICE_ACCOUNTS) as readonly ServiceAccountId[];

/** The names every item derives from the configuration. */
export interface ProjectNames {
    readonly privateBucket: string;
    readonly publicBucket: string;
    /** The admin's Hosting origins (`https://<projectId>.web.app`, `https://<projectId>.firebaseapp.com`). */
    readonly adminOrigins: readonly string[];
    /** `serviceAccount:<id>@<projectId>.iam.gserviceaccount.com` */
    member(account: ServiceAccountId): string;
    email(account: ServiceAccountId): string;
}

export function projectNames(project: ProjectConfig): ProjectNames {
    const email = (account: ServiceAccountId): string => serviceAccountEmail(account, project.projectId);
    return {
        privateBucket: `${project.projectId}.firebasestorage.app`,
        publicBucket: `${project.projectId}-public`,
        adminOrigins: [`https://${project.projectId}.web.app`, `https://${project.projectId}.firebaseapp.com`],
        member: (account) => `serviceAccount:${email(account)}`,
        email,
    };
}
