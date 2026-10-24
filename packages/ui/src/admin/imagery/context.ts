/**
 * What the Imagery page's templates share (`docs/research/M3-interfaces.md` §10.2): the language, the area's view and
 * intents, the page's addresses, whether the admin may write, and the page's questions (Reject, Dismiss, Pay, Cancel and
 * Resume processing ask first).
 */
import type { Locale } from '@hcm/shared';

import type { ImageryIntentsPort, ImageryViewState } from './imagery-port.js';

/** The questions the page asks before an action that cannot be taken back or costs money. */
export type ImageryQuestion = 'reject' | 'dismiss' | 'pay' | 'cancel' | 'resume';

export interface ImageryContext {
    readonly locale: Locale;
    readonly view: ImageryViewState;
    readonly intents: ImageryIntentsPort | null;
    /** `#/imagery/<params>`. */
    readonly href: (params: readonly string[]) => string;
    readonly go: (params: readonly string[]) => void;
    /** A revoked admin's page: nothing writes. */
    readonly readOnly: boolean;
    readonly ask: (question: ImageryQuestion) => void;
}
