# i18n Skill

**Historic City Map** speaks Romanian and English; Romanian is the default. The catalogues and helpers live in `@hcm/shared`: `packages/shared/src/i18n/ro.ts`, `packages/shared/src/i18n/en.ts`, `packages/shared/src/i18n/index.ts`.

## How it works

- `ro.ts` is the **key source of truth**: it defines the keys (`MessageKey`) and the `Messages` type.
- `en.ts` is typed `Messages`, so a missing or extra English key is a compile error (`tsc` gate).
- `resolveLocale(tag)` maps a BCP 47 tag to a supported locale: English (`en`, `en-US`) stays English, anything else (including `fr`, empty, malformed) becomes `ro` (`DEFAULT_LOCALE`).
- `translate(locale, key, params)` fills `{name}` placeholders; an unknown placeholder stays visible so a test can see it.
- Data has its own translations: city, layer, photo, POI and POI category texts are `{ro, en}` maps in Firestore and the manifest; a photo cannot be published without its EN title (scenario A10).
- The viewer's keys (M1) are all in the catalogues already, by family: `validation.*` (the codes `validate` and `validateManifest` return, so a schema problem is always shown localized), `error.*`, `action.*`, `viewer.*`, `timeline.*`, `layers.*` (with the overlay list's `layers.group.*`, `layers.opacityChanged`, `layers.shown`, `layers.hidden`), `photos.*`, `photo.*`, `poi.*` (the POI details), `license.*`, `lightbox.*`, `share.*`, `about.*`, `theme.*`, `language.*`, `consent.*`, `geolocate.*` (`docs/research/M1-interfaces.md` §7). Counted forms use `Intl.PluralRules(locale)` over `.one` / `.few` / `.other` keys.

- The backend's error messages are a catalogue of their own, `packages/shared/src/i18n/api/` (`ro.ts` the key source, `en.ts` typed against it): one `apiError.*` key per error code the functions report, filled with `translateApiError(locale, code, params)`. The viewer imports none of it, so the public bundle carries no admin text; the admin's own screens get their own catalogue in the admin package.

## Rules

1. Every UI string goes into **both** catalogues in the same task, Romanian first, with correct diacritics (ă, â, î, ș, ț with comma below, never the cedilla forms ş, ţ).
2. No hard-coded user-visible string in a component; tests assert the translated text in both languages.
3. Dates and numbers are formatted with `Intl` for the active locale; the timezone of tests is `Europe/Bucharest`.
4. The viewer: RO by default, `?lang=en` or the language switch selects English, the choice persists after reload, `<html lang>` follows it (scenario V11). The admin: every screen in RO and EN; switching keeps form state (A21).
5. The tour tier's **leak check** (`e2e/support/i18n.ts`): in RO mode no English-only catalogue string and no raw message id appears in the DOM or an accessible name. Third-party UI counts too: Mapbox GL's own strings (the canvas's name, the attribution toggle, the logo link) come from the catalogues (`map.title`, `map.toggleAttribution`, `map.logo`) through Mapbox's `locale` option; they are read when the map is created, so a live language switch keeps them until the next map.
6. The `i18n` static gate (`scripts/ci/check_i18n.py`) checks every `packages/*/src/i18n/` folder and every folder directly inside one: one catalogue per locale, the same keys, no duplicates, no empty message, the same `{placeholder}` names. Keep each catalogue a flat object literal with one entry per line, or the gate reports the line it cannot read. An entry longer than 140 columns is wrapped by Prettier onto two lines and then fails this gate: shorten the message instead.
7. Machine translation drafts (M4, `assist.translate`) are drafts: never auto-published.
8. One screen, one language: resolve it once by the documented order (the URL, the stored choice, the configuration, Romanian) and use that result for every text, error cards and their details included.
9. Visitor copy is plain, natural language, not the engine's vocabulary: "porțiuni ale hărții", not "dale" (tiles), a theme that follows the device is "Automată", not "Ca sistemul"; no two lines of one screen say the same thing (a legacy photo's licence names its source, the separate note says its rights are under review). English follows its own conventions (`80%`, no space; Romanian writes `80 %`), the same in every message of a family.
