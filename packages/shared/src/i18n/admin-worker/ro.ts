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
    'adminWorker.intro': 'Cu Docker instalat, rulează comanda, apoi deschide pagina lucrătorului și conectează-te cu contul Google.',
    'adminWorker.command': 'Comanda lucrătorului',
    'adminWorker.copy': 'Copiază comanda',
    'adminWorker.copied': 'Comanda a fost copiată.',
    'adminWorker.copyFailed': 'Browserul nu a permis copierea: selectează comanda și copiaz-o.',
    'adminWorker.open': 'Deschide pagina lucrătorului',
    'adminWorker.noteFolder': 'Containerul scrie în ~/hcm-worker: pe Linux, creează-l o dată cu mkdir -m 777 ~/hcm-worker.',
    'adminWorker.noteGcloud': 'Dacă imaginea nu se descarcă: gcloud auth configure-docker us-central1-docker.pkg.dev, apoi comanda.',
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
    'adminWorker.startWorker': 'Cum pornești lucrătorul: pagina Procesări',
    'adminWorker.freeTier': 'În Google Cloud ar depăși nivelul gratuit al lunii: așteaptă acordul tău.',
    'adminWorker.estimate': 'Estimarea rulării: {vcpu} vCPU-secunde · {gib} GiB-secunde.',
} as const;

export type AdminWorkerKey = keyof typeof ro;
