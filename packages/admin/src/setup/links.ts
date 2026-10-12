/**
 * The Setup Assistant's verified deep links (`links.json` beside this file, the copy `scripts/ci/check_contracts.py`
 * probes every week). The TypeScript copy below is what the admin bundles; `packages/admin/test/setup/links.test.ts`
 * fails when the two differ. Every link opens in a new tab; following one is not an in-app input (§3.5).
 */
import type { SetupStepId } from './steps.js';

export const SETUP_LINK_URLS = {
    'gcp.firebaseConsole': 'https://console.firebase.google.com/',
    'gcp.billingAccounts': 'https://console.cloud.google.com/billing',
    'gcp.blazeUpgrade': 'https://console.firebase.google.com/project/{projectId}/usage/details',
    'mapbox.signup': 'https://account.mapbox.com/auth/signup/',
    'mapbox.console': 'https://console.mapbox.com/',
    'mapbox.usageThresholds': 'https://console.mapbox.com/account/settings/usage-thresholds',
    'mapbox.accessTokens': 'https://console.mapbox.com/account/access-tokens/',
    'usgs.register': 'https://ers.cr.usgs.gov/register',
    'usgs.accessRequest': 'https://ers.cr.usgs.gov/profile/access',
    'usgs.applicationToken': 'https://ers.cr.usgs.gov/password/appgenerate',
    'usgs.sceneMetadata': 'https://earthexplorer.usgs.gov/scene/metadata/full/{datasetId}/{entityId}/',
} as const;

export type SetupLinkId = keyof typeof SETUP_LINK_URLS;

export interface SetupLinkView {
    readonly id: SetupLinkId;
    readonly url: string;
}

/** The links each card lists, in the order the human follows them (the USGS token page has its own countdown button). */
export const STEP_LINKS: Readonly<Record<SetupStepId, readonly SetupLinkId[]>> = {
    signIn: ['gcp.firebaseConsole'],
    billing: ['gcp.billingAccounts', 'gcp.blazeUpgrade'],
    provision: [],
    deploy: [],
    claim: [],
    mapbox: ['mapbox.signup', 'mapbox.console', 'mapbox.usageThresholds', 'mapbox.accessTokens'],
    usgs: ['usgs.register', 'usgs.accessRequest'],
    analytics: ['gcp.firebaseConsole'],
    legacyImport: [],
};

const PLACEHOLDER = /\{(\w+)\}/g;

/** The link `id` with its `{name}` placeholders filled (URL-encoded); a missing value is a programming error. */
export function setupLink(id: SetupLinkId, params: Readonly<Record<string, string>> = {}): SetupLinkView {
    const url = SETUP_LINK_URLS[id].replace(PLACEHOLDER, (_placeholder: string, name: string) => {
        const value = params[name];
        if (value === undefined) {
            throw new RangeError(`link ${id} needs {${name}}`);
        }
        return encodeURIComponent(value);
    });
    return { id, url };
}

/** The deep links of `step` for the project. */
export function stepLinks(step: SetupStepId, projectId: string): readonly SetupLinkView[] {
    return STEP_LINKS[step].map((id) => setupLink(id, { projectId }));
}
