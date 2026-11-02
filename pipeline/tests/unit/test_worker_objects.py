"""The worker's object stores: the work folder, the signed URLs and the routing between them (M7 §1.3)."""

import base64
import hashlib
import json
from pathlib import Path

import httpx
import pytest
from hcm_pipeline.objects import ObjectInfo, ObjectStoreError, PreconditionFailedError, SessionExpiredError
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.documents import JobIds
from hcm_pipeline.worker.local_store import LocalObjectStore
from hcm_pipeline.worker.routed import RoutedObjectStore
from hcm_pipeline.worker.signed_store import SignedObjectStore

IDS = JobIds("bucharest", "w-0123456789abcdef", "job-1")
RAW = "usgs-raw/corona2/E1/E1.tgz"
SCAN = "rasters/bucharest/layer-1/job-1/scan.tif"


def md5(data: bytes) -> str:
    return base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode("ascii")


def file_with(folder: Path, name: str, data: bytes) -> Path:
    path = folder / name
    path.write_bytes(data)
    return path


# --- the work folder -------------------------------------------------------------------------------------


def test_happy_path_the_work_folder_keeps_objects_as_files(tmp_path: Path) -> None:
    store = LocalObjectStore(tmp_path / "work")
    first = store.upload_file(file_with(tmp_path, "a.tif", b"segment a"), "work/bucharest/job-1/segments/a.tif", "image/tiff")

    again = store.upload_file(file_with(tmp_path, "same.tif", b"segment a"), "work/bucharest/job-1/segments/a.tif", "image/tiff")
    store.upload_file(file_with(tmp_path, "b.tif", b"segment b"), "work/bucharest/job-1/segments/b.tif", "image/tiff")
    (tmp_path / "work" / "work" / "bucharest" / "job-1" / ".partial").write_bytes(b"x")

    assert again == first
    assert store.stat("work/bucharest/job-1/segments/a.tif") == first
    assert [info.path for info in store.list("work/bucharest/job-1/")] == [
        "work/bucharest/job-1/segments/a.tif",
        "work/bucharest/job-1/segments/b.tif",
    ]
    copy = tmp_path / "copy.tif"
    assert store.download_file(first.path, copy).generation == first.generation
    assert copy.read_bytes() == b"segment a"
    with store.open_read(first.path) as stream:
        assert stream.read() == b"segment a"
    store.delete(first.path)
    store.delete(first.path)
    assert store.stat(first.path) is None


def test_happy_path_a_different_file_replaces_the_object(tmp_path: Path) -> None:
    store = LocalObjectStore(tmp_path)
    store.upload_file(file_with(tmp_path, "one.json", b"{}"), "work/bucharest/job-1/frame.json", "application/json")

    replaced = store.upload_file(file_with(tmp_path, "two.json", b"[]"), "work/bucharest/job-1/frame.json", "application/json")

    assert (tmp_path / "work/bucharest/job-1/frame.json").read_bytes() == b"[]"
    assert replaced.size == 2


@pytest.mark.parametrize("path", ["../escape", "/etc/passwd", "work//x", ".sessions/abc.part", "work/a/../../x", "work/x\\y"])
def test_bad_path_a_path_that_would_leave_its_prefix_is_refused(tmp_path: Path, path: str) -> None:
    with pytest.raises(ObjectStoreError):
        LocalObjectStore(tmp_path).stat(path)


def test_bad_path_reading_a_missing_object_fails(tmp_path: Path) -> None:
    store = LocalObjectStore(tmp_path)

    with pytest.raises(ObjectStoreError):
        store.download_file(RAW, tmp_path / "x")
    with pytest.raises(ObjectStoreError):
        store.open_read(RAW)


def test_happy_path_a_resumable_session_outlives_the_store_and_creates_its_object(tmp_path: Path) -> None:
    session = LocalObjectStore(tmp_path).start_resumable(RAW, 6, "application/octet-stream")
    assert session.startswith("local-session:")
    assert LocalObjectStore(tmp_path).write_chunk(session, 0, b"abc", 6) == 3
    assert LocalObjectStore(tmp_path).resumable_offset(session, 6) == 3
    assert LocalObjectStore(tmp_path).list("usgs-raw/") == []

    finished = LocalObjectStore(tmp_path).write_chunk(session, 3, b"def", 6)

    assert isinstance(finished, ObjectInfo)
    assert (finished.path, finished.size) == (RAW, 6)
    assert (tmp_path / RAW).read_bytes() == b"abcdef"
    assert LocalObjectStore(tmp_path).resumable_offset(session, 6) == finished
    assert LocalObjectStore(tmp_path).write_chunk(session, 6, b"", 6) == finished


def test_bad_path_a_session_refuses_what_cloud_storage_would(tmp_path: Path) -> None:
    store = LocalObjectStore(tmp_path)
    session = store.start_resumable(RAW, 4, "application/octet-stream")

    with pytest.raises(ObjectStoreError, match="does not start"):
        store.write_chunk(session, 2, b"zz", 4)
    with pytest.raises(SessionExpiredError):
        store.resumable_offset("local-session:" + "0" * 32, 4)
    with pytest.raises(SessionExpiredError):
        store.resumable_offset("https://storage.googleapis.com/upload?id=x", 4)
    (tmp_path / RAW).parent.mkdir(parents=True)
    (tmp_path / RAW).write_bytes(b"won")
    with pytest.raises(PreconditionFailedError):
        store.write_chunk(session, 0, b"abcd", 4)
    with pytest.raises(PreconditionFailedError):
        store.start_resumable(RAW, 4, "application/octet-stream")


def test_bad_path_a_finished_session_whose_object_was_deleted_is_gone(tmp_path: Path) -> None:
    store = LocalObjectStore(tmp_path)
    session = store.start_resumable(RAW, 2, "application/octet-stream")
    store.write_chunk(session, 0, b"ok", 2)
    store.delete(RAW)

    with pytest.raises(SessionExpiredError):
        store.resumable_offset(session, 2)


# --- the signed URLs ---------------------------------------------------------------------------------------


class SignedServer:
    """`worker.urls` and the URLs it signs, as Cloud Storage answers them (`method`: what the server says to send)."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.sent: list[httpx.Request] = []
        self.upload_method = "PUT"
        self.generation_in = "header"
        self.status = 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/worker-urls"):
            return self._sign(json.loads(request.content)["data"]["request"]["objects"][0])
        self.sent.append(request)
        path = request.url.path.removeprefix("/bucket/")
        return self._get(path) if request.method == "GET" else self._put(path, request.content)

    def _sign(self, wanted: dict[str, str]) -> httpx.Response:
        path, stored = wanted["path"], self.objects.get(wanted["path"])
        meta = {"exists": True, "size": len(stored[0]), "generation": stored[1], "md5": md5(stored[0])} if stored else {"exists": False}
        method = wanted["method"] if wanted["method"] == "GET" else self.upload_method
        url = f"https://storage.googleapis.com/bucket/{path}?X-Goog-Signature=secret"
        signed = {"path": path, "url": url, "method": method, "headers": {"x-goog-test": "1"}, "expiresAt": "2026-11-02T12:00:00Z"}
        return httpx.Response(200, json={"result": {"objects": [{**signed, **meta}]}})

    def _get(self, path: str) -> httpx.Response:
        stored = self.objects.get(path)
        if stored is None or self.status != 200:
            return httpx.Response(404 if stored is None else self.status)
        return httpx.Response(200, content=stored[0], headers={"x-goog-generation": stored[1]} if self.generation_in == "header" else {})

    def _put(self, path: str, body: bytes) -> httpx.Response:
        if self.status != 200:
            return httpx.Response(self.status)
        self.objects[path] = (body, str(17 + len(self.objects)))
        answers = {
            "header": httpx.Response(200, headers={"x-goog-generation": self.objects[path][1]}),
            "json": httpx.Response(200, json={"name": path, "generation": self.objects[path][1]}),
        }
        return answers.get(self.generation_in, httpx.Response(200, text="ok"))


def signed_store(server: SignedServer) -> SignedObjectStore:
    client = httpx.Client(transport=httpx.MockTransport(server))
    api = WorkerApi(client, lambda name: f"https://functions.example/{name}", lambda: "t", lambda _seconds: None)
    return SignedObjectStore(api, IDS, client)


@pytest.mark.parametrize("generation_in", ["header", "json", "none"])
def test_happy_path_a_version_file_goes_up_its_signed_url(tmp_path: Path, generation_in: str) -> None:
    server = SignedServer()
    server.generation_in = generation_in
    server.upload_method = "POST" if generation_in == "json" else "PUT"
    store = signed_store(server)

    info = store.upload_file(file_with(tmp_path, "scan.tif", b"scan bytes"), SCAN, "image/tiff")

    assert info == ObjectInfo(SCAN, 10, "17", md5(b"scan bytes"))
    upload = server.sent[0]
    assert (upload.method, upload.content, upload.headers["content-type"], upload.headers["x-goog-test"]) == (
        server.upload_method,
        b"scan bytes",
        "image/tiff",
        "1",
    )
    assert store.stat(SCAN) == ObjectInfo(SCAN, 10, "17", md5(b"scan bytes"))
    assert store.stat("rasters/bucharest/layer-1/job-1/cog.tif") is None


def test_happy_path_an_identical_object_is_kept_and_reads_stream(tmp_path: Path) -> None:
    server = SignedServer()
    server.objects[SCAN] = (b"scan bytes", "42")
    store = signed_store(server)

    kept = store.upload_file(file_with(tmp_path, "scan.tif", b"scan bytes"), SCAN, "image/tiff")
    copy = store.download_file(SCAN, tmp_path / "copy.tif")
    server.generation_in = "none"
    second = store.download_file(SCAN, tmp_path / "again.tif")
    with store.open_read(SCAN) as stream:
        read = stream.read()

    assert kept.generation == "42"
    assert [request.method for request in server.sent] == ["GET", "GET", "GET"]
    assert (copy.generation, second.generation, (tmp_path / "copy.tif").read_bytes(), read) == ("42", "42", b"scan bytes", b"scan bytes")


def test_bad_path_signed_requests_that_fail_raise(tmp_path: Path) -> None:
    server = SignedServer()
    store = signed_store(server)

    with pytest.raises(ObjectStoreError, match="no object"):
        store.download_file(SCAN, tmp_path / "x")
    server.objects[SCAN] = (b"x", "1")
    server.status = 403
    with pytest.raises(ObjectStoreError, match="HTTP 403"):
        store.upload_file(file_with(tmp_path, "y.tif", b"y"), SCAN, "image/tiff")
    with pytest.raises(ObjectStoreError, match="HTTP 403"), store.open_read(SCAN):
        pass


def test_bad_path_an_answer_for_another_object_is_refused(tmp_path: Path) -> None:
    def wrong(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"result": {"objects": [{"path": "rasters/other.tif", "url": "https://x", "method": "GET"}]}})

    client = httpx.Client(transport=httpx.MockTransport(wrong))
    store = SignedObjectStore(
        WorkerApi(client, lambda name: f"https://functions.example/{name}", lambda: "t", lambda _seconds: None), IDS, client
    )

    with pytest.raises(ObjectStoreError, match="signed no URL"):
        store.stat(SCAN)


def test_bad_path_listing_deleting_and_sessions_are_never_signed() -> None:
    store = signed_store(SignedServer())

    for attempt in (
        lambda: store.list("rasters/"),
        lambda: store.delete(SCAN),
        lambda: store.start_resumable(SCAN, 1, "image/tiff"),
        lambda: store.resumable_offset("s", 1),
        lambda: store.write_chunk("s", 0, b"", 1),
    ):
        with pytest.raises(ObjectStoreError, match="not available through signed URLs"):
            attempt()


# --- the routing --------------------------------------------------------------------------------------------


def test_happy_path_raw_and_scratch_stay_local_and_version_files_are_signed(tmp_path: Path) -> None:
    server = SignedServer()
    local = LocalObjectStore(tmp_path / "work")
    store = RoutedObjectStore(local, signed_store(server))

    session = store.start_resumable(RAW, 3, "application/octet-stream")
    store.write_chunk(session, 0, b"raw", 3)
    store.upload_file(file_with(tmp_path, "s.tif", b"s"), "reference/bucharest/s2/abcdef12.tif", "image/tiff")
    store.upload_file(file_with(tmp_path, "scan.tif", b"scan"), SCAN, "image/tiff")

    assert store.resumable_offset(session, 3) == local.stat(RAW)
    assert [info.path for info in store.list("usgs-raw/")] == [RAW]
    assert store.stat(SCAN) is not None
    assert store.download_file(RAW, tmp_path / "raw").size == 3
    with store.open_read(RAW) as stream:
        assert stream.read() == b"raw"
    store.delete(RAW)
    assert local.stat(RAW) is None
    assert [request.url.path for request in server.sent] == [f"/bucket/{SCAN}"]


def test_bad_path_an_object_of_no_known_prefix_has_no_store(tmp_path: Path) -> None:
    store = RoutedObjectStore(LocalObjectStore(tmp_path), signed_store(SignedServer()))

    with pytest.raises(ObjectStoreError, match="no store"):
        store.stat("usgs-browse/corona2/E1.jpg")
