/**
 * Romanian texts of M7's "Run on my computer" (`docs/research/M7-local-worker.md` §7): the worker's panel on the Jobs
 * page and the pipeline card, the city's choice of where jobs run, Cloud Run's free-tier meter and a version's place. A
 * catalogue of its own, in the admin's lazy `worker` chunk only (the entry never imports it). The source of truth for
 * `AdminWorkerKey`; `en.ts` is typed against it. One entry per line (scripts/ci/check_i18n.py).
 */
export const ro = {
    'adminWorker.title': 'Calculatorul tău',
    'adminWorker.connected': 'Calculatorul tău e conectat. Văzut: {when}.',
    'adminWorker.none': 'Niciun calculator conectat.',
    'adminWorker.lastSeen': 'Văzut ultima dată: {when}.',
    'adminWorker.working': 'Lucrează acum la procesarea:',
    'adminWorker.lastDone': 'Ultima procesare s-a încheiat: {when}.',
    'adminWorker.lastFailed': 'Ultima procesare a eșuat: {when}.',
    'adminWorker.outdated': 'Calculatorul are un pipeline vechi: nicio procesare până se actualizează (singur, cu fișierul de pornire).',
    'adminWorker.disconnect': 'Deconectează acest calculator',
    'adminWorker.disconnected': 'Calculator deconectat: Folosește acest calculator îl conectează din nou.',
    'adminWorker.progress': 'Pasul {step}: {percent} %',
    'adminWorker.noImage': 'Actualizează mai întâi pipeline-ul de imagini: cel instalat nu își numește imaginea.',
    'adminWorker.openSetup': 'Deschide pipeline-ul de imagini',
    'adminWorker.choice': 'Unde rulează procesările noi',
    'adminWorker.choice.auto': 'Rulează pe calculatorul meu când e conectat',
    'adminWorker.choice.local': 'Mereu pe calculatorul meu',
    'adminWorker.choice.cloud': 'Mereu în Google Cloud',
    'adminWorker.meter': 'Cloud Run luna aceasta (estimare)',
    'adminWorker.meterUse': '{vcpu} din {vcpuFree} vCPU-secunde · {gib} din {gibFree} GiB-secunde',
    'adminWorker.meterShare': 'Din nivelul gratuit: {percent} %',
    'adminWorker.place': 'Unde rulează',
    'adminWorker.place.local': 'Rulează pe calculatorul tău.',
    'adminWorker.place.cloud': 'Rulează în Google Cloud.',
    'adminWorker.place.auto': 'Locul se alege când pornește.',
    'adminWorker.runLocal': 'Rulează pe calculatorul meu',
    'adminWorker.runCloud': 'Rulează în Google Cloud',
    'adminWorker.runCloudAnyway': 'Rulează în Google Cloud oricum',
    'adminWorker.waitWorker': 'Așteaptă calculatorul tău.',
    'adminWorker.waitOverdue': 'Calculatorul tău nu a preluat-o în {minutes} de minute.',
    'adminWorker.runCloudInstead': 'Rulează în schimb în Google Cloud',
    'adminWorker.startWorker': 'Cum folosești calculatorul: pagina Procesări',
    'adminWorker.freeTier': 'În Google Cloud ar depăși nivelul gratuit al lunii: așteaptă acordul tău.',
    'adminWorker.estimate': 'Estimarea rulării: {vcpu} vCPU-secunde · {gib} GiB-secunde.',
} as const;

export type AdminWorkerKey = keyof typeof ro;
