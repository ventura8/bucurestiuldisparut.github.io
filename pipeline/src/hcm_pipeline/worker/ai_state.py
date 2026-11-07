"""What the worker says of its local AI (docs/research/M10-local-ai.md *What the admin sees*): `workerDocSchema.ai` for the panel, and
`/state`'s `ai` for the starter file, which polls `wanted`, `image` and `files`. Light on purpose: the page's state imports it."""

import errno
import platform
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

STARTER_VERSION: Final = "2"
ENV_STARTER: Final = "HCM_STARTER"
# The machine Docker itself runs on, as the starter asks it: an amd64 image under Rosetta or QEMU reads x86_64 from inside.
ENV_DOCKER_ARCH: Final = "HCM_DOCKER_ARCH"
UNSUPPORTED_MACHINES: Final = frozenset({"aarch64", "arm64"})
# What the admin's panel says (`adminWorker.ai.why.*`).
WHY_OLD_STARTER: Final = "old-starter"
WHY_ARM64: Final = "arm64"
WHY_NO_ANSWER: Final = "no-answer"
WHY_DISK: Final = "disk"
FULL_DISK: Final = frozenset({errno.ENOSPC, errno.EDQUOT})


@dataclass(frozen=True)
class AiState:
    """What the panel shows of the AI (`workerDocSchema.ai`) and what `/state` tells the starter (`wanted`, `image`, `files`)."""

    state: str = "idle"
    device: str | None = None
    device_name: str | None = None
    why: str | None = None
    wanted: bool = False
    image: str | None = None
    files: bool = False

    def as_record(self) -> dict[str, object]:
        """The document's fields."""
        fields = {"device": self.device, "deviceName": self.device_name, "why": self.why}
        return {"state": self.state, **{key: value for key, value in fields.items() if value is not None}}

    def on_state(self) -> dict[str, object]:
        """`GET /state`'s `ai`: the same, and what the starter polls."""
        return {**self.as_record(), "wanted": self.wanted, "image": self.image, "files": self.files}


def initial_state(environment: Mapping[str, str], machine: str | None = None) -> AiState:
    """Before any frame: what this computer can never do says so at once, the rest comes when a frame needs it."""
    why = never_here(environment, machine or platform.machine())
    return AiState("unavailable", why=why) if why else AiState()


def never_here(environment: Mapping[str, str], machine: str) -> str | None:
    """Why this worker can never get its sidecar: an image the starter cannot serve, or a starter older than the AI."""
    if {machine.lower(), environment.get(ENV_DOCKER_ARCH, "").lower()} & UNSUPPORTED_MACHINES:
        return WHY_ARM64
    return None if environment.get(ENV_STARTER) == STARTER_VERSION else WHY_OLD_STARTER


def why_of_fault(error: BaseException) -> str:
    """What the panel says of a fault no port named: a full disk, in its words; else that the AI gave no answer (the log has it)."""
    return WHY_DISK if isinstance(error, OSError) and error.errno in FULL_DISK else WHY_NO_ANSWER
