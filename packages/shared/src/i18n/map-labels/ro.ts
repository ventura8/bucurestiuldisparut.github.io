/**
 * Romanian texts of the Layers panel's Map labels group (docs/ENGINE_API.md → Map labels). A catalogue of its own: only the
 * public viewer imports it, while the admin bundles the viewer's main catalogue and has no use for these. The source of
 * truth for `MapLabelsKey`; `en.ts` is typed against it. One entry per line (scripts/ci/check_i18n.py).
 */
export const ro = {
    'mapLabels.group': 'Etichetele hărții',
    'mapLabels.streets': 'Numele străzilor',
    'mapLabels.pois': 'Puncte de interes',
    'mapLabels.note': 'Texte de pe harta de azi, precum magazine și restaurante.',
    'mapLabels.notePlaces': 'Locurile de mai jos sunt ale acestui site și au comutatoare proprii.',
} as const;

export type MapLabelsKey = keyof typeof ro;
