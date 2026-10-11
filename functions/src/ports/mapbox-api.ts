/** Mapbox account APIs the Setup Assistant and the publisher need (token checks first). Adapter: M2. */
interface MapboxToken {
    readonly user: string;
    readonly scopes: readonly string[];
}

export interface MapboxApi {
    /** Who owns `token` and which scopes it carries; rejects an invalid or revoked token. */
    inspectToken(token: string): Promise<MapboxToken>;
}
