import { en as imageryEn } from '../admin-imagery/en.js';
import { ro as imageryRo, type AdminImageryKey } from '../admin-imagery/ro.js';
import { en as layersEn } from '../admin-layers/en.js';
import { ro as layersRo, type AdminLayersKey } from '../admin-layers/ro.js';
import { en as opsEn } from '../admin-ops/en.js';
import { ro as opsRo, type AdminOpsKey } from '../admin-ops/ro.js';
import { en as photosEn } from '../admin-photos/en.js';
import { ro as photosRo, type AdminPhotosKey } from '../admin-photos/ro.js';
import { en as poisEn } from '../admin-pois/en.js';
import { ro as poisRo, type AdminPoisKey } from '../admin-pois/ro.js';
import { en as settingsEn } from '../admin-settings/en.js';
import { ro as settingsRo, type AdminSettingsKey } from '../admin-settings/ro.js';
import { catalogueTranslator } from '../catalogue.js';
import { en as kitEn } from './en.js';
import { ro as kitRo, type AdminContentKitKey } from './ro.js';

/** Every text of the admin's editors: the kit's and the map's (this folder) and one catalogue folder per area (CR-M2c-25). */
export type AdminContentKey =
    AdminContentKitKey | AdminPhotosKey | AdminPoisKey | AdminLayersKey | AdminSettingsKey | AdminOpsKey | AdminImageryKey;

export type AdminContentMessages = Readonly<Record<AdminContentKey, string>>;

/**
 * The area catalogues merged per language, in the order of `docs/research/M2c-interfaces.md` §10.1, then M3's imagery
 * (`docs/research/M3-interfaces.md` §10). The areas' key prefixes are disjoint (`packages/shared/test/i18n-admin.test.ts`
 * checks every key against its folder's prefixes), so no spread overrides another area's text.
 */
export const ADMIN_CONTENT_CATALOGUES: Readonly<Record<'ro' | 'en', AdminContentMessages>> = {
    ro: { ...kitRo, ...photosRo, ...poisRo, ...layersRo, ...settingsRo, ...opsRo, ...imageryRo },
    en: { ...kitEn, ...photosEn, ...poisEn, ...layersEn, ...settingsEn, ...opsEn, ...imageryEn },
};

/** The admin editors' texts (`docs/research/M2c-interfaces.md` §10.1). */
export const translateAdminContent = catalogueTranslator<AdminContentKey>(ADMIN_CONTENT_CATALOGUES);
