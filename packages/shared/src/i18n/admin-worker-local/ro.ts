/**
 * Romanian texts of "Use this computer" (finding 72 of 2026-11-02, `docs/research/M7-local-worker.md` §1.5, §2.7): the
 * starter file for the computer's system, how to open it, the admin's auto-pair ("Connecting this computer…"), Stop using
 * this computer, and the command behind Advanced. A catalogue of its own, in the admin's lazy `worker-local` chunk only.
 * The source of truth for `AdminWorkerLocalKey`; `en.ts` is typed against it. One entry per line (scripts/ci/check_i18n.py).
 */
export const ro = {
    'adminWorkerLocal.intro': 'Rulează procesările pe acest calculator, gratuit: un fișier îl pregătește o dată, apoi lucrează singur.',
    'adminWorkerLocal.os': 'Sistemul acestui calculator',
    'adminWorkerLocal.os.linux': 'Linux',
    'adminWorkerLocal.os.mac': 'macOS',
    'adminWorkerLocal.os.windows': 'Windows',
    'adminWorkerLocal.use': 'Folosește acest calculator',
    'adminWorkerLocal.find': 'E deja pregătit? Caută-l',
    'adminWorkerLocal.looking': 'Se caută lucrătorul acestui calculator…',
    'adminWorkerLocal.saved': 'Browserul te poate întreba dacă păstrezi fișierul: alege Păstrează. E în Descărcări.',
    'adminWorkerLocal.open.linux': 'Apoi rulează-l o dată într-un terminal (un dublu clic doar îl deschide ca text):',
    'adminWorkerLocal.runCommand': 'Comanda care rulează fișierul',
    'adminWorkerLocal.copyRun': 'Copiază rândul',
    'adminWorkerLocal.open.mac': 'Apoi deschide-l din Descărcări (dacă macOS refuză: în Terminal, sh ~/Downloads/hcm-worker.command).',
    'adminWorkerLocal.open.windows': 'Apoi deschide-l din Descărcări (dacă Windows avertizează: Mai multe informații, Rulează oricum).',
    'adminWorkerLocal.connecting': 'Se conectează acest calculator…',
    'adminWorkerLocal.connected': 'Acest calculator e conectat.',
    'adminWorkerLocal.failed': 'Serverul hărții nu dă încă fișierul: actualizează harta (Configurare, Actualizează harta), apoi revino.',
    'adminWorkerLocal.stop': 'Nu mai folosi acest calculator',
    'adminWorkerLocal.stopped': 'Rulează o dată fișierul descărcat: scoate lucrătorul de pe acest calculator.',
    'adminWorkerLocal.noDocker': 'Nu ai Docker instalat?',
    'adminWorkerLocal.getDocker': 'Instalează Docker',
    'adminWorkerLocal.advanced': 'Avansat: pornește-l cu o comandă',
    'adminWorkerLocal.commandIntro': 'Cu Docker instalat, lipește comanda o dată într-un terminal: conectează calculatorul și rulează.',
    'adminWorkerLocal.command': 'Comanda lucrătorului',
    'adminWorkerLocal.copy': 'Copiază comanda',
    'adminWorkerLocal.copied': 'Comanda a fost copiată.',
    'adminWorkerLocal.copyFailed': 'Browserul nu a permis copierea: selectează comanda și copiaz-o.',
    'adminWorkerLocal.page': 'Deschide pagina lucrătorului',
    'adminWorkerLocal.notePair': 'Codul ei merge o dată, 10 minute (pagina îl reînnoiește); repornește cu calculatorul.',
    'adminWorkerLocal.noteGcloud': 'Imaginea nu se descarcă? gcloud auth configure-docker us-central1-docker.pkg.dev, apoi comanda.',
} as const;

export type AdminWorkerLocalKey = keyof typeof ro;
