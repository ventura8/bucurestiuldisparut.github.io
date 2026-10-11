# Web Security Skill

Security rules for the viewer, the admin and every page they load. Background and exact policies: `docs/research/design-review-security-cost.md` §1.

## No HTML from data (hard rule)

- Render with Lit templates (auto-escaping) and `textContent` only; Mapbox popups use `setDOMContent`.
- ESLint bans `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTML`, `setHTMLUnsafe`, `document.write`, `eval`, `new Function`, and the Lit `unsafeHTML` / `unsafeSVG` / `unsafeMathML` directives (`eslint.config.js`, plus `eslint-plugin-no-unsanitized`). Never relax these.
- Legacy data contains HTML anchors (`seed/bucharest/photos.legacy.geojson`): the migrator parses them into structured `links: [{url, label}]` (https only; http upgraded or dropped) plus plain text. No HTML is stored.
- Rich "About" text is a minimal Markdown subset (bold, italic, https links) rendered into DOM nodes, never HTML.
- Untrusted strings shown as text only: EXIF fields, USGS metadata and HTML error bodies, Nominatim results, AI drafts, Mapbox job errors.

## URLs, ids, uploads

- zod accepts `https:` URLs only; image URLs must match our bucket prefix exactly; external links get `rel="noopener noreferrer nofollow ugc"`.
- `#photo=<id>` must match `^[A-Za-z0-9_-]{1,40}$` and is looked up in a `Map`, never used in a selector.
- No SVG upload, ever; the server sniffs magic bytes, limits input pixels and strips metadata from public derivatives; HEIC is converted server-side.

## CSP and headers

- **Admin** (Firebase Hosting headers in `firebase.json`): `script-src 'self'` plus reCAPTCHA, a narrow `connect-src` and `img-src`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, Trusted Types in report-only first, `Cross-Origin-Opener-Policy: same-origin-allow-popups` for popup sign-in, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Public site** (GitHub Pages, meta CSP only): `default-src 'none'`, scripts from `'self'` and `https://api.mapbox.com/mapbox-gl-js/` with `'wasm-unsafe-eval'` (required by the Standard style), images and data from the public bucket and Mapbox, `<meta name="referrer" content="strict-origin-when-cross-origin">`.
- Analytics hosts (googletagmanager, google-analytics, firebaseinstallations, firebaselogging) are added to the CSP only for the consent-gated SDKs.
- No inline `<script>`; a third-party city that loads the engine from jsDelivr pins an exact version with `integrity` and `crossorigin`.

## Tokens and secrets in the browser

- Mapbox **public** tokens only, URL-restricted to their origin (viewer `https://ventura8.github.io`; admin `<proj>.web.app` and `<proj>.firebaseapp.com`), scopes `styles:read styles:tiles fonts:read`. Never `no-referrer` or `same-origin` referrer policies (the restriction needs the origin).
- Secret tokens (Mapbox `sk`, USGS app token) never live in the browser beyond the paste box: they go straight to a `setup.*` callable and Secret Manager.
- The Firebase web config is never committed; the admin reads `/__/firebase/init.json` on Hosting.
- App Check (reCAPTCHA Enterprise) protects Firestore and callables in the admin; the public viewer needs none (no Firebase SDK for data).

## Consent and privacy

- GA4 and Performance Monitoring load only after consent (Consent Mode v2 defaults denied); the decision is stored and can be withdrawn in About (`firebase/analytics_and_crash_skill.md`).
- No PII in events, logs or error reports; the logger redacts secret-looking keys (`token`, `secret`, `password`, `authorization`, `signature`, `apiKey`) and the query part of signed URLs.
- Self-hosted fonts, no Google Fonts.
