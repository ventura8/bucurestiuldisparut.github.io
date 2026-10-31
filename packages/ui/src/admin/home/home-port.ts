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

/** M6 setup-ux: what Setup left open (`packages/admin/src/home/reminders.ts`). */
export type HomeReminderPort =
    | { readonly kind: 'usgsLater' }
    | { readonly kind: 'usgsPending'; readonly since: string | null }
    | { readonly kind: 'trial'; readonly endsAt: string; readonly upgradeUrl: string }
    // M6 installer (A55–A57): a stopped installation or an update, with the Setup step whose card acts on it.
    | { readonly kind: 'installUpdate' | 'installFailed'; readonly step: string };

export interface HomeViewState {
    readonly countsStatus: LoadStatusPort;
    readonly counts: Readonly<Record<HomeCountPort, number | null>> | null;
    readonly health: { readonly status: LoadStatusPort; readonly chips: readonly HealthChipPort[]; readonly reconnecting: boolean };
    readonly publicMap: DocStatePort<PublicMapPort>;
    readonly reminders: readonly HomeReminderPort[];
    readonly dismissing: boolean;
}

export interface HomeIntentsPort {
    refresh(): Promise<void>;
    retry(): void;
    /** "It is a paid account" on the free-trial reminder (M6 setup-ux, A60). */
    dismissTrial(): Promise<void>;
}
