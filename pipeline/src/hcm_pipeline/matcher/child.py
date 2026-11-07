"""One request answered, or one look at the device, in a process that imports PyTorch and exits (`docs/research/M10-local-ai.md`).

`python -m matcher.child probe <gpu|cpu> <why>` writes `sidecar.json`; `... run <request> <gpu|cpu> <why>` writes the answer. The exit
code is what `serve.py` reads: 77 or 76 no usable graphics card, 75 the graphics card ran out of memory, 0 answered.
"""

import json
import logging
import os
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Final

from .box import TAMPERED, Answer, SidecarStatus, read_request, read_status, request_id_of, write_answer, write_failure, write_status
from .search import search
from .torch_backend import OUT_OF_MEMORY, AlikedLightGlue, TamperedWeightsError, device_for, free_memory, out_of_memory

LOG = logging.getLogger("hcm-matcher")
USAGE: Final = 78
FAILED: Final = 1
GPU_REASON: Final = "no-gpu"
PINS: Final = Path(__file__).with_name("pins.json")


def weight_pins(pins_path: Path = PINS) -> dict[str, str]:
    """The weights' hashes by name."""
    pins = json.loads(pins_path.read_text(encoding="utf-8"))
    return {each["name"]: each["sha256"] for each in pins["files"] if each["kind"] == "weights"}


def _fallback(kind: str, why: str) -> str | None:
    return None if kind == "gpu" else why


def probe(box: Path, kind: str, why: str) -> int:
    """The device checked (77 or 76 for no graphics card to use) and said in the box, and said in plain words in the log."""
    device = device_for(kind)
    if kind == "gpu":
        LOG.info("local AI: graphics card %s", device.name)
    else:
        LOG.warning("local AI: NO GRAPHICS CARD (%s): falling back to the processor", why)
    earlier = read_status(box)
    write_status(box, SidecarStatus(kind, device.name, _fallback(kind, why), 0 if earlier is None else earlier.beat))
    return 0


def answer(request_path: Path, weights: Path, kind: str, why: str, tick: Callable[[], None]) -> int:
    """The request answered; `OUT_OF_MEMORY` when the graphics card could not hold it."""
    box, request_id = request_path.parent, request_id_of(request_path)
    started = time.monotonic()
    device = device_for(kind)
    try:
        backend = AlikedLightGlue(device, weights, weight_pins())
        found = search(read_request(request_path), backend, tick)
    except out_of_memory():
        free_memory()
        return OUT_OF_MEMORY
    except TamperedWeightsError as error:
        LOG.error("local AI: %s", error)
        write_failure(box, request_id, TAMPERED)
        return FAILED
    write_answer(box, request_id, Answer(found, kind, device.name, round(time.monotonic() - started, 1), _fallback(kind, why)))
    return 0


def _nothing() -> None:
    """The child's own tick: `serve.py` kills it on a cancel, so it has nothing to look at."""


def main(arguments: Sequence[str], environment: Mapping[str, str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    root = Path(environment.get("HCM_AI_ROOT", "/ai"))
    match list(arguments):
        case ["probe", kind, why]:
            return probe(root / "box", kind, why)
        case ["run", request, kind, why]:
            return answer(Path(request), root / "files" / "weights", kind, why, _nothing)
        case _:
            LOG.error("usage: child probe <device> <why> | run <request> <device> <why>")
            return USAGE


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:], os.environ))
