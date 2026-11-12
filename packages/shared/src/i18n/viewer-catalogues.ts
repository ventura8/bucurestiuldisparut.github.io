import { ar } from './ar.js';
import { de } from './de.js';
import { en } from './en.js';
import { es } from './es.js';
import { fr } from './fr.js';
import { hi } from './hi.js';
import { it } from './it.js';
import { ja } from './ja.js';
import { ko } from './ko.js';
import { pl } from './pl.js';
import { pt } from './pt.js';
import { ro } from './ro.js';
import { ru } from './ru.js';
import { tr } from './tr.js';
import { uk } from './uk.js';
import { zh } from './zh.js';
import type { ViewerLocale } from './index.js';
import { ar as arLabels } from './map-labels/ar.js';
import { de as deLabels } from './map-labels/de.js';
import { en as enLabels } from './map-labels/en.js';
import { es as esLabels } from './map-labels/es.js';
import { fr as frLabels } from './map-labels/fr.js';
import { hi as hiLabels } from './map-labels/hi.js';
import { it as itLabels } from './map-labels/it.js';
import { ja as jaLabels } from './map-labels/ja.js';
import { ko as koLabels } from './map-labels/ko.js';
import { pl as plLabels } from './map-labels/pl.js';
import { pt as ptLabels } from './map-labels/pt.js';
import { ro as roLabels } from './map-labels/ro.js';
import { ru as ruLabels } from './map-labels/ru.js';
import { tr as trLabels } from './map-labels/tr.js';
import { uk as ukLabels } from './map-labels/uk.js';
import { zh as zhLabels } from './map-labels/zh.js';

/**
 * Every viewer language's texts, the main catalogue and the map labels' family in one object: what the engine's build
 * writes to `i18n/<locale>.json` (`scripts/site/src/i18n-catalogues.ts`) and what the tests register. Never imported by
 * the engine itself, which fetches each language when it is first shown (docs/ENGINE_API.md → Language).
 */
export const VIEWER_CATALOGUES: Readonly<Record<ViewerLocale, Readonly<Record<string, string>>>> = {
    ro: { ...ro, ...roLabels },
    en: { ...en, ...enLabels },
    es: { ...es, ...esLabels },
    fr: { ...fr, ...frLabels },
    de: { ...de, ...deLabels },
    it: { ...it, ...itLabels },
    pt: { ...pt, ...ptLabels },
    ru: { ...ru, ...ruLabels },
    uk: { ...uk, ...ukLabels },
    pl: { ...pl, ...plLabels },
    tr: { ...tr, ...trLabels },
    ar: { ...ar, ...arLabels },
    hi: { ...hi, ...hiLabels },
    zh: { ...zh, ...zhLabels },
    ja: { ...ja, ...jaLabels },
    ko: { ...ko, ...koLabels },
};
