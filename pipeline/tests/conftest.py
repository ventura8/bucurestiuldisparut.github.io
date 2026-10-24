"""Shared fixtures of the pipeline tests.

- Every test runs behind the loopback-only firewall (tests/fakes/network.py).
- `log_stream`: every test starts with the pipeline's JSON logs going to a fresh in-memory stream
  (never to a stream a previous test closed); request it to read what was logged.
- `fake_m2m`: a fake USGS M2M server on 127.0.0.1:<random port> (tests/fakes/usgs_m2m.py).
- Hypothesis runs the `ci` profile: derandomized, 25 examples, no example database (a run is
  reproducible and writes nothing into the repository), no per-example deadline.
- GDAL and OpenCV run on one thread with a fixed seed (docs/research/M3-interfaces.md §5.6: determinism).
- `synthetic_scene`: one synthetic USGS scene per session (tests/synthetic/scenes.py); `world`: the pipeline's
  loopback world around it (tests/fakes/world.py), fresh for each test.
"""

import io
from collections.abc import Iterator

import pytest
from hcm_pipeline.images import deterministic
from hcm_pipeline.log import configure
from hcm_pipeline.rasters import configure_gdal
from hypothesis import settings

from tests.fakes.network import block_non_loopback
from tests.fakes.usgs_m2m import FakeM2MServer
from tests.fakes.world import PipelineWorld
from tests.synthetic.scenes import Scene, build_scene

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


@pytest.fixture(autouse=True, scope="session")
def single_threaded() -> None:
    configure_gdal("1")
    deterministic(0)


@pytest.fixture(scope="session")
def synthetic_scene(tmp_path_factory: pytest.TempPathFactory) -> Scene:
    return build_scene(tmp_path_factory.mktemp("scene"))


@pytest.fixture
def world(synthetic_scene: Scene) -> Iterator[PipelineWorld]:
    with PipelineWorld(synthetic_scene) as fakes:
        yield fakes
