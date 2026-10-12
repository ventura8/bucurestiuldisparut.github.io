/** A Firebase web app of the project (`projects/{project}/webApps`). */
interface WebApp {
    readonly appId: string;
    readonly displayName?: string;
    readonly state: 'ACTIVE' | 'DELETED';
}

/** `webApps/{appId}/config`: the public identifiers (never secrets) the viewer's analytics needs. */
interface WebAppConfig {
    readonly projectId: string;
    readonly appId: string;
    readonly apiKey: string;
    /** Present once Google Analytics is linked to the project. */
    readonly measurementId?: string;
}

/**
 * The Firebase Management API v1beta1 over REST (`roles/firebase.viewer` on `fn-admin@`; adapter
 * `functions/src/adapters/firebase-management.ts`, fn-setup). Used by `setup.analyticsConfig` and `setup.selfTest`.
 */
export interface FirebaseManagement {
    listWebApps(projectId: string): Promise<readonly WebApp[]>;
    webAppConfig(projectId: string, appId: string): Promise<WebAppConfig>;
}
