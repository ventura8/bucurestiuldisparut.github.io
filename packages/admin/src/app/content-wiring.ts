/**
 * The services the editor areas bring for each other (`docs/research/M2c-interfaces.md` §2.2, §11.2): the photos'
 * resumable uploads, the pois' map factory. Each owner declares its member inside its own section of
 * `../content/services.ts` and builds it inside the same section here, from the entry's browser parts and Firebase
 * handles; nobody edits another's section or moves the markers.
 */
import { createLogger } from '@hcm/shared';

import type { AreaServiceParts } from '../content/services.js';
import { documentsPort } from '../firebase/adapters.js';
import type { FirebaseHandles } from '../firebase/app.js';
import { firebaseSdk } from '../firebase/sdk.js';
import { firebaseUploads, UPLOAD_SDK } from '../firebase/uploads.js';
import { adminMapFactoryOf } from '../map/wiring.js';

/** What the areas' services are built from. */
export interface AreaServiceSources {
    readonly handles: FirebaseHandles;
    /** The page's `fetch`. */
    readonly fetch: typeof fetch;
}

export function areaServices(sources: AreaServiceSources): AreaServiceParts {
    return {
        // [section photos] owner: photos
        uploads: firebaseUploads(UPLOAD_SDK, sources.handles.storage),
        // [end photos]
        // [section pois] owner: pois
        maps: adminMapFactoryOf({
            scope: globalThis,
            readDoc: (path) => documentsPort(firebaseSdk, sources.handles).get(path),
            terraDraw: null,
            log: createLogger('admin-map'),
        }),
        // [end pois]
    };
}
