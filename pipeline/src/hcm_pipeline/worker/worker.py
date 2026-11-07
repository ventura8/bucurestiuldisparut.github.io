"""The worker assembled from its parts (docs/research/M7-local-worker.md §1): the session, the callables, the page's
server, the job runtime and the loop; `serve` runs the page in a thread and the loop in the calling (main) thread.
Finding 67 of 2026-11-02: the connector (`pairing.py`) signs it in from the command's pairing code or the session kept
in the work folder, so the page is for its state only (its Google sign-in stays as the fallback).
"""

import os
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

import httpx

from hcm_pipeline.log import get_logger
from hcm_pipeline.services import default_steps, http
from hcm_pipeline.worker.ai_state import initial_state
from hcm_pipeline.worker.api import WorkerApi
from hcm_pipeline.worker.app import PageActions
from hcm_pipeline.worker.args import WorkerArgs
from hcm_pipeline.worker.loop import WorkerLoop
from hcm_pipeline.worker.page import PageSettings, content_security_policy
from hcm_pipeline.worker.pairing import Connector, Pairing, SessionFile, Signer
from hcm_pipeline.worker.runtime import StepsFactory, WorkerRuntime
from hcm_pipeline.worker.server import LocalServer
from hcm_pipeline.worker.session import Session
from hcm_pipeline.worker.state import WorkerState
from hcm_pipeline.worker.webconfig import WebConfig

LOG = get_logger("worker")
# Inside the container the page listens on every interface, which Docker's port publishing needs; the command publishes
# it on the computer's loopback only (`-p 127.0.0.1:8765:8765`), and the Host and Origin checks refuse anything else.
EVERY_INTERFACE: Final = ""
WORKER_ID_PREFIX: Final = "w-"


def new_worker_id() -> str:
    """`w-` and 16 hex characters (`WORKER_ID_PATTERN`), kept in the work folder across restarts (`SessionFile.worker_id`)."""
    return WORKER_ID_PREFIX + secrets.token_hex(8)


@dataclass(frozen=True)
class Worker:
    session: Session
    api: WorkerApi
    state: WorkerState
    actions: PageActions
    server: LocalServer
    loop: WorkerLoop
    runtime: WorkerRuntime
    client: httpx.Client
    worker_id: str
    connector: Connector

    @classmethod
    def build(
        cls,
        args: WorkerArgs,
        bind_host: str = EVERY_INTERFACE,
        clock: Callable[[], float] = time.time,
        steps: StepsFactory = default_steps,
    ) -> Worker:
        session_file = SessionFile(args.work, args.city)
        worker_id = session_file.worker_id(new_worker_id)
        client = http()
        web_config = WebConfig(client, args.endpoints.init_json, args.project)
        session = Session(
            client, lambda: f"{args.endpoints.securetoken}?key={web_config.api_key()}", clock, {"Referer": args.endpoints.referer}
        )
        api = WorkerApi(client, args.endpoints.function, session.bearer, time.sleep)
        state = WorkerState(args.city, args.project, session, worker_id)
        state.set_ai(initial_state(os.environ))
        ids = {"cityId": args.city, "workerId": worker_id}
        # Finding 72: the image the starter's supervisor runs, which `worker.hello` compares with the installed one.
        actions = PageActions(session, api, state, web_config, {**ids, **({"image": args.image} if args.image else {})})
        emulators = [host for host in (args.endpoints.auth_emulator,) if host]
        settings = PageSettings(args.project, args.city, LocalServer.new_csrf_token(), args.endpoints.auth_emulator)
        policy = content_security_policy(args.project, emulators)
        server = LocalServer(actions, settings, (bind_host, args.port), policy, args.endpoints.hosting_origins)
        runtime = WorkerRuntime(args, api, worker_id, state, steps)
        runtime.clock = clock
        runtime.announce_ai = actions.announce_ai
        pairing = Pairing(client, api, args.endpoints, web_config, args.city)
        loop = WorkerLoop(session, api, state, runtime, ids)
        connector = Connector(pairing, session_file, Signer(session, actions, state.failed, loop.stop), args.pair, clock)
        actions.accept_pairing(connector.offer)
        loop.connect_with(connector)
        loop.sweep = runtime.sweep
        loop.supervised = args.supervised
        return cls(session, api, state, actions, server, loop, runtime, client, worker_id, connector)

    def serve(self) -> None:
        """The page in a thread, the loop here, until SIGTERM or Ctrl-C."""
        self.server.start()
        LOG.info(
            "worker %s: open http://localhost:%d/ to see what it does (the admin's command signs it in)", self.worker_id, self.server.port
        )
        try:
            self.loop.run()
        finally:
            self.close()
            LOG.info("worker %s stopped", self.worker_id)

    def close(self) -> None:
        """The page's socket and every client closed (the tokens go with the process)."""
        self.server.stop()
        self.runtime.close()
        self.client.close()
