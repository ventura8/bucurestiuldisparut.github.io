import { FIXTURE_VALUES, fixtureResponse } from '../api-fixtures/index.js';
import type { Route, RouteParams } from './routes.js';

/**
 * The state of the fake Mapbox (mapbox.ts, mapbox-tilesets.ts): accounts with a plan, their tokens, tileset sources,
 * tilesets and publish jobs, and the token check every Mapbox API makes.
 */

/** The scenario tokens (each passes `classifyMapboxToken` as the kind it names). */
export const MAPBOX_TOKENS = {
    /** `e2e-mapbox`, a paid account; every bootstrap scope. */
    bootstrap: 'sk.e2e-bootstrap-all-scopes',
    /** `e2e-mapbox`; lacks `tilesets:write` and `tokens:write` (S-A06-BAD-MISSING-SCOPES). */
    missingScopes: 'sk.e2e-bootstrap-missing-scopes',
    /** `e2e-mapbox-trial`, a demo account: Mapbox refuses to create tokens (S-A05-BAD-TRIAL). */
    trial: 'sk.e2e-bootstrap-trial-account',
    /** `e2e-mapbox-billing`, blocked on "confirm billing information" (S-A05-BAD-MISSING-BILLING-ADDRESS). */
    billingPending: 'sk.e2e-bootstrap-billing-pending',
    /** Unknown to the fake: revoked (S-A06-BAD-REVOKED). */
    revoked: 'sk.e2e-bootstrap-revoked',
    /** `e2e-mapbox`'s default public token (a `pk` pasted by mistake: S-A06-BAD-PUBLIC-TOKEN-PASTED). */
    defaultPublic: 'pk.e2e-default-public-token',
} as const;

export type MapboxPlan = 'paid' | 'demo' | 'billing-pending';

export interface MapboxToken {
    readonly id: string;
    usage: 'pk' | 'sk';
    note: string;
    scopes: readonly string[];
    allowedUrls: readonly string[] | undefined;
    readonly value: string;
    readonly isDefault: boolean;
}

interface MapboxTileset {
    readonly id: string;
    readonly name: string;
    readonly recipe: unknown;
}

export interface MapboxJob {
    readonly id: string;
    readonly tilesetId: string;
    stage: 'queued' | 'processing' | 'success' | 'failed';
}

interface MapboxAccount {
    plan: MapboxPlan;
    readonly tokens: MapboxToken[];
    readonly sources: Set<string>;
    readonly tilesets: Map<string, MapboxTileset>;
    readonly jobs: Map<string, MapboxJob>;
}

export interface MapboxState {
    /** Username → account. */
    readonly accounts: Map<string, MapboxAccount>;
    /** How a publish job ends once polled past `processing`. */
    jobOutcome: 'success' | 'failed';
}

/** What Mapbox lets a public token hold; any other scope makes a token secret. */
export const PUBLIC_SCOPES: readonly string[] = ['styles:tiles', 'styles:read', 'fonts:read', 'datasets:read', 'vision:read'];
const BOOTSTRAP_SCOPES = [
    'styles:read',
    'styles:tiles',
    'fonts:read',
    'tilesets:read',
    'tilesets:write',
    'tilesets:list',
    'tokens:read',
    'tokens:write',
];

function account(plan: MapboxPlan, tokens: MapboxToken[]): MapboxAccount {
    return { plan, tokens, sources: new Set(), tilesets: new Map(), jobs: new Map() };
}

function secret(id: string, value: string, scopes: readonly string[]): MapboxToken {
    return { id, usage: 'sk', note: 'historic-map-server', scopes, allowedUrls: undefined, value, isDefault: false };
}

export function defaultMapboxState(): MapboxState {
    const defaultPublic: MapboxToken = {
        id: 'cle2e0000default0000000001',
        usage: 'pk',
        note: 'Default public token',
        scopes: PUBLIC_SCOPES,
        allowedUrls: undefined,
        value: MAPBOX_TOKENS.defaultPublic,
        isDefault: true,
    };
    const missing = BOOTSTRAP_SCOPES.filter((scope) => scope !== 'tilesets:write' && scope !== 'tokens:write');
    return {
        accounts: new Map([
            [
                String(FIXTURE_VALUES['mapboxUser']),
                account('paid', [
                    defaultPublic,
                    secret(String(FIXTURE_VALUES['tokenId']), MAPBOX_TOKENS.bootstrap, BOOTSTRAP_SCOPES),
                    secret('cle2e00token00000000000002', MAPBOX_TOKENS.missingScopes, missing),
                ]),
            ],
            ['e2e-mapbox-trial', account('demo', [secret('cle2e00token00000000000003', MAPBOX_TOKENS.trial, BOOTSTRAP_SCOPES)])],
            [
                'e2e-mapbox-billing',
                account('billing-pending', [secret('cle2e00token00000000000004', MAPBOX_TOKENS.billingPending, BOOTSTRAP_SCOPES)]),
            ],
        ]),
        jobOutcome: 'success',
    };
}

/** A token's owner and record, or undefined for a token the fake does not know. */
export function findToken(state: MapboxState, value: string | null): { readonly user: string; readonly token: MapboxToken } | undefined {
    for (const [user, candidate] of state.accounts) {
        const token = candidate.tokens.find((item) => item.value === value);
        if (token !== undefined) {
            return { user, token };
        }
    }
    return undefined;
}

export type MapboxAnswer = (request: Parameters<Route['answer']>[0], params: RouteParams, owner: MapboxAccount) => Response;

/**
 * Wraps a route of `user`'s resources: the `access_token` must be a token of that user (else 401, or 403 for another
 * user's token) holding `scope` (else 403).
 */
export function mapboxAuthorized(
    state: MapboxState,
    scope: string,
    answer: MapboxAnswer,
    userOf = (params: RouteParams): string => String(params['user']),
): Route['answer'] {
    return (request, params) => {
        const found = findToken(state, request.url.searchParams.get('access_token'));
        if (found === undefined) {
            return fixtureResponse('mapbox/error.unauthorized');
        }
        const owner = state.accounts.get(found.user);
        if (owner === undefined || found.user !== userOf(params) || !found.token.scopes.includes(scope)) {
            return fixtureResponse('mapbox/error.forbidden');
        }
        return answer(request, params, owner);
    };
}
