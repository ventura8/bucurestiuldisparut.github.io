import type { Ports } from '../ports/index.js';
import type { SetupRecord } from '../ports/setup-records.js';

/** The admin the trigger already authenticated (triggers/admin-guard.ts). */
export interface Admin {
    readonly uid: string;
}

/** Where a connected service stands: never configured, verified, or rejected on its last check. */
type ServiceState = 'missing' | 'ok' | 'invalid';

interface ServiceStatus {
    readonly state: ServiceState;
    /** ISO 8601 time of the last verification, or null when it was never checked. */
    readonly checkedAt: string | null;
}

/** What the Setup Assistant's health card shows. Only these fields ever leave the function. */
export interface SetupStatus {
    readonly mapbox: ServiceStatus;
    readonly usgs: ServiceStatus;
    /** Bumped whenever a secret changes, so every instance drops its cached secrets. */
    readonly secretsRev: number;
    /** True once every service is verified. */
    readonly ready: boolean;
    readonly generatedAt: string;
}

export type SetupStatusDeps = Pick<Ports, 'setup' | 'clock' | 'log'>;

const STATES: readonly ServiceState[] = ['missing', 'ok', 'invalid'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A Firestore Timestamp, as far as this handler cares. */
function hasToDate(value: unknown): value is { readonly toDate: () => unknown } {
    return isRecord(value) && typeof value['toDate'] === 'function';
}

/** Firestore Timestamps (via toDate()) and valid Dates become ISO 8601; anything else is not a time. */
function toIsoTime(value: unknown): string | null {
    const date = hasToDate(value) ? value.toDate() : value;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function toServiceStatus(value: unknown): ServiceStatus {
    if (!isRecord(value)) {
        return { state: 'missing', checkedAt: null };
    }
    const state = STATES.find((candidate) => candidate === value['state']) ?? 'missing';
    return { state, checkedAt: toIsoTime(value['checkedAt']) };
}

function toRevision(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Projects the stored record onto the public shape field by field: an unknown or malformed field
 * falls back to its default, and anything not listed here (even a secret written there by mistake)
 * is never returned.
 */
export function toSetupStatus(record: SetupRecord, now: Date): SetupStatus {
    const mapbox = toServiceStatus(record['mapbox']);
    const usgs = toServiceStatus(record['usgs']);
    return {
        mapbox,
        usgs,
        secretsRev: toRevision(record['secretsRev']),
        ready: mapbox.state === 'ok' && usgs.state === 'ok',
        generatedAt: now.toISOString(),
    };
}

/** `setup.status`: the non-secret setup health for the Setup Assistant (the trigger admits admins only). */
export async function setupStatus(deps: SetupStatusDeps, admin: Admin): Promise<SetupStatus> {
    const status = toSetupStatus((await deps.setup.readStatus()) ?? {}, deps.clock.now());
    deps.log.info('setup status read', { uid: admin.uid, ready: status.ready });
    return status;
}
