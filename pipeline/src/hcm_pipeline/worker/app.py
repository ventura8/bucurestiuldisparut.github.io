"""What the local page's requests do (docs/research/M7-local-worker.md §1.2, §2.1-§2.3).

Sign in: the tokens must be usable, the project's web configuration readable (the refresh needs its API key), and
`worker.hello {cityId, workerId, version}` must accept the ID token (a token of another project, or of an account
that is not an editor of the city, is refused at once and the page shows the code) before the worker keeps it; its
answer sets how often the worker claims and how often the heartbeat writes. Sign out forgets the tokens; the loop then
stops claiming.
"""

from collections.abc import Mapping
from typing import Final

from hcm_pipeline import __version__
from hcm_pipeline.contract import Errors
from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.api import HELLO, WorkerApi, WorkerApiError
from hcm_pipeline.worker.session import SIGNED_OUT, Session, Tokens
from hcm_pipeline.worker.state import WorkerState
from hcm_pipeline.worker.webconfig import WebConfig, WebConfigError

LOG = get_logger("worker.app")
CONFIG_MISSING: Final = "configMissing"


def _seconds(answer: Mapping[str, object], key: str) -> float | None:
    value = answer.get(key)
    return float(value) if isinstance(value, int | float) and value > 0 else None


class PageActions:
    """The worker's side of the page (`server.WorkerApp`)."""

    def __init__(self, session: Session, api: WorkerApi, state: WorkerState, web_config: WebConfig, hello: Mapping[str, str]) -> None:
        self._session = session
        self._api = api
        self._state = state
        self._web_config = web_config
        self._hello = {**hello, "version": __version__}

    def web_config(self) -> Mapping[str, str] | None:
        try:
            return self._web_config.get()
        except WebConfigError as error:
            LOG.warning("the project's web configuration is unreadable: %s", error)
            return None

    def state(self) -> Mapping[str, object]:
        return self._state.snapshot()

    def sign_in(self, id_token: object, refresh_token: object) -> str | None:
        """None when the session began, else the code the page shows."""
        try:
            tokens = Tokens.of(id_token, refresh_token)
        except ValueError:
            return Errors.INVALID_REQUEST
        if self.web_config() is None:
            return CONFIG_MISSING
        try:
            answer = self._api.call(HELLO, self._hello, token=tokens.id_token)
        except WorkerApiError as error:
            LOG.warning("worker.hello refused the sign-in: %s", error.code)
            return error.code
        self._state.timing.poll_seconds = _seconds(answer, "pollSeconds") or self._state.timing.poll_seconds
        self._state.timing.heartbeat_seconds = _seconds(answer, "heartbeatSeconds")
        self._session.begin(tokens)
        self._state.failed(None)
        LOG.info("signed in; the worker claims the city's local jobs")
        return None

    def sign_out(self) -> None:
        self._session.end(SIGNED_OUT)
        LOG.info("signed out; the worker stops claiming")
