/**
 * Romanian texts of the admin's editors (`docs/research/M2c-interfaces.md` §10.1): the editing kit and the admin map's drawing tools.
 * The source of truth for `AdminContentKitKey`; `en.ts` is typed against it. One catalogue folder per area (CR-M2c-25), merged into
 * `translateAdminContent` by `../admin-content/index.ts`, so each area edits its own files; kept apart from the viewer
 * catalogue, so the public viewer never ships admin texts. One entry per line, each within 140 columns
 * (scripts/ci/check_i18n.py); every key carries its section's prefix (`packages/shared/test/i18n-admin.test.ts`).
 * Owner: ops-screens (common), pois (map).
 */
export const ro = {
    // [section common] owner: ops-screens (the editing kit); keys adminContent.common.*
    'adminContent.common.save': 'Salvează',
    'adminContent.common.discard': 'Renunță la modificări',
    'adminContent.common.you': 'tu',
    'adminContent.common.server': 'serverul',
    'adminContent.common.someone': 'alt administrator',
    'adminContent.common.denied': 'Accesul a fost refuzat. Verifică dacă mai ești administrator.',
    'adminContent.common.loadFailed': 'Nu s-a putut citi ({code}). Încearcă din nou.',
    'adminContent.common.reconnecting': 'Se reconectează…',
    'adminContent.common.loading': 'Se încarcă…',
    'adminContent.common.retry': 'Încearcă din nou',
    'adminContent.common.more': 'Arată mai multe',
    'adminContent.common.back': 'Înapoi la listă',
    'adminContent.common.close': 'Închide',
    'adminContent.common.cancel': 'Anulează',
    'adminContent.common.offline': 'Ești offline: nu s-a salvat nimic. Încearcă din nou când revine conexiunea.',
    'adminContent.common.unsavedTitle': 'Renunți la modificări?',
    'adminContent.common.unsavedBody': 'Modificările de aici nu sunt salvate și se pierd dacă pleci.',
    'adminContent.common.keepEditing': 'Continuă editarea',
    // [end common]
    // [section map] owner: pois (the admin map, the drawing toolbar, the vertex list); keys adminContent.map.*
    'adminContent.map.noToken': 'Harta apare după ce configurezi Mapbox.',
    'adminContent.map.noWebgl': 'Browserul nu poate desena harta (lipsește WebGL 2). Câmpurile și lista de puncte funcționează.',
    'adminContent.map.failed': 'Harta nu s-a putut încărca. Câmpurile și lista de puncte funcționează.',
    'adminContent.map.loading': 'Se încarcă harta…',
    'adminContent.map.unavailable': 'Harta nu este disponibilă aici încă: scrie locul în câmpuri.',
    'adminContent.map.openSetup': 'Configurează Mapbox',
    'adminContent.map.label': 'Harta',
    'adminContent.map.zoomIn': 'Mărește harta',
    'adminContent.map.zoomOut': 'Micșorează harta',
    'adminContent.map.crosshair': 'Centrul hărții: săgețile mută harta, Adaugă în centru pune un punct aici.',
    'adminContent.map.toolbar': 'Unelte de desen',
    'adminContent.map.tool.select': 'Selectează și mută',
    'adminContent.map.tool.draw': 'Desenează',
    'adminContent.map.tool.addCentre': 'Adaugă în centru',
    'adminContent.map.tool.deleteVertex': 'Șterge punctul ales',
    'adminContent.map.tool.undoVertex': 'Șterge ultimul punct',
    'adminContent.map.drawHint.point': 'Apasă pe hartă unde este locul.',
    'adminContent.map.drawHint.linestring': 'Apasă pe hartă pentru fiecare punct al liniei; linia apare de la al doilea.',
    'adminContent.map.drawHint.polygon': 'Apasă pe hartă pentru fiecare colț; suprafața apare de la al treilea.',
    'adminContent.map.drawHint.select': 'Trage forma sau punctele ei; mijlocul unei laturi adaugă un punct.',
    'adminContent.map.refused.outside': 'Punctul este în afara orașului.',
    'adminContent.map.refused.self-intersection': 'Laturile suprafeței nu se pot intersecta.',
    'adminContent.map.refused.too-many-vertices': 'O formă are cel mult 500 de puncte.',
    'adminContent.map.refused.too-many-rings': 'O suprafață are cel mult 20 de inele.',
    'adminContent.map.refused.zero-area': 'Suprafața trebuie să aibă o arie.',
    'adminContent.map.vertices': 'Punctele formei',
    'adminContent.map.verticesEmpty': 'Niciun punct încă: desenează pe hartă sau adaugă în centrul ei.',
    'adminContent.map.vertex': 'Punctul {number}',
    'adminContent.map.latitude': 'Latitudine',
    'adminContent.map.longitude': 'Longitudine',
    'adminContent.map.chooseVertex': 'Alege punctul {number}',
    'adminContent.map.moveUp': 'Mută punctul {number} mai sus',
    'adminContent.map.moveDown': 'Mută punctul {number} mai jos',
    'adminContent.map.removeVertex': 'Șterge punctul {number}',
    'adminContent.map.vertexRefused': 'Forma are nevoie de cel puțin {min} puncte.',
    // [end map]
} as const;

export type AdminContentKitKey = keyof typeof ro;
