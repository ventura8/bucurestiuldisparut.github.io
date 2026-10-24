/**
 * The dashboard as its page reads it (`#/home`), mirroring `packages/admin/src/home/home.ts` (checked at compile time by
 * `packages/admin/test/app/admin-port.test.ts`).
 */
import type { ValidationCode } from '@hcm/shared';

import type { AdminNoticeInputPort } from '../notice-port.js';
import type { DocStatePort, LoadStatusPort } from '../area-port.js';

export type HomeCountPort =
    | 'photos'
    | 'pois'
    | 'categories'
    | 'layers'
    | 'rightsReviews'
    | 'unpublishedPhotos'
    | 'activeJobs'
    | 'failedJobs'
    | 'versionsToApprove'
    | 'versionsNeedingPoints';

type SetupAreaPort = 'billing' | 'provision' | 'mapbox' | 'usgs' | 'analytics' | 'crash';

type ServiceStatePort = 'missing' | 'pending' | 'ok' | 'invalid' | 'unavailable';

export interface HealthChipPort {
    readonly area: SetupAreaPort;
    readonly state: ServiceStatePort;
    readonly detail: AdminNoticeInputPort | null;
}

/** A document the public map left out: what it is, its id, its first issue (a validation code at a path). */
export interface SkippedDocumentPort {
    readonly entity: 'layer' | 'photo' | 'poi' | 'poiCategory';
    readonly id: string;
    readonly code: ValidationCode;
    readonly path: string;
}

export interface PublicMapPort {
    readonly status: 'idle' | 'queued' | 'building' | 'failed';
    readonly builtAt: string | null;
    readonly skipped: readonly SkippedDocumentPort[];
    readonly error: AdminNoticeInputPort | null;
}

export interface HomeViewState {
    readonly countsStatus: LoadStatusPort;
    readonly counts: Readonly<Record<HomeCountPort, number | null>> | null;
    readonly health: { readonly status: LoadStatusPort; readonly chips: readonly HealthChipPort[]; readonly reconnecting: boolean };
    readonly publicMap: DocStatePort<PublicMapPort>;
}

export interface HomeIntentsPort {
    refresh(): Promise<void>;
    retry(): void;
}
