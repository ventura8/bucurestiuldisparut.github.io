"""check_bundle_budget.py: gzip size of the shipped bundles against their budgets."""

import os
import runpy
import sys
from pathlib import Path

import check_bundle_budget as bundles
import pytest
from treeutil import write

SCRIPT = Path(bundles.__file__)


def bundle(root: Path, relative: str, data: bytes) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def default_bundles(root: Path) -> None:
    for name in bundles.BUDGETS:
        bundle(root, name, b"(function(){})();\n" * 100)


def test_happy_path_small_bundles_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    default_bundles(tmp_path)

    assert bundles.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages[0].startswith("[bundle-budget] OK:\n  packages/admin/dist/admin.iife.js: 0.")
    assert caplog.messages[0].endswith(" KB gzip (budget 450 KB)\n  packages/engine/dist/engine.iife.js: 0.1 KB gzip (budget 150 KB)")


def test_bad_path_oversized_and_missing_bundles_fail(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    bundle(tmp_path, "packages/engine/dist/engine.iife.js", os.urandom(3000))

    assert bundles.main(["--root", str(tmp_path), "--budget", "packages/engine/dist/engine.iife.js=2"]) == 1
    output = caplog.messages[0]
    assert output.startswith("[bundle-budget] FAILED:\n  - packages/admin/dist/admin.iife.js: missing (run the build stage first)\n")
    assert "  - packages/engine/dist/engine.iife.js: 3.0 KB gzip (budget 2 KB)" in output


def test_happy_path_gzip_size_is_reproducible() -> None:
    data = b"hello " * 1000

    assert bundles.gzip_size(data) == bundles.gzip_size(data)
    assert bundles.gzip_size(data) < len(data)


@pytest.mark.parametrize("value", ["engine.js", "=3", "engine.js=", "engine.js=0", "engine.js=1.5"])
def test_bad_path_malformed_budget_is_a_usage_error(value: str) -> None:
    with pytest.raises(SystemExit) as exit_info:
        bundles.main(["--budget", value])

    assert exit_info.value.code == 2


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    default_bundles(tmp_path)
    write(tmp_path, "packages/engine/dist/engine.css", "")
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
