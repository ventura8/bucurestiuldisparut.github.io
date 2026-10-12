import { isGoogleFailure } from './failure.js';
import { at, records, strings } from './json.js';

/**
 * IAM policies of every resource the provisioner binds roles on (the project, buckets, secrets, service accounts, the
 * budget topic; `docs/research/M2b-interfaces.md` §3.4.1): read, merge the missing bindings in, write back with the
 * etag read, and on a concurrent change (Resource Manager's 409 `ABORTED`, Cloud Storage's 412) read and merge again,
 * at most three times. Conditional bindings are never touched: a wanted binding counts only unconditionally.
 */

interface Binding {
    readonly role: string;
    readonly members: readonly string[];
    /** An IAM condition, kept as read. */
    readonly condition?: unknown;
}

export interface Policy {
    readonly version: number;
    readonly etag?: string;
    readonly bindings: readonly Binding[];
}

/** One role for one member (`serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com`). */
export interface WantedBinding {
    readonly role: string;
    readonly member: string;
}

/** How to read and write one resource's policy. */
export interface PolicyAccess {
    read(): Promise<Policy>;
    write(policy: Policy): Promise<unknown>;
}

export const POLICY_WRITE_ATTEMPTS = 3;

/** A policy as Google answered it (anything unreadable is an empty version-1 policy). */
export function parsePolicy(body: unknown): Policy {
    const version = at(body, 'version');
    const etag = at(body, 'etag');
    const bindings = records(at(body, 'bindings')).map((binding) => ({
        role: String(binding['role']),
        members: strings(binding['members']),
        ...(binding['condition'] === undefined ? {} : { condition: binding['condition'] }),
    }));
    return { version: typeof version === 'number' ? version : 1, ...(typeof etag === 'string' ? { etag } : {}), bindings };
}

function holds(policy: Policy, wanted: WantedBinding): boolean {
    return policy.bindings.some(
        (binding) => binding.condition === undefined && binding.role === wanted.role && binding.members.includes(wanted.member),
    );
}

/** The wanted bindings the policy lacks. */
export function missingBindings(policy: Policy, wanted: readonly WantedBinding[]): WantedBinding[] {
    return wanted.filter((binding) => !holds(policy, binding));
}

function addOne(bindings: readonly Binding[], wanted: WantedBinding): Binding[] {
    const index = bindings.findIndex((binding) => binding.condition === undefined && binding.role === wanted.role);
    const existing = bindings[index];
    if (existing === undefined) {
        return [...bindings, { role: wanted.role, members: [wanted.member] }];
    }
    const updated = { ...existing, members: [...existing.members, wanted.member] };
    return bindings.map((binding, position) => (position === index ? updated : binding));
}

/** The policy with every missing wanted binding added (the etag kept, so the write is conditional). */
export function withBindings(policy: Policy, wanted: readonly WantedBinding[]): Policy {
    return { ...policy, bindings: missingBindings(policy, wanted).reduce(addOne, policy.bindings) };
}

/**
 * Adds the missing bindings; resolves to how many were added (0: nothing written). A concurrent change makes it read
 * and merge again, up to {@link POLICY_WRITE_ATTEMPTS} writes; any other failure is thrown.
 */
export async function ensureBindings(access: PolicyAccess, wanted: readonly WantedBinding[]): Promise<number> {
    for (let attempt = 1; ; attempt += 1) {
        const policy = await access.read();
        const missing = missingBindings(policy, wanted);
        if (missing.length === 0 || (await written(access, withBindings(policy, missing), attempt))) {
            return missing.length;
        }
    }
}

/** Writes the policy: true when written, false after a concurrent change that may be merged again; throws otherwise. */
async function written(access: PolicyAccess, policy: Policy, attempt: number): Promise<boolean> {
    try {
        await access.write(policy);
        return true;
    } catch (error) {
        if (attempt >= POLICY_WRITE_ATTEMPTS || !isGoogleFailure(error, 'conflict')) {
            throw error;
        }
        return false;
    }
}
