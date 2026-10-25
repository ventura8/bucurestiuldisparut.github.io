import type { BucketRole } from './blob-store.js';

/** What a signed download address says and how long it works. */
export interface SignedDownload {
    /** The object's path in the bucket (`STORAGE_PATHS.cityExport`). */
    readonly path: string;
    /** When the address stops working. */
    readonly expiresAt: Date;
    /** The file name the browser saves it as (`Content-Disposition: attachment; filename="..."`). */
    readonly fileName: string;
}

/**
 * Short-lived download addresses of private objects (M5, `docs/research/M5-interfaces.md` §5.5): the static export leaves
 * the private bucket only through one. Adapter `functions/src/adapters/url-signer.ts`: Cloud Storage's V4 signing with
 * the runtime account's own `signBlob` in production; in the Functions emulator the e2e stand-in, whose address the mock
 * public-storage host answers from the Storage emulator. The address is a credential for its lifetime: never logged.
 */
export interface UrlSigner {
    signedDownload(bucket: BucketRole, download: SignedDownload): Promise<string>;
}
