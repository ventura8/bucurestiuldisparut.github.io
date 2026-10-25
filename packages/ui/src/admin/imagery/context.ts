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
    /** Renders the page again: a chunk it fetched on first need settled (`orders/lazy-card.ts`). */
    readonly refresh: () => void;
    /**
     * The keyboard goes to the open scene's or version's heading once the page has rendered: an action refused while its
     * own control may go with it (I ordered it on a frame scanned meanwhile: the card goes with the order).
     */
    readonly focusDetail: () => void;
}
