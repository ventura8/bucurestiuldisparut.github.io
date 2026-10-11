"""Shared fixtures of the pipeline tests.

- Every test runs behind the loopback-only firewall (tests/fakes/network.py).
- `log_stream`: every test starts with the pipeline's JSON logs going to a fresh in-memory stream
  (never to a stream a previous test closed); request it to read what was logged.
- `fake_m2m`: a fake USGS M2M server on 127.0.0.1:<random port> (tests/fakes/usgs_m2m.py).
- Hypothesis runs the `ci` profile: derandomized, 25 examples, no example database (a run is
  reproducible and writes nothing into the repository), no per-example deadline.
"""

import io
from collections.abc import Iterator

import pytest
from hcm_pipeline.log import configure
from hypothesis import settings

from tests.fakes.network import block_non_loopback
from tests.fakes.usgs_m2m import FakeM2MServer

settings.register_profile("ci", derandomize=True, max_examples=25, database=None, deadline=None)
settings.load_profile("ci")


@pytest.fixture(autouse=True)
def block_network(monkeypatch: pytest.MonkeyPatch) -> None:
    block_non_loopback(monkeypatch)


@pytest.fixture(autouse=True)
def log_stream() -> io.StringIO:
    stream = io.StringIO()
    configure(stream)
    return stream


@pytest.fixture
def fake_m2m() -> Iterator[FakeM2MServer]:
    with FakeM2MServer() as server:
        yield server
