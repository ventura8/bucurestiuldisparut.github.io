"""parallel.py: what runs at once follows the free memory as well as the cores; overrides and the low-memory mode."""

import runpy
import sys
from pathlib import Path

import parallel
import pytest
from parallel import Machine

LAPTOP = Machine(cpus=16, available_gib=9)
SCRIPT = Path(parallel.__file__)


@pytest.mark.parametrize(
    ("name", "machine", "expected"),
    [
        ("lint", Machine(16, 30), 4),
        ("lint", LAPTOP, 1),
        ("lint", Machine(16, 14), 2),
        ("lint", Machine(16, 19), 3),
        ("lint", Machine(16, 3), 1),
        ("lint", Machine(16, None), 4),
        ("lint", Machine(2, 30), 1),
        ("gates", Machine(16, 30), 15),
        ("gates", LAPTOP, 4),
        ("vitest", LAPTOP, 4),
        ("playwright", Machine(16, 30), 8),
        ("playwright", LAPTOP, 4),
        ("playwright", Machine(16, None), 8),
    ],
)
def test_happy_path_the_count_is_the_smaller_of_what_cores_and_free_memory_allow(name: str, machine: Machine, expected: int) -> None:
    assert parallel.workers(name, {}, machine) == expected


def test_happy_path_the_low_memory_mode_runs_gates_one_at_a_time_with_one_lint_worker() -> None:
    low = {parallel.LOW_VARIABLE: "1"}
    roomy = Machine(32, 64)

    assert [parallel.workers(name, low, roomy) for name in ("gates", "lint", "vitest", "playwright")] == [1, 1, 2, 2]


def test_happy_path_overrides_cap_every_kind_and_set_the_lint_workers() -> None:
    roomy = Machine(32, 64)

    assert parallel.workers("gates", {parallel.MAX_VARIABLE: "3"}, roomy) == 3
    assert parallel.workers("lint", {parallel.MAX_VARIABLE: "3"}, roomy) == 3
    assert parallel.workers("lint", {parallel.LINT_VARIABLE: "6", parallel.LOW_VARIABLE: "1"}, roomy) == 6
    assert parallel.workers("playwright", {parallel.LINT_VARIABLE: "6"}, LAPTOP) == 4


@pytest.mark.parametrize("value", ["", "0", "-1", "many"])
def test_bad_path_an_unusable_override_is_ignored(value: str) -> None:
    assert parallel.workers("lint", {parallel.MAX_VARIABLE: value, parallel.LINT_VARIABLE: value}, Machine(16, 14)) == 2


def test_happy_path_the_tools_get_their_counts_unless_already_told() -> None:
    assert parallel.tool_variables({}, LAPTOP) == {"HCM_LINT_WORKERS": "1", "VITEST_MAX_WORKERS": "4", "HCM_E2E_WORKERS": "4"}
    assert parallel.tool_variables({"HCM_E2E_WORKERS": "1"}, LAPTOP) == {"HCM_LINT_WORKERS": "1", "VITEST_MAX_WORKERS": "4"}


def test_happy_path_the_free_memory_is_read_in_whole_gib(tmp_path: Path) -> None:
    meminfo = tmp_path / "meminfo"
    meminfo.write_text("MemTotal:       32000000 kB\nMemAvailable:    9500000 kB\n", encoding="utf-8")

    assert parallel.available_gib(meminfo) == 9
    assert parallel.this_machine().cpus >= 1


@pytest.mark.parametrize("text", ["MemTotal: 1 kB\n", "MemAvailable:\n", "MemAvailable: lots kB\n"])
def test_bad_path_a_meminfo_without_the_figure_leaves_only_the_cores(tmp_path: Path, text: str) -> None:
    meminfo = tmp_path / "meminfo"
    meminfo.write_text(text, encoding="utf-8")

    assert parallel.available_gib(meminfo) is None
    assert parallel.available_gib(tmp_path / "missing") is None


def test_happy_path_the_command_prints_one_number(caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(parallel.LINT_VARIABLE, "3")

    assert parallel.main(["lint"]) == 0
    assert caplog.messages == ["3"]


@pytest.mark.parametrize("argv", [[], ["lint", "gates"], ["everything"]])
def test_bad_path_an_unknown_kind_is_a_usage_error(argv: list[str], caplog: pytest.LogCaptureFixture) -> None:
    assert parallel.main(argv) == parallel.EXIT_USAGE
    assert caplog.messages == ["usage: parallel.py <lint|gates|vitest|playwright>"]


def test_happy_path_the_script_runs_as_a_program(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "gates"])

    with pytest.raises(SystemExit) as ended:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert ended.value.code == 0
