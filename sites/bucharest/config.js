// București dispărut: the embed configuration the engine boots from (docs/ENGINE_API.md → config.js).
// In M1 the manifest is served next to the page (the site build writes data/manifest.json); from M2 it lives in the
// public bucket and manifestUrl becomes that https address. The city is the project's (infra/project.json), which every
// manifest the backend builds names; the legacy manifest's own id is renamed by the site build (site.json → legacyCityId).
window.HistoricCityMapConfig = {
    cityId: 'bucharest',
    manifestUrl: './data/manifest.json',
};
