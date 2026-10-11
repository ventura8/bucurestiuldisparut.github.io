# i18n Skill

**Historic City Map** speaks Romanian and English; Romanian is the default. The catalogues and helpers live in `@hcm/shared`: `packages/shared/src/i18n/ro.ts`, `packages/shared/src/i18n/en.ts`, `packages/shared/src/i18n/index.ts`.

## How it works

- `ro.ts` is the **key source of truth**: it defines the keys (`MessageKey`) and the `Messages` type.
- `en.ts` is typed `Messages`, so a missing or extra English key is a compile error (`tsc` gate).
- `resolveLocale(tag)` maps a BCP 47 tag to a supported locale: English (`en`, `en-US`) stays English, anything else (including `fr`, empty, malformed) becomes `ro` (`DEFAULT_LOCALE`).
- `translate(locale, key, params)` fills `{name}` placeholders; an unknown placeholder stays visible so a test can see it.
- Data has its own translations: city, layer and photo texts are `{ro, en}` maps in Firestore and the manifest; a photo cannot be published without its EN title (scenario A10).

## Rules

1. Every UI string goes into **both** catalogues in the same task, Romanian first, with correct diacritics (ă, â, î, ș, ț with comma below, never the cedilla forms ş, ţ).
2. No hard-coded user-visible string in a component; tests assert the translated text in both languages.
3. Dates and numbers are formatted with `Intl` for the active locale; the timezone of tests is `Europe/Bucharest`.
4. The viewer: RO by default, `?lang=en` or the language switch selects English, the choice persists after reload, `<html lang>` follows it (scenario V11). The admin: every screen in RO and EN; switching keeps form state (A21).
5. The tour tier's **leak check**: in RO mode no English-only catalogue string and no raw message id appears in the DOM.
6. The `i18n` static gate (`scripts/ci/check_i18n.py`) checks every `packages/*/src/i18n/` folder: one catalogue per locale, the same keys, no duplicates, no empty message, the same `{placeholder}` names. Keep each catalogue a flat object literal with one entry per line, or the gate reports the line it cannot read.
7. Machine translation drafts (M4, `assist.translate`) are drafts: never auto-published.
