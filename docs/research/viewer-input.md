# Viewer input: shortcuts, gamepad, the basemap's light, the accessibility statement

The owner's request of 2026-11-07 ("keyboard and gamepad support for viewers"). Behaviours V32 to V35 of `e2e/scenarios.json`. This is the contract the code follows; the public description is `docs/ENGINE_API.md` → *Keyboard and gamepad* and → *`basemap.config`*.

## 1. One command set

`packages/ui/src/viewer/input-commands.ts` is the one place that decides what an input does: `year-next`, `year-previous`, `opacity-up`, `opacity-down`, `photo-next`, `photo-previous`, `layers`, `help`, `close`. Keyboard and gamepad both go through `HcmMapViewer.runInput(command)`, which applies `commandAllowed` and then acts on the store. No input path touches the map or the hash except through the store, apart from the gamepad's camera (§3).

- *Current layer*: the first visible raster overlay. None visible: the toast `input.noLayer`.
- *Photos*: the photos near the year when a year is chosen, all of them at "today" or in the lightbox; steps wrap around. None: `input.noPhoto`.
- *Feedback*: year and opacity changes show in a toast, which is also the announcement.
- *Layers where the panel is always docked*: nothing opens and the store is not touched, so the photo or place open beside the panel stays; only the focus moves.
- *Which surfaces allow what*: over the lightbox only photos and close; over About and the help panel only help and close; without WebGL no year, opacity or Layers.

## 2. Keyboard

The listener is on the document, but a key counts only when the event comes from inside the viewer, or from the page's body while this is the page's first viewer. A second viewer or the host page's own controls are never driven.

| Key | Command |
| --- | --- |
| `.` and `,` | later and earlier year |
| `o` and `i` | more and less opacity of the current layer |
| `n` and `p` | next and previous photo |
| `l` | open or close Layers (on an extra-large window, where the panel is always docked, move the focus to it) |
| `?` | the help panel |

Why these keys:

- Arrows, `+`, `-` and `=` belong to Mapbox on the focused map, and to the timeline and the lightbox.
- A key with Ctrl, Alt or Meta is never taken (AltGr reports Ctrl and Alt), nor one being composed, nor one a control already handled.
- Focus in a field, a contenteditable, a text-like role or an open menu takes nothing: typing always wins.
- Only the opacity keys repeat when held.
- A screen reader in browse mode swallows these letters itself and nothing happens in the page. Its keys are not overridden; focus mode reaches the shortcuts. This has not been tested with people, and the help panel does not say it, for the entry's budget.
- WCAG 2.1.4 (character key shortcuts) asks for a way to turn single-key shortcuts off: the switch in the help panel does, stored as the `shortcuts` preference (`hcm:<cityId>:shortcuts`, localStorage, like language and theme; no cookie). With it off `?` does nothing either, so the panel also opens from About.

The help panel is a mode of `<hcm-about-dialog>` (`sheet: 'help'`), so it shares the dialog, the focus return and the map's legal line at its foot.

## 3. Gamepad

- **Lazy**: the entry only listens for `gamepadconnected` (`viewer/gamepad/watch.ts`) and looks once at the pads the browser already reveals. The chunk `gamepad-<hash>.js` (`viewer/gamepad/gamepad.ts`, `@hcm/ui/viewer/gamepad`) is fetched only then, and has its own row in `scripts/ci/check_bundle_budget.py`. A failed fetch logs a warning and retries at the next connection.
- **Mapping**: only `mapping === 'standard'` is read. Any other pad is refused once with a toast, and nothing polls it. A cross-origin frame without the `gamepad` permission throws from `getGamepads`: that reads as no pads.
- **Loop**: one `requestAnimationFrame` loop, only while a standard pad is connected and the tab is visible. It stops at `visibilitychange` to hidden and at disconnect. When it starts, what is already held counts as held, so a press from before fires nothing.
- **Sticks**: a radial dead zone of 0.15. The left stick pans at up to 500 px/s, the right stick's vertical axis and the triggers zoom at up to 1.5 levels/s. The camera goes through `MapPort.getView` and `flyTo(view, {animate: false})`, Mapbox applies the city's bounds and zoom range, and a covered map (a modal open, no WebGL, not ready) does not move.
- **Buttons** (standard indices): 0 A activates what has the focus, or with nothing focused does what Enter does on the map (the photo or place at its centre); 1 B closes the menu or the front surface; 3 Y Layers; 4 and 5 LB and RB previous and next photo; 8 Back help; 9 Start menu (not under a modal surface: `click()` fires on an inert element too); 12 and 13 D-pad up and down move the focus through the tabbable, non-inert controls (arrow keys inside the menu); 14 and 15 D-pad left and right earlier and later year.
- **An open menu** takes no command, as it takes no shortcut: only the D-pad, A and B act in it, so nothing opens behind it.
- **Focus**: Chromium's `:focus-visible` shows no ring on a programmatic focus after a mouse click, so from the pad's first press on, every frame sets the ring on what has the focus, through the CSSOM (the CSP allows that), and blur removes it. Reading the focus each frame covers every path, also those that focus after a render (Y, Start, a closed surface's opener), with no code in them. A control clicked with the mouse after that gets a ring too, which harms nothing and costs the entry, which has no margin, no listeners.
- **Limits**: tested only with a fake pad (`navigator.getGamepads` replaced); no real hardware was available. Two viewers on a page both follow the pad.

## 4. The basemap's light

`core/map-light.ts`: `mapLight(state)` is `day` or `night` from the effective theme (`theme`, or `prefers-color-scheme` under `system`, kept in the state as `systemDark`), and null when the city's `basemap.config` names `lightPreset`. A dark theme also goes into the mount's `config`, so a dark page never flashes day. After that `MapSync` writes through `getBasemapOption` and `setBasemapOption` only what the mounted style reports having. Light never adds a map load; a style without the property is never written to, and Mapbox ignores the mount's `config` for it. Compare's second map follows through its own `MapSync`.

Standard's light dims what is not emissive, and Mapbox's default emissive strength is 0 for fill, line and circle layers (1 for icons and text). So the raster, the view cones and the POI fills, casings, lines and discs set `*-emissive-strength: 1`: the colours a city owner chose read the same by day and by night. Not checked on a real Mapbox Standard night by eye; the e2e tier reads the value from the mounted map.

## 5. The accessibility statement

In About, catalogue strings in Romanian and English: what works, what is missing (no screen reader test with people, the map's picture has no text alternative) and how to report a problem. It claims no legal conformance by saying none; the sentence that said so went to the entry's budget. The manifest has no contact field, so the report is a link to the engine's issue tracker (`https://github.com/ventura8/bucurestiuldisparut.github.io/issues`), on every city, also one with no credits: the viewer's accessibility is the engine's. GitHub asks for a free account. A contact per city would be a new manifest field, with its admin editor; the owner's decision, not made here.
