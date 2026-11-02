"""The local page's server and its guards (docs/research/M7-local-worker.md §2.1, §2.3, §10.4).

A threading HTTP server (`wsgiref`'s, with `ThreadingMixIn`). Inside the container it listens on every interface, as
Docker's port publishing needs; the command publishes it on the computer's loopback only (`-p 127.0.0.1:8765:8765`).
Every answer carries the page's Content-Security-Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer` and `Cache-Control: no-store`, and no CORS header at all.

| Request | Answer |
| --- | --- |
| any, `Host` not `localhost:<port>` or `127.0.0.1:<port>` (a DNS-rebinding name) | 421 |
| `GET /`, `/page.js`, `/page.css` | the page and its files |
| `GET /config` | the project's web configuration (503 while it cannot be read) |
| `GET /state` | the worker's state; 403 with another `Origin` |
| `POST /session` `{idToken, refreshToken}` | sign in: `worker.hello` must accept the token first (403 with its code) |
| `DELETE /session` | sign out |
| anything else | 404, or 405 for another method |

`POST` and `DELETE` answer 403 unless `Origin` is the page's, the body is JSON (`Content-Type: application/json`, which a
cross-site form cannot send without a preflight nobody answers) and `X-HCM-Worker` is the CSRF token (32 random bytes,
per process, written only into the page).
"""

import hmac
import json
import secrets
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from http import HTTPStatus
from socketserver import ThreadingMixIn
from typing import Any, Final, Protocol
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from wsgiref.types import StartResponse, WSGIEnvironment

from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.page import PAGE_CSS, PAGE_JS, PageSettings, render_page

LOG = get_logger("worker.server")
CSRF_HEADER: Final = "x-hcm-worker"
LOOPBACK_NAMES: Final = ("localhost", "127.0.0.1")
MAX_BODY_BYTES: Final = 16 * 1024
JSON_TYPE: Final = "application/json"
POLL_SECONDS: Final = 0.2
_STATIC: Final = {
    "/page.js": (PAGE_JS.encode("utf-8"), "text/javascript; charset=utf-8"),
    "/page.css": (PAGE_CSS.encode("utf-8"), "text/css; charset=utf-8"),
}


class WorkerApp(Protocol):
    """What the page's requests do (`app.py`)."""

    def web_config(self) -> Mapping[str, str] | None: ...

    def state(self) -> Mapping[str, object]: ...

    def sign_in(self, id_token: object, refresh_token: object) -> str | None: ...

    def sign_out(self) -> None: ...


Reply = tuple[int, bytes, str]


@dataclass(frozen=True)
class Request:
    """One request to the page: its method, path, headers (lower-case names) and body (None when it is too large)."""

    method: str
    path: str
    headers: Mapping[str, str]
    body: bytes | None


def _json(status: int, value: object) -> Reply:
    return status, json.dumps(value).encode("utf-8"), JSON_TYPE


def _headers(environ: WSGIEnvironment) -> dict[str, str]:
    found = {key[5:].replace("_", "-").lower(): str(value) for key, value in environ.items() if key.startswith("HTTP_")}
    return {**found, "content-type": str(environ.get("CONTENT_TYPE") or "")}


def _body(environ: WSGIEnvironment) -> bytes | None:
    size = int(environ.get("CONTENT_LENGTH") or 0)
    return environ["wsgi.input"].read(size) if 0 <= size <= MAX_BODY_BYTES else None


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        LOG.debug("local page: %s", format % args)


class _ThreadingServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class LocalServer:
    """The page's server; `start` serves in a daemon thread, `stop` ends it."""

    def __init__(self, app: WorkerApp, settings: PageSettings, bind: tuple[str, int], content_security_policy: str) -> None:
        self._app = app
        self._settings = settings
        self._httpd = make_server(bind[0], bind[1], self._wsgi, server_class=_ThreadingServer, handler_class=_QuietHandler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, kwargs={"poll_interval": POLL_SECONDS}, daemon=True)
        self.headers: Mapping[str, str] = {
            "Content-Security-Policy": content_security_policy,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
        }

    def _wsgi(self, environ: WSGIEnvironment, start_response: StartResponse) -> Iterable[bytes]:
        method = str(environ["REQUEST_METHOD"])
        request = Request(method, str(environ.get("PATH_INFO") or "/"), _headers(environ), _body(environ))
        status, body, content_type = self.answer(request)
        headers = [*self.headers.items(), ("Content-Type", content_type), ("Content-Length", str(len(body)))]
        start_response(f"{status} {HTTPStatus(status).phrase}", headers)
        return [body]

    def answer(self, request: Request) -> Reply:
        """The reply to a request, every guard applied."""
        if not self.host_allowed(request.headers.get("host")):
            return _json(HTTPStatus.MISDIRECTED_REQUEST, {})
        route = {"GET": self.get, "POST": self.post, "DELETE": self.delete}.get(request.method)
        return route(request) if route is not None else _json(HTTPStatus.METHOD_NOT_ALLOWED, {})

    @staticmethod
    def new_csrf_token() -> str:
        """32 random bytes, as hex: the page's token for its state-changing requests."""
        return secrets.token_hex(32)

    @property
    def port(self) -> int:
        return int(self._httpd.server_address[1])

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        """Ends the serving thread (when it was started) and closes the socket."""
        if self._thread.is_alive():
            self._httpd.shutdown()
            self._thread.join()
        self._httpd.server_close()

    # --- guards ----------------------------------------------------------------------------------------------

    def host_allowed(self, host: str | None) -> bool:
        return host in {f"{name}:{self.port}" for name in LOOPBACK_NAMES}

    def _origin_allowed(self, origin: str | None) -> bool:
        return origin in {f"http://{name}:{self.port}" for name in LOOPBACK_NAMES}

    def _state_change_allowed(self, request: Request) -> bool:
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        token = request.headers.get(CSRF_HEADER, "")
        same_origin = self._origin_allowed(request.headers.get("origin"))
        return same_origin and media_type == JSON_TYPE and hmac.compare_digest(token.encode("utf-8"), self._settings.csrf.encode("utf-8"))

    # --- routes ----------------------------------------------------------------------------------------------

    def get(self, request: Request) -> Reply:
        path = request.path
        routes: dict[str, Callable[[Request], Reply]] = {"/": self._page, "/config": self._config, "/state": self._state}
        if path in _STATIC:
            return HTTPStatus.OK, *_STATIC[path]
        route = routes.get(path)
        return route(request) if route is not None else _json(HTTPStatus.NOT_FOUND, {})

    def _page(self, _request: Request) -> Reply:
        return HTTPStatus.OK, render_page(self._settings), "text/html; charset=utf-8"

    def _config(self, _request: Request) -> Reply:
        config = self._app.web_config()
        return _json(HTTPStatus.OK, config) if config is not None else _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "configMissing"})

    def _state(self, request: Request) -> Reply:
        origin = request.headers.get("origin")
        if origin is not None and not self._origin_allowed(origin):
            return _json(HTTPStatus.FORBIDDEN, {})
        return _json(HTTPStatus.OK, self._app.state())

    def _guarded(self, request: Request, action: Callable[[Mapping[str, object]], Reply]) -> Reply:
        if request.path != "/session":
            return _json(HTTPStatus.NOT_FOUND, {})
        if not self._state_change_allowed(request):
            return _json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        body = request.body
        return action(_parsed(body)) if body is not None else _json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {})

    def post(self, request: Request) -> Reply:
        return self._guarded(request, self._sign_in)

    def delete(self, request: Request) -> Reply:
        return self._guarded(request, self._sign_out)

    def _sign_in(self, body: Mapping[str, object]) -> Reply:
        refused = self._app.sign_in(body.get("idToken"), body.get("refreshToken"))
        return _json(HTTPStatus.FORBIDDEN, {"error": refused}) if refused else _json(HTTPStatus.OK, self._app.state())

    def _sign_out(self, _body: Mapping[str, object]) -> Reply:
        self._app.sign_out()
        return _json(HTTPStatus.OK, self._app.state())


def _parsed(body: bytes) -> Mapping[str, object]:
    try:
        value = json.loads(body or b"{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}
