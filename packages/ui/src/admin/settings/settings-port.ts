/**
 * What `<hcm-settings-page>` reads of the settings area (`packages/admin/src/settings/settings.ts`), mirrored
 * structurally (`docs/research/M2c-interfaces.md` §2.3); `packages/admin/test/app/admin-port.test.ts` checks that the
 * real store satisfies it.
 */
import type { CityDoc, Locale, OverlayKind, PoiCategoryDoc, ThemeTokens, ValidationIssue } from '@hcm/shared';

import type { DocStatePort, ListStatePort } from '../area-port.js';
import type {
    DraftConflictPort,
    DraftStatePort,
    LayerItemPort,
    MapStatusPort,
    PreviewSinkPort,
    WriteOutcomePort,
} from '../layers/layers-port.js';

export type SettingsSectionPort = 'area' | 'texts' | 'theme' | 'imagery' | 'categories' | 'overlays';

export type AreaNumberFieldPort = 'west' | 'south' | 'east' | 'north' | 'lat' | 'lng' | 'zoom' | 'minZoom' | 'maxZoom';

export type BasemapChoicePort = 'standard' | 'standard-satellite';

export interface OutsidePort {
    readonly kind: 'photo' | 'poi';
    readonly id: string;
    readonly title: string;
}

interface ThemeDraftPort {
    readonly typed: string;
    readonly invalid: boolean;
    readonly adjusted: boolean;
    readonly preview: ThemeTokens | null;
}

interface Lines {
    readonly ro: readonly number[];
    readonly en: readonly number[];
}

interface CitySectionPort {
    readonly section: 'area' | 'texts' | 'theme' | 'imagery' | null;
    readonly draft: DraftStatePort<CityDoc>;
    readonly outside: readonly OutsidePort[];
    readonly checking: boolean;
    readonly theme: ThemeDraftPort;
    readonly linkLines: { readonly about: Lines; readonly privacy: Lines };
}

export interface CategoryItemPort {
    readonly id: string;
    readonly label: PoiCategoryDoc['label'];
    readonly icon: string;
    readonly bundled: boolean;
    readonly color: string;
    readonly defaultOpacity: number;
    readonly order: number;
    readonly version: string;
}

/** A category's editable value (a new category has no stamp yet). */
export type CategoryValuePort = Pick<PoiCategoryDoc, 'label' | 'icon' | 'color' | 'defaultOpacity' | 'order'>;

export interface CategoryEditorPort {
    readonly id: string;
    readonly isNew: boolean;
    readonly notFound: boolean;
    readonly value: CategoryValuePort | null;
    readonly dirty: boolean;
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: DraftConflictPort | null;
    readonly gone: boolean;
    readonly proposedColor: string | null;
}

export type CategoryDeletionPort =
    | { readonly phase: 'idle' }
    | {
          readonly phase: 'counting' | 'confirm' | 'running';
          readonly id: string;
          readonly label: string;
          readonly inUse: number | null;
          readonly target: string | null;
      };

interface OverlayRowPort {
    readonly id: string;
    readonly kind: OverlayKind;
    readonly label: { readonly ro: string; readonly en?: string | undefined };
    readonly visible: boolean;
    readonly opacity: number;
    readonly toggleable: boolean;
    readonly color?: string;
    readonly icon?: string;
}

export interface SettingsViewState {
    readonly section: SettingsSectionPort | null;
    readonly city: DocStatePort<CityDoc>;
    readonly citySection: CitySectionPort;
    readonly layers: ListStatePort<LayerItemPort>;
    readonly categories: ListStatePort<CategoryItemPort>;
    readonly canAddCategory: boolean;
    readonly category: CategoryEditorPort | null;
    readonly categoryDeletion: CategoryDeletionPort;
    readonly overlays: { readonly rows: readonly OverlayRowPort[]; readonly changes: number; readonly saving: boolean };
    readonly reordering: boolean;
    /** The page's map (area and overlays): its state, and where a rectangle being drawn is. */
    readonly map: { readonly status: MapStatusPort; readonly drawing: 'first' | 'second' | null };
}

export interface SettingsIntentsPort {
    retry(): void;
    editCity(patch: Partial<CityDoc>): void;
    setNumber(field: AreaNumberFieldPort, text: string): void;
    setText(field: 'name' | 'about' | 'privacy', locale: Locale, text: string): void;
    addCredit(): void;
    removeCredit(row: number): void;
    moveCredit(row: number, by: -1 | 1): void;
    editCredit(row: number, field: 'ro' | 'en' | 'url', text: string): void;
    useView(view: { readonly center: readonly [number, number]; readonly zoom: number }): void;
    setSeed(typed: string): void;
    setBasemap(choice: BasemapChoicePort): void;
    saveSection(): Promise<WriteOutcomePort | null>;
    discardSection(): void;
    keepMine(): void;
    takeTheirs(): void;
    moveCategory(id: string, direction: 'up' | 'down'): Promise<WriteOutcomePort | null>;
    moveCategoryTo(id: string, index: number): Promise<WriteOutcomePort | null>;
    editCategory(patch: Partial<Pick<PoiCategoryDoc, 'label' | 'icon' | 'color' | 'defaultOpacity'>>): void;
    setCategoryLabel(locale: Locale, text: string): void;
    setCategoryOpacity(percent: number): void;
    useProposedColor(): void;
    saveCategory(): Promise<string | null>;
    discardCategory(): void;
    askDeleteCategory(): Promise<void>;
    setDeleteTarget(target: string | null): void;
    cancelDeleteCategory(): void;
    confirmDeleteCategory(): Promise<boolean>;
    setOverlayOpacity(kind: OverlayKind, id: string, percent: number): void;
    setShownAtStart(id: string, visible: boolean): void;
    saveOverlays(): Promise<WriteOutcomePort | null>;
    discardOverlays(): void;
    attachPreview(sink: PreviewSinkPort | null): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    drawBounds(): void;
    useMapView(): void;
}
