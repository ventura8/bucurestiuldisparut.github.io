/**
 * The crash reports area as its page reads it (`docs/research/M2c-interfaces.md` §9.4), mirroring
 * `packages/admin/src/crashes/crashes.ts` (checked at compile time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { ListGroupsResponse } from '@hcm/shared';

import type { AdminNoticeInputPort } from '../notice-port.js';
import type { LoadStatusPort } from '../area-port.js';

export type CrashPeriodPort = 24 | 168 | 720;

export type CrashGroupPort = ListGroupsResponse['groups'][number];

export interface CrashesViewState {
    readonly period: CrashPeriodPort;
    readonly status: LoadStatusPort;
    readonly groups: readonly CrashGroupPort[];
    readonly nextPageToken: string | null;
    readonly loadingMore: boolean;
    readonly failure: AdminNoticeInputPort | null;
    readonly apiDisabled: boolean;
    readonly selected: string | null;
}

export interface CrashesIntentsPort {
    setPeriod(period: CrashPeriodPort): void;
    more(): Promise<void>;
    retry(): void;
    select(groupId: string | null): void;
}
