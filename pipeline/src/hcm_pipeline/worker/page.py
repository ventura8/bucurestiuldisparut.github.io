"""The local page the owner signs in on (docs/research/M7-local-worker.md §2.1), and its headers.

Static HTML, script and style, no template engine: the only values written into the page are the project id, the city
id and the per-process CSRF token (and, under `--emulators`, the Auth emulator's loopback host), each checked against
its pattern first and written as JSON into a `<script type="application/json">` element with `<`, `>` and `&` escaped.
The script loads the Firebase JS SDK 13.1.0 (the admin's version: a test keeps them equal) from `www.gstatic.com`, the
project's web configuration from the worker (`GET /config`, which the worker read from the project's Hosting), signs in
with Google in a popup (the SDK keeps nothing: in-memory persistence, signed out once the worker holds the tokens),
posts `{idToken, refreshToken}` to `POST /session` with the CSRF token, polls `GET /state` and has Sign out. Its words
are in English and Romanian (the browser's language picks).
"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.paths import CITY_ID
from hcm_pipeline.worker.args import EMULATOR_HOST, PROJECT_ID

FIREBASE_SDK_VERSION: Final = "13.1.0"
SDK_ORIGIN: Final = "https://www.gstatic.com"
SETTINGS_ELEMENT: Final = "hcm-worker-settings"
CSRF_TOKEN: Final = re.compile(r"[0-9a-f]{64}")
_SETTINGS_MARK: Final = "__HCM_WORKER_SETTINGS__"
_ESCAPES: Final = {"<": "\\u003c", ">": "\\u003e", "&": "\\u0026"}


@dataclass(frozen=True)
class PageSettings:
    """The page's three checked values (and the Auth emulator under `--emulators`)."""

    project: str
    city: str
    csrf: str
    auth_emulator: str | None = None

    def __post_init__(self) -> None:
        checks = (
            (PROJECT_ID, self.project),
            (CITY_ID, self.city),
            (CSRF_TOKEN, self.csrf),
            (EMULATOR_HOST, self.auth_emulator or "127.0.0.1:1"),
        )
        if not all(pattern.fullmatch(value) for pattern, value in checks):
            raise ValueError("a value of the local page does not have its expected shape")

    def json(self) -> str:
        """The settings as JSON safe inside a script element."""
        settings = {"projectId": self.project, "cityId": self.city, "csrf": self.csrf, "authEmulator": self.auth_emulator}
        text = json.dumps(settings, ensure_ascii=True)
        for character, escaped in _ESCAPES.items():
            text = text.replace(character, escaped)
        return text


def content_security_policy(project: str, emulator_hosts: Sequence[str] = ()) -> str:
    """The page's policy: its own files, the SDK, Google's sign-in popup, the project's Auth calls; nothing inline runs."""
    local = [f"http://{host}" for host in emulator_hosts]
    directives = (
        "default-src 'none'",
        f"script-src 'self' {SDK_ORIGIN} https://apis.google.com",
        " ".join(("connect-src 'self'", f"https://{project}.web.app", "https://*.googleapis.com", *local)),
        " ".join(("frame-src", f"https://{project}.firebaseapp.com", f"https://{project}.web.app", "https://accounts.google.com", *local)),
        "style-src 'self'",
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    )
    return "; ".join(directives)


PAGE_HTML: Final = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Historic City Map: this computer's worker</title>
<link rel="stylesheet" href="/page.css">
<script type="application/json" id="{SETTINGS_ELEMENT}">{_SETTINGS_MARK}</script>
<script type="module" src="/page.js"></script>
</head>
<body>
<main>
<h1 data-text="title">Historic City Map: this computer's worker</h1>
<dl>
<dt data-text="accountLabel">Signed in as</dt><dd id="account"></dd>
<dt data-text="cityLabel">City</dt><dd id="city"></dd>
<dt data-text="workLabel">Work</dt><dd id="work"></dd>
</dl>
<p id="error" role="alert"></p>
<p>
<button id="sign-in" type="button" data-text="signIn">Sign in with Google</button>
<button id="sign-out" type="button" data-text="signOut" hidden>Sign out</button>
</p>
</main>
</body>
</html>
"""

PAGE_CSS: Final = """:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 16px; }
main { max-width: 40rem; margin: 0 auto; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; }
dt { font-weight: 600; }
dd { margin: 0; overflow-wrap: anywhere; }
#error { color: #b3261e; min-height: 1.5em; }
@media (prefers-color-scheme: dark) { #error { color: #f2b8b5; } }
button { font: inherit; min-height: 48px; padding: 0 24px; border-radius: 24px; cursor: pointer; }
"""

PAGE_JS: Final = (
    """const SDK = 'https://www.gstatic.com/firebasejs/"""
    + FIREBASE_SDK_VERSION
    + """';
const { initializeApp } = await import(`${SDK}/firebase-app.js`);
const auth$ = await import(`${SDK}/firebase-auth.js`);
const settings = JSON.parse(document.getElementById('"""
    + SETTINGS_ELEMENT
    + """').textContent);
const TEXTS = {
    en: {
        title: "Historic City Map: this computer's worker",
        accountLabel: 'Signed in as',
        cityLabel: 'City',
        workLabel: 'Work',
        signIn: 'Sign in with Google',
        signOut: 'Sign out',
        notSignedIn: 'Not signed in',
        idle: 'Waiting for a job',
        busy: 'Working on job',
        'signed-out': 'Sign in to start working',
        signedOut: 'Signed out',
        signInAgain: 'Your session ended: sign in again',
        configMissing: "The project's web configuration could not be read",
        'apiError.notAdmin': 'This account is not an editor of this city',
        'apiError.unauthenticated': 'The sign-in was not accepted: sign in again',
        'apiError.invalidRequest': 'The sign-in could not be read: sign in again',
        'apiError.unavailable': 'The server did not answer: try again',
    },
    ro: {
        title: 'Harta istorică a orașului: lucrătorul acestui calculator',
        accountLabel: 'Conectat ca',
        cityLabel: 'Oraș',
        workLabel: 'Lucru',
        signIn: 'Conectează-te cu Google',
        signOut: 'Deconectează-te',
        notSignedIn: 'Neconectat',
        idle: 'Așteaptă o lucrare',
        busy: 'Lucrează la lucrarea',
        'signed-out': 'Conectează-te ca să înceapă lucrul',
        signedOut: 'Deconectat',
        signInAgain: 'Sesiunea s-a încheiat: conectează-te din nou',
        configMissing: 'Configurația web a proiectului nu a putut fi citită',
        'apiError.notAdmin': 'Acest cont nu este editor al acestui oraș',
        'apiError.unauthenticated': 'Conectarea nu a fost acceptată: conectează-te din nou',
        'apiError.invalidRequest': 'Conectarea nu a putut fi citită: conectează-te din nou',
        'apiError.unavailable': 'Serverul nu a răspuns: încearcă din nou',
    },
};
const lang = (navigator.language || 'en').toLowerCase().startsWith('ro') ? 'ro' : 'en';
const text = (key) => TEXTS[lang][key] ?? key;
const byId = (id) => document.getElementById(id);
document.documentElement.lang = lang;
for (const node of document.querySelectorAll('[data-text]')) {
    node.textContent = text(node.dataset.text);
}

async function session(method, body) {
    const response = await fetch('/session', {
        method,
        headers: { 'Content-Type': 'application/json', 'X-HCM-Worker': settings.csrf },
        body: JSON.stringify(body ?? {}),
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(answer.error ?? `HTTP ${response.status}`);
    }
}

function show(state) {
    byId('account').textContent = state.signedIn ? (state.email ?? '') : text('notSignedIn');
    byId('city').textContent = state.city;
    const step = state.step ? ` · ${state.step}` : '';
    byId('work').textContent = state.state === 'busy' ? `${text('busy')} ${state.jobId}${step}` : text(state.state);
    byId('error').textContent = state.lastError ? text(state.lastError) : '';
    byId('sign-in').hidden = state.signedIn;
    byId('sign-out').hidden = !state.signedIn;
}

async function poll() {
    const response = await fetch('/state').catch(() => undefined);
    if (response?.ok) {
        show(await response.json());
    }
}

let auth;
const configured = await fetch('/config').catch(() => undefined);
if (configured?.ok) {
    const app = initializeApp(await configured.json());
    auth = auth$.initializeAuth(app, {
        persistence: auth$.inMemoryPersistence,
        popupRedirectResolver: auth$.browserPopupRedirectResolver,
    });
    if (settings.authEmulator) {
        auth$.connectAuthEmulator(auth, `http://${settings.authEmulator}`, { disableWarnings: true });
    }
}

byId('sign-in').addEventListener('click', async () => {
    try {
        if (!auth) {
            throw new Error('configMissing');
        }
        const credential = await auth$.signInWithPopup(auth, new auth$.GoogleAuthProvider());
        const idToken = await credential.user.getIdToken();
        await session('POST', { idToken, refreshToken: credential.user.refreshToken });
        await auth$.signOut(auth);
    } catch (error) {
        byId('error').textContent = text(error.message);
    }
    await poll();
});
byId('sign-out').addEventListener('click', async () => {
    await session('DELETE').catch((error) => {
        byId('error').textContent = text(error.message);
    });
    await poll();
});
await poll();
setInterval(poll, 3000);
"""
)


def render_page(settings: PageSettings) -> bytes:
    """The page with its settings written in."""
    return PAGE_HTML.replace(_SETTINGS_MARK, settings.json()).encode("utf-8")
