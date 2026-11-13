/** The POI categories' documents for the rules tests: a seeded category, a new one, and the editor's update (M27's fields included). */
import { past, serverTime, stampedBy, systemStamp, type Data } from './world.js';

export function poiCategoryDoc(): Data {
    return {
        label: { ro: 'Clădiri', en: 'Buildings' },
        icon: 'church',
        color: '#875329',
        defaultOpacity: 0.8,
        order: 1,
        defaultVisible: true,
        pinned: false,
        attribution: 'OpenHistoricalMap (CC0)',
        createdAt: past(),
        ...systemStamp('bootstrap'),
    };
}

export function newPoiCategory(uid: string): Data {
    return {
        label: { ro: 'Străzi dispărute' },
        icon: 'add_road',
        color: '#3366AA',
        defaultOpacity: 1,
        order: 2,
        defaultVisible: true,
        pinned: true,
        attribution: 'OpenHistoricalMap (CC0)',
        createdAt: serverTime(),
        ...stampedBy(uid),
    };
}

/** One valid new value for every field a client may update on a category (the stamp aside). */
export const POI_CATEGORY_EDITS: Readonly<Data> = {
    label: { ro: 'Biserici', en: 'Churches' },
    icon: 'mosque',
    color: '#aa00ff',
    defaultOpacity: 0,
    order: -1,
    defaultVisible: false,
    pinned: true,
    attribution: 'OpenStreetMap (ODbL)',
};
