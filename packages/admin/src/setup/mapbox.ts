/**
 * Step (e), Mapbox (`docs/research/M2b-interfaces.md` §3.3 e; `M2-interfaces.md` §3.3): the owner pastes the secret
 * token and clicks Save (two inputs). The page explains a public (`pk.`) or malformed paste before any call
 * (`classifyMapboxToken`); a secret goes once to `setup.saveMapbox`, which validates it upstream, stores it in Secret
 * Manager and mints the public tokens. The token is a parameter here and nothing more: it never enters the state, a
 * store or a log line, and the paste box clears itself after the call.
 */
import { classifyMapboxToken, type SaveMapboxResponse } from '@hcm/shared';

import type { SetupContext } from './context.js';
import { apiFailure, setupMessage } from './messages.js';

export interface MapboxFlow {
    save(secretToken: string): Promise<void>;
}

class Mapbox implements MapboxFlow {
    constructor(private readonly ctx: SetupContext) {}

    async save(secretToken: string): Promise<void> {
        this.ctx.count('mapbox', 'inputs');
        const kind = classifyMapboxToken(secretToken);
        if (kind !== 'secret') {
            this.ctx.patchStep('mapbox', {
                error: setupMessage(kind === 'public' ? 'apiError.mapbox.publicToken' : 'apiError.mapbox.tokenFormat'),
            });
            return;
        }
        this.ctx.patchStep('mapbox', { busy: true, error: null });
        try {
            const response = await this.ctx.deps.backend.saveMapbox({ cityId: this.ctx.deps.host.cityId, secretToken: secretToken.trim() });
            this.saved(response.mapbox);
        } catch (error) {
            this.ctx.fail('mapbox', apiFailure(error));
        }
    }

    private saved(view: SaveMapboxResponse['mapbox']): void {
        const { state, checkedAt, detail, params, user } = view;
        this.ctx.update((current) => ({ ...current, mapbox: { ...current.mapbox, user: user ?? null } }));
        this.ctx.patchStep('mapbox', { state, checkedAt, busy: false, detail: detail === undefined ? null : setupMessage(detail, params) });
    }
}

export function createMapboxFlow(ctx: SetupContext): MapboxFlow {
    return new Mapbox(ctx);
}
