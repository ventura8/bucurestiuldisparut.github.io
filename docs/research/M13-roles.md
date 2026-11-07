# M13: roles, review and suggestions

The owner's decisions of 2026-11-07. Two new city roles, a review queue, a public way to ask for a role, a gallery of photos
with no place, and public suggestions on any photo. The security rules are the enforcement, the screens only follow them.

## 1. Who may do what

`admins/{uid}.cities[city]` holds one of `owner`, `editor`, `moderator`, `uploader` (`CITY_ROLES`). The older roles keep every
right they had. The two new ones are allow-listed, never subtracted: every existing rule still names `['owner', 'editor']`, so a
new role opens nothing it does not name.

| Path or action | stranger (Google) | uploader | moderator | editor | owner | other city's member |
| --- | --- | --- | --- | --- | --- | --- |
| `cities/{city}` read | no | yes | yes | yes | yes | no |
| `cities/{city}` update (settings) | no | no | no | yes | yes | no |
| `photos`, `pois` read | no | own only | yes | yes | yes | no |
| `photos`, `pois` create | no | pending only | no | yes | yes | no |
| `photos`, `pois` update | no | own, while pending | yes | yes | yes | no |
| set `published` on a pending or refused item | no | no | no (callable) | no (callable) | no (callable) | no |
| `photos`, `pois` delete | no | own, pending or refused | no | yes | yes | no |
| `poiCategories` read | no | yes | yes | yes | yes | no |
| `poiCategories` write, `layers`, `jobs`, `layerVersions`, `usgsScenes`, `usage`, `exports`, `workers`, `imageryPlans` | no | no | no | yes | yes | no |
| `photos/*/history`, `pois/*/history` read | no | no | yes | yes | yes | no |
| `cities/{city}/history`, collection group `history` | no | no | no | yes | yes | no |
| `setup/*`, `usage/*`, `ops/*` (project state) | no | no | no | yes | yes | yes (as before) |
| `suggestions`, `contributors` read | no | no | yes | yes | yes | no |
| `roleRequests` read | no | no | no | no | yes | no |
| any client write to `suggestions`, `contributors`, `roleRequests`, `reviewStatus`, `heldImage` | no | no | no | no | no | no |
| photo upload to Storage | no | own pending photo | any photo | any photo | any photo | no |
| raster upload | no | no | no | yes | yes | no |
| `review-held/` read | no | own photo | yes | yes | yes | no |

Callable access levels (`CallableAccess`): `cityEditor` means owner or editor, as it always did. `cityReviewer` adds moderator.
`admin` now means an account with an owner or editor role somewhere (or no city at all, as before); `member` is any admin
document, for the notification device calls only. A pure uploader or moderator therefore reaches no `setup.*`, `imagery.*`,
`assist.*`, `export.*`, `worker.*`, `usgs.*`, `layers.*` or `cities.*` callable.

`history.revert` is `cityReviewer`, and a moderator reverts only a `photo` or a `poi` (`apiError.city.notEditor` otherwise).

The `admin` claim still gates everything (claim and document), so removing the document revokes at once.

## 2. Review queue

An uploader's new photo or place carries `reviewStatus: 'pending'`, enforced by the create rule, with `published: false`. The
statuses are `pending`, `approved`, `refused`; a document without the field is an older or staff document and counts as approved.

- `reviewStatus`, `reviewNote`, `reviewedBy`, `reviewedAt` and `heldImage` are server-owned. The update rule refuses a change of
  `published` while the stored status is `pending` or `refused`, so approval has one door, `review.decide`.
- `review.decide` (`cityReviewer`): `approve` publishes the item and, for a photo, moves its held pictures to the public bucket.
  `refuse` needs no note, keeps `published: false` and deletes the held pictures. Deciding a decided item answers
  `apiError.review.alreadyDecided`. A photo not processed yet answers `apiError.review.notReady`. A licence of `unknown` answers
  `apiError.review.licenseUnknown`.
- The manifest builder drops any `pending` or `refused` document whatever its `published` says: a second lock.

### Held pictures

`photos.onUpload` writes a pending photo's two WebP derivatives to the **private** bucket under
`review-held/{city}/{photo}/{sha256}-{variant}.webp`, and records their paths in `heldImage`. Nothing of a pending photo is in the
public bucket, so no uploader gets a public address to share. The admin reads them with `getBlob` (`FilePort`) under the Storage
rule. Approval copies them to the content-hashed public paths and sets `image`.

## 3. Asking for a role

`#/contribute/<city>` is a page of the admin app, reached by the small Contribute link of the public map (`manifest.contributeUrl`,
§5). The map gains only that link: no sign-in code, no Firestore, no cookie.

- `contribute.context` (`signedIn`): the city's public name and view, the caller's role and request, whether they are blocked, and
  with a `photoId` the published photo's public fields. A photo that is not public answers `apiError.notFound`.
- `contribute.request` (`signedIn`): `{cityId, role: 'uploader' | 'moderator', reason, credit?}` writes
  `cities/{city}/roleRequests/{uid}` and a `role.requested` notification to the city's owners. One open request per account; a
  refused account may ask again after `ROLE_REQUEST_RETRY_DAYS`; a blocked account is refused; a member whose role already covers
  the ask is refused (`apiError.contribute.alreadyMember`).
- `contribute.decide` (`cityOwner`): approve writes the role into `admins/{uid}` in one transaction with the request (the
  stronger role wins) and sets the `admin` claim; refuse records the decision and an optional note, which the applicant reads
  through `contribute.context`. The page says it the next time they open it.

The request stores the account's Google address and display name so the owner can recognise the person; `roleRequests` is readable
by the city's owners only. The address is never logged.

## 4. Suggestions

`suggestions.submit` (`signedIn`, no role needed): `kind: 'place'` on a published photo with no location (location required,
direction optional), `kind: 'correction'` on a published placed photo (at least one of date, location, direction, plus a required
reason and an optional source link). Both take an optional credit name.

- **Limits**: `SUGGESTIONS_PER_DAY` per account per city, counted in a transaction on `cities/{city}/contributors/{uid}`.
- **Blocked accounts**: `contributors/{uid}.blocked` refuses suggestions and role requests (`apiError.contribute.blocked`).
  `contributors.setBlocked` is `cityReviewer`.
- **Grouping**: the document id is a hash of the photo, the kind and the proposal rounded (`SUGGESTION_GRID_DEGREES` for the
  location, `SUGGESTION_BEARING_STEP` for the direction), so repeats land on one document. An account counts once. A repeat of a
  decided proposal changes nothing and is still answered as received, so nobody learns to resubmit around a refusal.
- **Decisions**: `suggestions.decide` (`cityReviewer`): `approve` applies the proposal, `adjust` applies the reviewer's values,
  `reject` applies nothing. Applying is one transaction on the photo with the reviewer as `updatedBy`, so the existing
  `history.onPhotoWrite` records the previous version and `history.revert` undoes it in one click. The public photo does not change
  before that. The `suggestion.waiting` notification goes to the city's reviewers, once per group.
- The photo's location, once set, keeps the bounds check of the manifest (`PHOTO_LOCATION_SLACK_DEG`): outside the city answers
  `apiError.suggestion.outsideCity`.

## 5. The manifest (additive)

- `photos[].location` stays required. `unplaced` is a new optional list of photos with no location, direction or field of view. The
  builder emits it only when not empty, and photo ids are unique across both lists.
- `contributeUrl`: the admin's address of `#/contribute/<city>`, optional, set by the builder when the project knows its admin
  address. A static export leaves it out: the copy has no backend of its own.
- `photos[].credit`, `unplaced[].credit`, `pois[].credit`: the optional credit name.

No release is tagged yet, so these join the v1 baseline every 1.x engine reads, as `photosOverlay` did, and need no `minVersion`
(`docs/ENGINE_API.md`, *Additions before 1.0.0*). An old manifest stays valid. Once 1.0.0 is tagged, an addition needs its minor
release and `city.engine.minVersion`.

`photoDocSchema.location` becomes optional because the document can wait for a place. `photos.create` rules: a location, when given,
is checked against the city as before; a direction or a field of view without a location is refused. An existing location cannot be
removed from a client: the rule's `inCity` errors on the missing key, and an error denies.

## 6. New paths and documents

| Path | Writer | Schema |
| --- | --- | --- |
| `cities/{city}/roleRequests/{uid}` | `contribute.request`, `contribute.decide` | `roleRequestDocSchema` |
| `cities/{city}/suggestions/{group}` | `suggestions.submit`, `suggestions.decide` | `suggestionDocSchema` |
| `cities/{city}/contributors/{uid}` | `suggestions.submit`, `contributors.setBlocked` | `contributorDocSchema` |
| `review-held/{city}/{photo}/{file}` (private bucket) | `photos.onUpload`, `review.decide` | none |

## 7. Notifications

Three new kinds, with an audience each (`NOTIFICATION_AUDIENCES`): `review.waiting` and `suggestion.waiting` reach reviewers,
`role.requested` reaches owners. Every older kind (a job, the budget, crashes) reaches `staff` only (owners and editors, or an
account with no city at all, as before), so a moderator is not told about imagery or billing.

## 8. The admin's screens

- Navigation: an uploader sees Photos, Places, Notifications; a moderator also Review. Any other route answers
  `adminShell.route.notAllowed` and opens the role's first page. The rules deny the data anyway.
- `#/review`: Uploads, Suggestions (current and proposed side by side on one map, approve, adjust, reject, block the account,
  Revert after an approval), Requests (owners only).
- `#/contribute/<city>` and `#/contribute/<city>/<photoId>`: the request form and the suggestion form with the photo editor's place
  and direction tool. This route shows whatever the account's role, and also on the `notAdmin` and `joinPending` screens.

## 9. Threats and what stops them

| Threat | Control |
| --- | --- |
| Uploader publishes own item | `published == false` on create, `published` not in the uploader's update list, the callable is `cityReviewer` |
| Uploader hosts a file publicly | Held pictures stay in the private bucket until approved |
| Uploader replaces a published photo's picture | The Storage rule reads the photo: only own and `pending` |
| Uploader sets `reviewStatus: 'approved'` on create | The create rule requires exactly `pending` for that role |
| Moderator reaches settings or roles | Rules name `owner`, `editor`; `admins.*` and `cities.*` callables need the owner |
| Moderator reverts a city's settings | `history.revert` limits a moderator to `photo` and `poi` |
| Moderator or uploader reads Setup or budgets | `setup`, `usage`, `ops` need `isStaff()`; `admin`-access callables too |
| Stranger writes a suggestion directly | No client write rule at all; the callable checks the account, the block and the limit |
| Flooding | Daily limit per account per city; grouping keeps one document per proposal; lists in a document are capped |
| Script in a reason or a credit | Plain text only, rendered with Lit's text bindings; a source link must be https |
| Repeat after refusal | A decided group stays decided |
| Revoked member keeps a token | The rules and `requireAccess` read `admins/{uid}` on every request |
| Public learns of pending items | The manifest builder filters by status; pending documents are never readable without a role |

## 10. As built, and what is left

- A suggestion group keeps the photo's title and thumbnail from when it began (`photoTitle`, `photoThumb`), so the queue lists without reading each photo.
- A moderator or an uploader reads no `setup/status`, so the admin's map wears the city's public token (`cityTokenOf`), and the Contribute page passes the token `contribute.context` answered.
- The Contribute link is an item of the map's menu; a photo's sheet and the gallery hold a plain link to the page on that photo.
- Left for a later change, none of it a way around the rules:
    - held pictures of a pending photo its uploader deleted stay in the private bucket until a sweep is added;
    - the editors' AI assists are still offered to a moderator or an uploader, whose call is refused (`cityEditor`) with its message;
    - an uploader's list shows no thumbnail for a pending photo (the Review page does, with the Storage rule);
    - no daily cap on an uploader's uploads, and the credit field exists on the photo editor only (a place takes `credit` through the rules and the schema, with no field yet).
