"""Pairing: the admin's command signs the worker in without a browser (finding 67 of 2026-11-02, M7 §2.6).

The real worker built from its arguments, the connector driven by the loop's passes, against the fake server side of
`tests/fakes/worker_api.py` (its `worker-pair` and Identity Toolkit's custom-token sign-in); the work folder is the
test's, as the named volume would be; time is a controlled clock.
"""

import json
import stat
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from hcm_pipeline.worker.args import Endpoints, WorkerArgs
from hcm_pipeline.worker.loop import Pass
from hcm_pipeline.worker.pairing import RETRY_SECONDS, Kept, SessionFile, code_hash
from hcm_pipeline.worker.worker import Worker

from tests.fakes.documents import MemoryStore
from tests.fakes.http import FakeHttpServer
from tests.fakes.worker_api import OWNER_EMAIL, PROJECT, FakeWorkerApi
from tests.fakes.world import CITY, FakeClock

CODE = "abcdefghijklmnopqrstuvwxyz"
NEW_CODE = "bcdefghijklmnopqrstuvwxyza"
PAIR = "a" * 40
NEW_PAIR = "b" * 40


@dataclass
class World:
    api: FakeWorkerApi
    clock: FakeClock
    folder: Path
    server: FakeHttpServer

    def worker(self, code: str | None = CODE) -> Worker:
        endpoints = Endpoints.emulated(PROJECT, self.api.env())
        args = WorkerArgs(city=CITY, project=PROJECT, port=0, work=self.folder, emulators=True, endpoints=endpoints, pair=code)
        return Worker.build(args, "127.0.0.1", self.clock)

    def kept(self) -> Kept | None:
        return SessionFile(self.folder, CITY).load()


@pytest.fixture
def world(tmp_path: Path) -> Iterator[World]:
    clock = FakeClock()
    with FakeHttpServer() as server:
        api = FakeWorkerApi(MemoryStore(), server, clock).install()
        api.pair_codes[CODE] = PAIR
        yield World(api, clock, tmp_path, server)


def once(worker: Worker) -> Pass:
    try:
        return worker.loop.run_once()
    finally:
        worker.close()


def test_happy_path_the_commands_code_signs_the_worker_in_and_keeps_the_session(world: World) -> None:
    """Scenarios: S-P04-HAPPY-PAIR"""
    worker = world.worker()

    assert once(worker) is Pass.IDLE

    names = world.api.names()
    assert names[:3] == ["worker-pair", "worker-hello", "worker-claim"]
    pair_call = world.api.calls[0]
    assert pair_call.token == ""
    assert pair_call.data == {"cityId": CITY, "code": CODE}
    assert worker.session.email == OWNER_EMAIL
    assert world.api.referers == [f"http://{world.api.host}/"]
    kept = world.kept()
    assert kept is not None
    assert (kept.pair_id, kept.code_hash) == (PAIR, code_hash(CODE))
    path = SessionFile(world.folder, CITY).path
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert CODE not in path.read_text("utf-8")


def test_happy_path_a_restart_with_the_same_command_resumes_the_kept_session(world: World) -> None:
    """Scenarios: S-P04-HAPPY-PAIR"""
    once(world.worker())
    world.api.calls.clear()

    restarted = world.worker()

    assert once(restarted) is Pass.IDLE
    assert world.api.names()[:2] == ["worker-hello", "worker-claim"]
    assert world.api.refreshes == 1


def test_happy_path_a_new_command_pairs_again_and_names_the_pairing_it_replaces(world: World) -> None:
    once(world.worker())
    world.api.pair_codes[NEW_CODE] = NEW_PAIR

    assert once(world.worker(NEW_CODE)) is Pass.IDLE

    assert world.api.calls[-3].data == {"cityId": CITY, "code": NEW_CODE, "replaces": PAIR}
    kept = world.kept()
    assert kept is not None
    assert kept.pair_id == NEW_PAIR


def test_bad_path_a_used_code_is_refused_and_the_page_says_why(world: World) -> None:
    """Scenarios: S-P04-BAD-PAIR-REFUSED"""
    world.api.pair_codes.clear()
    worker = world.worker()

    assert once(worker) is Pass.NO_SESSION

    assert world.api.names() == ["worker-pair"]
    assert world.kept() is None
    assert not worker.session.active
    assert worker.state.snapshot()["lastError"] == "apiError.worker.pairCode"


def test_bad_path_a_refused_new_code_falls_back_to_the_kept_session(world: World) -> None:
    once(world.worker())

    assert once(world.worker(NEW_CODE)) is Pass.IDLE

    kept = world.kept()
    assert kept is not None
    assert kept.pair_id == PAIR


def test_bad_path_a_server_out_of_reach_is_tried_again_later(world: World) -> None:
    """Scenarios: S-P04-BAD-PAIR-REFUSED"""
    world.api.pair_refusal = "apiError.unavailable"
    worker = world.worker()
    try:
        assert worker.loop.run_once() is Pass.NO_SESSION
        assert worker.loop.run_once() is Pass.NO_SESSION
        assert world.api.names() == ["worker-pair"]

        world.api.pair_refusal = None
        world.clock.now += RETRY_SECONDS
        assert worker.loop.run_once() is Pass.IDLE
    finally:
        worker.close()


def test_bad_path_a_revoked_kept_session_is_deleted(world: World) -> None:
    """Scenarios: S-P04-BAD-REVOKED"""
    once(world.worker())
    world.api.hello_refusal = "apiError.worker.revoked"

    worker = world.worker()
    assert once(worker) is Pass.NO_SESSION

    assert world.kept() is None
    assert worker.state.snapshot()["lastError"] == "apiError.worker.revoked"


def test_bad_path_a_kept_session_google_refuses_is_deleted(world: World) -> None:
    once(world.worker())
    world.api.refresh_tokens.clear()

    assert once(world.worker()) is Pass.NO_SESSION

    assert world.kept() is None


def test_bad_path_disconnect_during_work_ends_the_session_and_forgets_it(world: World) -> None:
    """Scenarios: S-P04-BAD-REVOKED"""
    worker = world.worker()
    try:
        assert worker.loop.run_once() is Pass.IDLE
        world.api.claim_refusal = "apiError.worker.revoked"
        assert worker.loop.run_once() is Pass.IDLE

        assert not worker.session.active
        assert world.kept() is None
        assert worker.loop.run_once() is Pass.NO_SESSION
        assert world.api.names().count("worker-pair") == 1
    finally:
        worker.close()


def test_bad_path_an_outdated_worker_says_so_on_its_page(world: World) -> None:
    """Scenarios: S-P04-BAD-OUTDATED"""
    world.api.hello_answer = {**world.api.hello_answer, "outdated": True}
    world.api.claim_extra = {"outdated": True}
    worker = world.worker()
    try:
        assert worker.loop.run_once() is Pass.IDLE
        assert worker.state.snapshot()["outdated"] is True
        world.api.claim_extra = {"outdated": False}
        assert worker.loop.run_once() is Pass.IDLE
        assert worker.state.snapshot()["outdated"] is False
    finally:
        worker.close()


def test_bad_path_a_broken_kept_file_is_ignored(world: World) -> None:
    path = SessionFile(world.folder, CITY).path
    path.write_text(json.dumps({"refreshToken": "x", "pairId": "nope"}), "utf-8")

    assert SessionFile(world.folder, CITY).load() is None
    path.write_text("{", "utf-8")
    assert SessionFile(world.folder, CITY).load() is None
    SessionFile(world.folder, CITY).clear()
    SessionFile(world.folder, CITY).clear()
    assert not path.exists()


def test_bad_path_a_custom_token_the_sign_in_service_refuses_leaves_no_session(world: World) -> None:
    world.api.custom_sign_in_refused = True
    worker = world.worker()

    assert once(worker) is Pass.NO_SESSION
    assert world.kept() is None
    assert worker.state.snapshot()["lastError"] == "apiError.unauthenticated"
