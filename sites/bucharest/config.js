// București dispărut: the embed configuration the engine boots from (docs/ENGINE_API.md → config.js).
// In M1 the manifest is served next to the page (the site build writes data/manifest.json); from M2 it lives in the
// public bucket and manifestUrl becomes that https address. `globalThis` is `window` in a classic script.
globalThis.HistoricCityMapConfig = {
    cityId: 'bucuresti',
    manifestUrl: './data/manifest.json',
};
