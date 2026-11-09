"""The worker page's import of a local archive (docs/research/M20-import-local.md §2.1): loopback only, the page's own origin and token.

Files go over real HTTP to the worker's server; the scan's report goes to a fake of `worker.archiveReport`.
"""

import io
import json
import zipfile
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.worker.args import Endpoints
from hcm_pipeline.worker.import_page import render_import_page
from hcm_pipeline.worker.imports import ImportRoutes, chunks_of
from hcm_pipeline.worker.page import PageSettings, content_security_policy
from hcm_pipeline.worker.server import LocalServer, Request

from tests.fakes.worker_api import PROJECT

CSRF = "b" * 64
SETTINGS = PageSettings(PROJECT, "bucharest", CSRF)


class Reports:
    """`worker.archiveReport` as the routes call it: what was sent, and an answer or a refusal."""

    def __init__(self) -> None:
        self.sent: list[dict[str, object]] = []
        self.refusal: Exception | None = None

    def __call__(self, body: dict[str, object]) -> Mapping[str, object]:
        if self.refusal is not None:
            raise self.refusal
        self.sent.append(body)
        series = body["series"]
        return {"archiveId": body["archiveId"], "series": len(series) if isinstance(series, list) else 0}


class RefusedError(RuntimeError):
    """A callable's refusal with its code, as `WorkerApiError` carries one."""

    code = "apiError.imagery.archiveImported"


class App:
    def web_config(self) -> Mapping[str, str] | None:
        return None

    def state(self) -> Mapping[str, object]:
        return {}

    def sign_in(self, id_token: object, refresh_token: object) -> str | None:
        return None

    def sign_out(self) -> None:
        return

    def pair(self, code: object) -> str | None:
        return None


def probed(path: Path) -> Probe:
    return Probe("jpeg", 4000, 3000, 3, 8, "rgb") if path.suffix == ".jpg" else Probe("unknown")


@pytest.fixture
def served(tmp_path: Path) -> Iterator[tuple[LocalServer, ImportRoutes, Reports]]:
    reports = Reports()
    routes = ImportRoutes(
        ArchiveStore(tmp_path / "work", probed), reports, now=lambda: datetime(2026, 11, 9, tzinfo=UTC), start=lambda work: work()
    )
    local = LocalServer(App(), SETTINGS, ("127.0.0.1", 0), content_security_policy(PROJECT), Endpoints.cloud(PROJECT).hosting_origins)
    local.serve_imports(routes)
    local.start()
    try:
        yield local, routes, reports
    finally:
        local.stop()


def base(local: LocalServer) -> str:
    return f"http://127.0.0.1:{local.port}"


def own(local: LocalServer, **headers: str) -> dict[str, str]:
    return {"origin": base(local), "x-hcm-worker": CSRF, **headers}


def post(local: LocalServer, path: str, body: object, **headers: str) -> httpx.Response:
    return httpx.post(f"{base(local)}{path}", json=body, headers=own(local, **headers))


def test_happy_path_a_folder_is_streamed_scanned_and_reported(served: tuple[LocalServer, ImportRoutes, Reports]) -> None:
    """Scenarios: S-P20-HAPPY-INTAKE, S-P20-HAPPY-REPORT"""
    local, routes, reports = served
    archive_id = post(local, "/import/new", {}).json()["archiveId"]

    sent = httpx.post(
        f"{base(local)}/import/{archive_id}/file",
        content=b"a map",
        headers=own(local, **{"content-type": "application/octet-stream", "x-hcm-path": "H%C4%83r%C8%9Bi/1911%20plan.jpg"}),
    )
    junk = httpx.post(
        f"{base(local)}/import/{archive_id}/file",
        content=b"junk",
        headers=own(local, **{"content-type": "application/octet-stream", "x-hcm-path": "H%C4%83r%C8%9Bi/Thumbs.db"}),
    )
    started = post(local, f"/import/{archive_id}/scan", {"name": "Hărți", "source": "folder", "latitude": 44.43})
    state = httpx.get(f"{base(local)}/import/{archive_id}").json()

    assert (sent.status_code, sent.json(), junk.status_code) == (201, {"path": "Hărți/1911 plan.jpg"}, 201)
    assert started.status_code == 202
    assert routes.states[archive_id] == state
    assert state == {"state": "reported", "series": 1, "skipped": {"not-a-map": 1}}
    body = reports.sent[-1]
    # The archive's size counts every file, the skipped ones too.
    assert (body["name"], body["source"], body["fileCount"], body["bytes"]) == ("Hărți", "folder", 2, 9)
    assert "work" not in json.dumps(body)


def test_happy_path_a_zip_is_uploaded_then_read_in_place(served: tuple[LocalServer, ImportRoutes, Reports], tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-INTAKE"""
    local, routes, _reports = served
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("Harti/a.jpg", b"one")
        archive.writestr("../b.jpg", b"two")
    archive_id = post(local, "/import/new", {}).json()["archiveId"]
    headers = own(local, **{"content-type": "application/zip", "x-hcm-path": "harti.zip"})
    httpx.post(f"{base(local)}/import/{archive_id}/file", content=data.getvalue(), headers=headers)

    answer = post(local, f"/import/{archive_id}/zip", {"path": "harti.zip"})

    assert (answer.status_code, answer.json()) == (200, {"written": 1, "refused": 1})
    assert [path.name for path in routes.store.files(archive_id).rglob("*")] == ["Harti", "a.jpg"]
    assert post(local, f"/import/{archive_id}/zip", {"path": "harti.zip"}).status_code == 404


def test_bad_path_another_site_or_a_missing_token_posts_nothing(served: tuple[LocalServer, ImportRoutes, Reports]) -> None:
    """Scenarios: S-P20-BAD-ZIP-SLIP"""
    local, routes, _reports = served
    archive_id = post(local, "/import/new", {}).json()["archiveId"]
    upload = f"{base(local)}/import/{archive_id}/file"

    answers = {
        "another origin": httpx.post(upload, content=b"x", headers={**own(local), "origin": "https://evil.example"}).status_code,
        "no token": httpx.post(upload, content=b"x", headers={"origin": base(local), "x-hcm-path": "a.jpg"}).status_code,
        "an unsafe path": httpx.post(upload, content=b"x", headers=own(local, **{"x-hcm-path": "..%2F..%2Fx.jpg"})).status_code,
        "a new archive from another site": httpx.post(
            f"{base(local)}/import/new", json={}, headers={"origin": "https://evil.example"}
        ).status_code,
        "a scan of no archive": post(local, "/import/ar-zz/scan", {}).status_code,
        "an unknown action": post(local, f"/import/{archive_id}/delete", {}).status_code,
        "a body too large": post(local, f"/import/{archive_id}/scan", {"x": "y" * 20_000}).status_code,
        "a zip refused": post(local, f"/import/{archive_id}/zip", {"path": "../../etc/passwd"}).status_code,
        "a zip not there": post(local, f"/import/{archive_id}/zip", {"path": "harti.zip"}).status_code,
        "the state of no scan": httpx.get(f"{base(local)}/import/{archive_id}").status_code,
        "a nested path": httpx.get(f"{base(local)}/import/{archive_id}/x").status_code,
    }

    assert answers == {
        "another origin": 403,
        "no token": 403,
        "an unsafe path": 400,
        "a new archive from another site": 403,
        "a scan of no archive": 404,
        "an unknown action": 404,
        "a body too large": 413,
        "a zip refused": 400,
        "a zip not there": 404,
        "the state of no scan": 404,
        "a nested path": 404,
    }
    assert list(routes.store.files(archive_id).iterdir()) == []


def test_bad_path_a_scan_the_server_refuses_is_a_failed_state_the_page_shows(served: tuple[LocalServer, ImportRoutes, Reports]) -> None:
    """Scenarios: S-P20-BAD-REPORT-REFUSED"""
    local, routes, reports = served
    archive_id = post(local, "/import/new", {}).json()["archiveId"]
    reports.refusal = RefusedError("refused")

    post(local, f"/import/{archive_id}/scan", {"latitude": True})

    assert routes.states[archive_id] == {"state": "failed", "error": "apiError.imagery.archiveImported"}


def test_bad_path_a_misdirected_upload_or_one_with_no_routes_is_refused(tmp_path: Path) -> None:
    local = LocalServer(App(), SETTINGS, ("127.0.0.1", 0), content_security_policy(PROJECT))
    try:
        headers = {"host": "evil.example:1", "origin": f"http://127.0.0.1:{local.port}", "x-hcm-worker": CSRF}
        assert local.upload(Request("POST", "/import/x/file", headers, b""), "x", io.BytesIO(), 0)[0] == 421
        assert (
            local.upload(Request("POST", "/import/x/file", {**headers, "host": f"127.0.0.1:{local.port}"}, b""), "x", io.BytesIO(), 0)[0]
            == 403
        )
        assert local.answer(Request("GET", f"/import/{'ar-' + '0' * 16}", {"host": f"127.0.0.1:{local.port}"}, b""))[0] == 404
    finally:
        local.stop()


def test_happy_path_the_import_page_carries_the_token_and_its_two_languages() -> None:
    page = render_import_page(SETTINGS.json()).decode("utf-8")

    assert CSRF in page
    assert 'src="/import.js"' in page
    assert list(chunks_of(io.BytesIO(b"abc"), 10)) == [b"abc"]
    assert list(chunks_of(io.BytesIO(b"abcdef"), 4)) == [b"abcd"]
