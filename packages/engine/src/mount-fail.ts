/**
 * A viewer that could not boot (docs/ENGINE_API.md → Errors and validation, Language): its error card, worded in the
 * boot's language once that language's texts are here (else in Romanian, else as the engine's own bilingual card), and a
 * controller whose `ready` says why at once.
 */
import { hasCatalogue, type ViewerLocale } from '@hcm/shared';
import type { HcmMapViewer, ViewerController, ViewerError } from '@hcm/ui';

import { firstCatalogue, presentCatalogue, type CatalogueLoader } from './core/catalogues.js';

/** A viewer that could not boot: `ready` says why at once, every call does nothing, `destroy` removes the card. */
function failedController(code: ViewerError['code'], teardown: () => void): ViewerController {
    let removed = false;
    const ignore = (): void => undefined;
    return {
        ready: Promise.resolve({ ok: false, code }),
        setYear: ignore,
        toggleLayer: ignore,
        setOverlayOpacity: ignore,
        openPhoto: ignore,
        openPoi: ignore,
        setLang: ignore,
        openCompare: ignore,
        setComparePosition: ignore,
        closeCompare: ignore,
        setMapLabels: ignore,
        destroy: () => {
            if (!removed) {
                removed = true;
                teardown();
            }
        },
    };
}

/** What a failed boot shows: the error in a language (an invalid configuration's detail is translated), and where. */
export interface BootFailure {
    readonly errorIn: (locale: ViewerLocale) => ViewerError;
    /** The boot's language: the address's, else the configuration's. */
    readonly locale: ViewerLocale;
    /** The languages' texts (none: only the languages the page has, the node tests). */
    readonly catalogues: CatalogueLoader | undefined;
}

/**
 * Shows the error in `viewer`'s card (the card follows the element's `lang`) once the boot language's texts are here, at
 * once when they are, and returns the controller of a viewer that could not boot.
 */
export function failBoot(viewer: HcmMapViewer, failure: BootFailure): ViewerController {
    const { errorIn, locale } = failure;
    const show = (shown: ViewerLocale | null): void => {
        viewer.setAttribute('lang', shown ?? locale);
        viewer.bootError = errorIn(shown ?? locale);
    };
    if (hasCatalogue(locale)) {
        show(locale);
    } else {
        void firstCatalogue(failure.catalogues ?? presentCatalogue, locale).then(show);
    }
    return failedController(errorIn(locale).code, () => {
        viewer.remove();
    });
}
