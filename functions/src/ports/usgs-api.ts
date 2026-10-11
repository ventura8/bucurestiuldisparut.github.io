/** USGS M2M (EarthExplorer machine-to-machine) API. Adapter: M2 (login), M3 (search, downloads). */
export interface UsgsApi {
    /** `login-token`: exchanges the ERS username and application token for a two-hour API key. */
    login(username: string, applicationToken: string): Promise<string>;
}
