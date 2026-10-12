import { runAs } from '../global-options.js';

import { onObjectFinalized, type StorageEvent } from 'firebase-functions/storage';
import type { CloudFunction } from 'firebase-functions/v2';

import { processPhotoUpload, type PhotoDeps } from './upload.js';

/**
 * `photos-onUpload`: Storage finalize on the private bucket (the project's default bucket unless `bucket` names one;
 * firebase-functions reads it from `FIREBASE_CONFIG`). One upload at a time per instance with 2 GiB (sharp decodes up
 * to 200 MP), five instances at most; no automatic retry: a failure is recorded on the photo, and Reprocess retries it.
 */
export function onUploadFunction(getDeps: () => PhotoDeps, bucket?: string): CloudFunction<StorageEvent> {
    const options = {
        memory: '2GiB',
        concurrency: 1,
        maxInstances: 5,
        timeoutSeconds: 300,
        retry: false,
        ...runAs('photos.onUpload'),
    } as const;
    return onObjectFinalized(bucket === undefined ? options : { ...options, bucket }, async (event) => {
        const { name, size, metadata } = event.data;
        await processPhotoUpload(getDeps(), { name, size, metadata: metadata ?? {} });
    });
}
