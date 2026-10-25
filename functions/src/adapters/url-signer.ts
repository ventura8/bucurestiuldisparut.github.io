import type { BucketRole } from '../ports/blob-store.js';
import type { RuntimeConfig } from '../ports/runtime-config.js';
import type { SignedDownload, UrlSigner } from '../ports/url-signer.js';
import { storageFailure } from './storage.js';

/** What the signer uses of firebase-admin's `Storage` (`getStorage(app)` satisfies it; the tests pass a fake). */
export interface SigningStorage {
    bucket(name: string): {
        file(path: string): {
            getSignedUrl(config: {
                readonly version: 'v4';
                readonly action: 'read';
                readonly expires: Date;
                readonly responseDisposition: string;
            }): Promise<[string]>;
        };
    };
}

/** `attachment; filename="<name>"`: the export's name is `EXPORT_FILE_NAME_PATTERN` (no quote, no path). */
export function attachmentDisposition(fileName: string): string {
    return `attachment; filename="${fileName}"`;
}

/**
 * Cloud Storage's V4 signed GET address (M5, `docs/research/M5-interfaces.md` §5.5): firebase-admin signs with the
 * runtime account's own `signBlob` (`roles/iam.serviceAccountTokenCreator` on itself, a provisioner item), so no key file
 * exists; the address makes the browser save the object under its file name. Failures are `UpstreamError`s whose
 * message never holds the address.
 */
export function createStorageUrlSigner(storage: SigningStorage, buckets: RuntimeConfig['buckets']): UrlSigner {
    return {
        signedDownload: async (bucket: BucketRole, download: SignedDownload) => {
            try {
                const [url] = await storage
                    .bucket(buckets[bucket])
                    .file(download.path)
                    .getSignedUrl({
                        version: 'v4',
                        action: 'read',
                        expires: download.expiresAt,
                        responseDisposition: attachmentDisposition(download.fileName),
                    });
                return url;
            } catch (error) {
                throw storageFailure(error);
            }
        },
    };
}

/** The stand-in's marker in its addresses: the mock public-storage host answers only these (`e2e`, never production). */
export const STAND_IN_SIGNATURE = 'hcm-emulator-stand-in';

/**
 * The Functions emulator's signer (the e2e stand-in): there is no account to sign with, so the address has the shape of a
 * V4 one on `storage.googleapis.com` without a signature; the e2e's mock public-storage host answers it from the Storage
 * emulator with the same disposition, so the browser downloads exactly the object the task wrote.
 */
export function createStandInUrlSigner(buckets: RuntimeConfig['buckets'], now: () => Date): UrlSigner {
    return {
        signedDownload: (bucket: BucketRole, download: SignedDownload) => {
            const seconds = Math.max(1, Math.round((download.expiresAt.getTime() - now().getTime()) / 1000));
            const query = new URLSearchParams({
                'X-Goog-Algorithm': STAND_IN_SIGNATURE,
                'X-Goog-Expires': String(seconds),
                'response-content-disposition': attachmentDisposition(download.fileName),
            });
            const path = download.path.split('/').map(encodeURIComponent).join('/');
            return Promise.resolve(`https://storage.googleapis.com/${buckets[bucket]}/${path}?${query.toString()}`);
        },
    };
}
