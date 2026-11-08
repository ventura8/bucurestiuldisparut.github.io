# M18: improvements from the owner's use (2026-11-08)

The owner's standing rule: when something is off or the owner struggles, fix it or automate it. This file lists the
nine items of 2026-11-08, what was done for each, where it lives and which scenario rows test it. It is the record of
the track `track/improve`; later addenda are appended below, never rewritten.

## 1. Update the map appears after a deploy without a reload

**What was off.** A tab left open across a deploy kept the release it booted with (`runtime.json`, read once), so Home's
and Setup's **Update the map**, which compare what is installed with the admin's own release, stayed hidden until the
owner reloaded. The Reload banner of finding 29 said a newer admin was ready, but nothing happened by itself.

**What was done.** `packages/admin/src/app/release-reload.ts` follows the release watch: once Hosting serves a newer
admin the tab reloads by itself when no one is looking at it (hidden) or the owner has just come back to it (the newer
release seen within `RETURN_WINDOW_MS`, 10 s, of the tab becoming visible, or on any later return), and only when no
edit would be lost (`unsaved`). While the owner works on a visible tab, or with an unsaved edit, the Reload banner stays
as before. The sign-in lives in the tab's `sessionStorage`, so the reload keeps it.

**Rows.** S-A61-HAPPY-SELF-RELOAD (new), S-A61-HAPPY (now the banner seen while working).

## 2. A blocked Google window: plain words and one real retry

**What was done.** `packages/admin/src/app/consent-retry.ts` wraps the shell's Google consent: a window the browser
blocked puts `adminShell.oauth.popupBlocked` in the snackbar with **Try again**. Its click is a real click, and the retry
asks Google inside it before anything is awaited, so the browser lets the window open. A retry blocked again offers the
same; a granted one keeps the token and says so (`adminShell.oauth.retryGranted`), and the step's own button then goes on
without another window. The words now say what to do: press again, else allow pop-ups from the address bar's icon.

**Rows.** S-A27-HAPPY-BLOCKED-TRY-AGAIN, S-A27-BAD-POPUP-BLOCKED.

## 3. Frames parked for points search again by themselves; a failed crop offers Locate again; re-runs are free

**What was done.**

- `functions/src/imagery/relocate.ts`, a part of `imagery.tick`: every frame waiting for points remembers the pipeline
  image it was searched with (`JobDoc.searchedWith`, written the first time a tick sees it). Once another image is
  installed (`installedImage`, the job `raster-pipeline`'s digest) the frame searches again by itself, as **Locate
  again** does, at most `RELOCATE_PER_TICK` (3) a city a tick. A refusal (inputs gone, files on the other place) is
  logged once and remembered, so no later tick asks again for the same image. Frames parked before this change keep the
  image of the first tick that sees them and search again at the next pipeline update.
- `imagery.locateAgain` (`functions/src/imagery/locate-again.ts`) also takes a frame whose crop failed (its job failed at
  `stitch` or `locate`), so the version page offers **Locate again** before anyone imports it anew; a failure after the
  crop stays Try again's.
- Locate again is free: never the day's limit (it never was) and, like the admin's points, one run of its own whatever
  the runs before used (`attemptForSearch`), where it used to refuse with `apiError.imagery.attemptsExhausted`.
- The day's limit (`functions/src/imagery/limits.ts`) counts only what brings imagery in: `usgs-import`,
  `geotiff-import`, `layer-join`. New points, a crop (`regeoref`) and tiles (`layer-tiles`) never count; a re-run still
  stops while the budget guard is red (`refuseWhileGuardRed`).

**Rows.** S-A69-HAPPY-AUTO-RELOCATE, S-A69-BAD-AUTO-RELOCATE-REFUSED, S-A69-HAPPY-FAILED-CROP, S-A69-BAD-FAILED-LATER,
S-A12-HAPPY-RERUNS-FREE; S-A69-BAD-ATTEMPTS now asserts the run of its own.

## 4. A join refused because a frame's layer is busy

**What was done.** `imagery.join` refuses a busy published frame's layer with its own code,
`apiError.imagery.joinLayerBusy`: the layer is processed or published right now and a join would change it under that
work. The admin (`packages/admin/src/imagery/join.ts`) shows it beside Join frames and offers **Join when it ends** in the
snackbar; chosen, it says it waits and asks `imagery.join` again every `JOIN_WAIT_MS` (a minute) while the admin is open,
at most `JOIN_WAIT_TRIES` (two hours). Once the layer is free the join starts by itself and the snackbar says so; any
other refusal ends the wait and is said. The area's end stops the wait.

**Rows.** S-A65-BAD-JOIN-LAYER-BUSY; S-A65-HAPPY-JOIN-WHEN-FREE is `planned` (tested by
`packages/admin/test/imagery/join.test.ts` only: the e2e world has no seed yet for a frame published on a busy layer).

## 5. One Delete for an image at every stage

**What was done.** The same word and the same question everywhere: **Delete** and *Delete this image?* for a frame
waiting for points (its job is cancelled: the question `drop` of `hcm-imagery-page.ts`), one waiting for approval or
approved at the guard (Reject), a failed one (Dismiss) and a published one (the Layers page's delete). A deleted version
reads *Deleted*, and the filter *Hide deleted*. Only the words and the dialog changed; each stage keeps its callable.

**Rows.** S-A33-HAPPY-ONE-DELETE.

## 6. The viewer's Layers groups and the admin's pointer to Place categories

**Checked.** The viewer's Layers panel already groups Historical layers, Places (the city's categories, only when it has
some) and Map labels (S-V24-BAD-NO-POIS, `e2e/specs/viewer/map-labels.spec.ts`).

**What was done.** The admin's Layers page says that the public map's Places are the place categories, with a link to
Settings → Place categories (`hcm-layers-page.ts`, a 48 px target).

**Rows.** S-A39-HAPPY-FROM-LAYERS.

## 7. Home: What needs you

**What was done.** Home opens with **What needs you**: the historical images to approve, the role requests to accept,
the suggestions to review and the jobs that stopped (failed), each a link to where it is done (Imagery, Review, Jobs),
listed only while there are some; otherwise *Nothing needs you now.* A count the admin may not read (an owner's role
requests for another admin) is a dash and is not listed. The counts are Firestore aggregations, one read per thousand.

**Rows.** S-A40-HAPPY-NEEDS-YOU, S-A40-BAD-NOTHING-NEEDS-YOU.

## 8. The public map without WebGL

**What was done.** The consent card no longer covers the error card: without a map it flows in the photo list's column
under the error card instead of the docked card at the top (`viewer-render.ts`, `renderConsentBanner(..., false)`). The
list's first rows load their thumbnails at once (`EAGER_ROWS`, 12) and the rest lazily; the e2e now asserts the first
thumbnail is drawn. The live report of empty thumbnails could not be reproduced in the e2e world, where they load.

**Rows.** S-V02-HAPPY-NO-WEBGL-THUMBS, S-V02-BAD-NO-WEBGL-CONSENT.

## 9. An old starter file

**What was done.** When the computer's worker reports `old-starter`, the worker panel shows an alert with the one action
and what it unlocks: press Use this computer (on the same panel) and open the new file once; the computer updates itself
and hard frames are then placed by its own AI, free, before the owner is asked for points.

**Rows.** S-A68-BAD-OLD-STARTER; tour state `worker.panel-ai-old-starter`.
