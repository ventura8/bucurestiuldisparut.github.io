"""`ObjectStore` over a folder of the owner's computer: the worker's `/work` (docs/research/M7-local-worker.md §1.3).

The USGS delivery (`usgs-raw/`), the job's scratch (`work/`) and the reference cache (`reference/`) live here, so raw
scans never leave the computer. An object is the file at its path under the root; its generation is the file's
modification time in nanoseconds (it changes whenever the file is written again, as a Cloud Storage generation does).
A resumable session is a partial file under `.sessions/` with a small JSON record of its target and size, named by the
address the store hands out (`local-session:<32 hex>`), so a session outlives the process like a Cloud Storage one does
(`fetch` keeps the address in its checkpoint). Uploads are create-only as in `GcsObjectStore`: an identical file there
is kept, a different one replaced; a session's object is created only when it does not exist yet.
"""

import json
import os
import re
import secrets
import shutil
from collections.abc import Iterator
from contextlib import AbstractContextManager
from pathlib import Path
from typing import IO, Final

from hcm_pipeline.objects import ObjectInfo, ObjectStoreError, PreconditionFailedError, SessionExpiredError, md5_of

SESSIONS: Final = ".sessions"
SESSION_PREFIX: Final = "local-session:"
_SESSION: Final = re.compile(r"local-session:([0-9a-f]{32})")
_PART: Final = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}")
_MAX_DEPTH: Final = 12


def _segment(part: str) -> bool:
    return _PART.fullmatch(part) is not None and ".." not in part


def _visible(name: str) -> bool:
    return not name.startswith(".")


def _checked(path: str) -> list[str]:
    """The path's segments; an absolute path, a `..`, an empty or hidden segment is refused (it would leave its prefix)."""
    parts = path.split("/")
    if len(parts) > _MAX_DEPTH or not all(map(_segment, parts)):
        raise ObjectStoreError(f"not an object path of the work folder: {path!r}")
    return parts


class LocalObjectStore:
    """Objects as files under `root` (the work folder)."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def _file(self, path: str) -> Path:
        return self._root.joinpath(*_checked(path))

    def _info(self, path: str, file: Path) -> ObjectInfo:
        status = file.stat()
        return ObjectInfo(path, status.st_size, str(status.st_mtime_ns))

    def stat(self, path: str) -> ObjectInfo | None:
        file = self._file(path)
        return self._info(path, file) if file.is_file() else None

    def upload_file(self, local: Path, path: str, content_type: str) -> ObjectInfo:
        """A copy of `local` at `path`; an identical file already there is kept (its generation unchanged)."""
        existing, file = self.stat(path), self._file(path)
        if existing is not None and existing.size == local.stat().st_size and md5_of(file) == md5_of(local):
            return existing
        file.parent.mkdir(parents=True, exist_ok=True)
        partial = file.with_name(f".{file.name}.{secrets.token_hex(4)}")
        shutil.copyfile(local, partial)
        partial.replace(file)
        return self._info(path, file)

    def download_file(self, path: str, local: Path) -> ObjectInfo:
        file = self._file(path)
        if not file.is_file():
            raise ObjectStoreError(f"no object at {path}")
        shutil.copyfile(file, local)
        return self._info(path, file)

    def open_read(self, path: str) -> AbstractContextManager[IO[bytes]]:
        file = self._file(path)
        if not file.is_file():
            raise ObjectStoreError(f"no object at {path}")
        return file.open("rb")

    def _walk(self) -> Iterator[Path]:
        """Every object's file, sessions and partial uploads left out (both are hidden names)."""
        for folder, folders, files in os.walk(self._root):
            folders[:] = sorted(filter(_visible, folders))
            yield from (Path(folder, name) for name in sorted(filter(_visible, files)))

    def list(self, prefix: str) -> list[ObjectInfo]:
        found = ((file.relative_to(self._root).as_posix(), file) for file in self._walk())
        return [self._info(path, file) for path, file in found if path.startswith(prefix)]

    def delete(self, path: str) -> None:
        self._file(path).unlink(missing_ok=True)

    # --- resumable sessions -------------------------------------------------------------------------------

    def _session(self, session: str) -> tuple[Path, Path]:
        """The session's record and partial file; SessionExpiredError when there is no such session."""
        found = _SESSION.fullmatch(session)
        record = self._root / SESSIONS / f"{found.group(1)}.json" if found else None
        if record is None or not record.is_file():
            raise SessionExpiredError("the local upload session is gone")
        return record, record.with_suffix(".part")

    def start_resumable(self, path: str, size: int, content_type: str) -> str:
        if self.stat(path) is not None:
            raise PreconditionFailedError(f"the local upload of {path}: the object exists")
        name = secrets.token_hex(16)
        folder = self._root / SESSIONS
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{name}.part").write_bytes(b"")
        (folder / f"{name}.json").write_text(json.dumps({"path": path, "size": size}), encoding="utf-8")
        return SESSION_PREFIX + name

    def resumable_offset(self, session: str, size: int) -> int | ObjectInfo:
        record, part = self._session(session)
        return self._state(record, part)

    def write_chunk(self, session: str, offset: int, data: bytes, size: int) -> int | ObjectInfo:
        record, part = self._session(session)
        if data and (not part.is_file() or offset != part.stat().st_size):
            raise ObjectStoreError("the local upload: the chunk does not start where the session ends")
        if data:
            with part.open("ab") as file:
                file.write(data)
        return self._state(record, part)

    def _state(self, record: Path, part: Path) -> int | ObjectInfo:
        """The bytes the session holds, or its object once every byte arrived (created then, create-only)."""
        target = json.loads(record.read_text(encoding="utf-8"))
        path, size = str(target["path"]), int(target["size"])
        if not part.is_file():
            return self._finished(path)
        held = part.stat().st_size
        return held if held < size else self._finish(path, part)

    def _finished(self, path: str) -> ObjectInfo:
        info = self.stat(path)
        if info is None:
            raise SessionExpiredError("the local upload session's object is gone")
        return info

    def _finish(self, path: str, part: Path) -> ObjectInfo:
        file = self._file(path)
        if file.exists():
            raise PreconditionFailedError(f"the local upload of {path}: the object exists")
        file.parent.mkdir(parents=True, exist_ok=True)
        part.replace(file)
        return self._info(path, file)
