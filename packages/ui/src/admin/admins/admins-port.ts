/**
 * The admins area as its page reads it (`docs/research/M2c-interfaces.md` §9.1), mirroring
 * `packages/admin/src/admins/admins.ts` (checked at compile time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { AdminsListResponse, InviteResponse, RevokeRequest } from '@hcm/shared';

import type { AdminNoticeInputPort, AdminOutcomePort } from '../notice-port.js';
import type { LoadStatusPort } from '../area-port.js';

export type AdminSelectionPort =
    { readonly kind: 'admin'; readonly uid: string } | { readonly kind: 'invite'; readonly inviteId: string } | null;

export interface AdminsViewState {
    readonly status: LoadStatusPort;
    readonly list: AdminsListResponse | null;
    readonly failure: AdminNoticeInputPort | null;
    readonly selected: AdminSelectionPort;
    readonly invited: InviteResponse | null;
    readonly busy: boolean;
}

export interface AdminsIntentsPort {
    refresh(): Promise<void>;
    invite(email: string): Promise<AdminOutcomePort<InviteResponse>>;
    revoke(request: RevokeRequest): Promise<AdminOutcomePort<{ readonly revoked: true }>>;
    dismissInvited(): void;
}
