"""pipeline.py: registry consistency, stage expansion, gate execution, setup, verdicts and the CLI.

Commands never really run here: a FakeShell records argv and returns programmed exit codes,
except in the few tests that exercise the subprocess-backed defaults with the Python interpreter.
"""

import hashlib
import json
import logging
import runpy
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

import pytest

import pipeline
from pipeline import COMPOSITE_STAGES, GATES, STAGES, Context, Gate

PIPELINE_PY = Path(pipeline.__file__)


class FakeShell:
    """Records every command; a command fails when one of `failing` is a substring of it."""

    def __init__(self, root: Path, failing: Sequence[str] = (), ls_files: Sequence[str] = ()) -> None:
        self.root = root
        self.failing = tuple(failing)
        self.ls_files = "\0".join(ls_files) + ("\0" if ls_files else "")
        self.calls: list[list[str]] = []
        self.captured: list[list[str]] = []

    def run(self, argv: Sequence[str]) -> int:
        self.calls.append(list(argv))
        line = " ".join(argv)
        return 1 if any(token in line for token in self.failing) else 0

    def capture(self, argv: Sequence[str]) -> str:
        self.captured.append(list(argv))
        outputs = {"ls-files": self.ls_files, "rev-parse": "0123abcd\n", "status": "?? new-file.ts\n"}
        return outputs[argv[1]]

    def context(self) -> Context:
        return Context(root=self.root, run=self.run, capture=self.capture)


@pytest.fixture
def shell(tmp_path: Path) -> FakeShell:
    return FakeShell(tmp_path)


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


def gate_commands(shell: FakeShell) -> list[str]:
    return [" ".join(call) for call in shell.calls]


# --- registry -------------------------------------------------------------------------------------


def test_happy_path_registry_is_consistent() -> None:
    assert pipeline.validate_registry() == []


def test_happy_path_every_gate_belongs_to_a_stage() -> None:
    used = {gate for gates in STAGES.values() for gate in gates}

    assert set(GATES) == used


def test_happy_path_stage_names_cover_the_documented_stages() -> None:
    assert pipeline.all_stage_names() == ["all", "build", "contract", "deps", "e2e", "quality", "release", "sonar", "static", "tests"]


def test_bad_path_unknown_and_duplicated_gates_are_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(STAGES, "static", ("prettier", "prettier", "no-such-gate"))

    assert pipeline.validate_registry() == [
        "stage 'static' uses unknown gate 'no-such-gate'",
        "stage 'static' lists gate 'prettier' twice",
    ]


def test_bad_path_composite_problems_are_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(COMPOSITE_STAGES, "static", ("tests",))
    monkeypatch.setitem(COMPOSITE_STAGES, "nightly", ("static", "fuzz"))

    assert pipeline.validate_registry() == [
        "stage name 'static' is both simple and composite",
        "composite 'nightly' uses unknown stage 'fuzz'",
    ]


@pytest.mark.parametrize(
    ("stage", "expected"),
    [
        ("static", ["static"]),
        ("quality", ["static", "tests", "e2e", "build"]),
        ("all", ["static", "tests", "e2e", "build", "sonar"]),
    ],
)
def test_happy_path_stages_expand_in_run_order(stage: str, expected: list[str]) -> None:
    assert pipeline.expand_stage(stage) == expected


# --- gates ----------------------------------------------------------------------------------------


def test_happy_path_gate_runs_its_command(shell: FakeShell, log: pytest.LogCaptureFixture) -> None:
    assert pipeline.run_gate(Gate("ruff-check", ("ruff", "check", ".")), shell.context()) is True
    assert shell.calls == [["ruff", "check", "."]]
    assert log.messages[-1].startswith("  ruff-check passed in ")


def test_bad_path_failing_gate_reports_its_exit_code(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    shell = FakeShell(tmp_path, failing=["mypy"])

    assert pipeline.run_gate(Gate("mypy", ("mypy",)), shell.context()) is False
    assert log.messages[-1].startswith("  mypy FAILED (exit 1) in ")


def test_happy_path_file_gate_appends_matching_existing_files(tmp_path: Path) -> None:
    (tmp_path / "docker").mkdir()
    (tmp_path / "docker" / "Dockerfile.quality").write_text("FROM scratch\n", encoding="utf-8")
    (tmp_path / "a.sh").write_text("true\n", encoding="utf-8")
    shell = FakeShell(tmp_path, ls_files=["a.sh", "docker/Dockerfile.quality", "a.sh", "deleted.sh"])
    gate = Gate("lint-files", ("tool", "--flag"), files=("*.sh", "docker/Dockerfile*"))

    assert pipeline.run_gate(gate, shell.context()) is True
    assert shell.captured == [["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.sh", "docker/Dockerfile*"]]
    assert shell.calls == [["tool", "--flag", "a.sh", "docker/Dockerfile.quality"]]


def test_happy_path_file_gate_without_files_is_skipped(shell: FakeShell, log: pytest.LogCaptureFixture) -> None:
    assert pipeline.run_gate(Gate("htmlhint", ("htmlhint",), files=("*.html",)), shell.context()) is True
    assert shell.calls == []
    assert log.messages == ["  htmlhint skipped: no files match *.html"]


def test_happy_path_stage_announces_each_gate(shell: FakeShell, log: pytest.LogCaptureFixture) -> None:
    assert pipeline.run_stage("tests", shell.context()) == []
    assert [message for message in log.messages if not message.startswith("  ")] == [
        "tests 1/6 vitest",
        "tests 2/6 site-unit",
        "tests 3/6 rules-coverage",
        "tests 4/6 pytest",
        "tests 5/6 pipeline-pytest",
        "tests 6/6 coverage",
    ]
    assert gate_commands(shell) == [
        "npm run --silent test",
        "npm run --silent test:site",
        "python3 scripts/ci/check_rules_coverage.py check",
        "python3 -m pytest",
        " ".join(pipeline.PIPELINE_PYTEST),
        "python3 " + " ".join(pipeline.COVERAGE_GATE),
    ]


def test_bad_path_stage_keeps_going_after_a_failure(tmp_path: Path) -> None:
    # A gate early in the stage fails (`npm run --silent test` is a prefix of the site-unit command, so match a unique one).
    shell = FakeShell(tmp_path, failing=["check_rules_coverage.py"])

    assert pipeline.run_stage("tests", shell.context()) == ["tests/rules-coverage"]
    assert len(shell.calls) == 6


def test_bad_path_empty_stage_fails(shell: FakeShell, log: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(STAGES, "deps", ())

    assert pipeline.run_stage("deps", shell.context()) == ["deps (no gates registered)"]
    assert log.messages == ["deps: no gates registered yet (docs/research/M0-handoff.md)"]
    assert shell.calls == []


def test_happy_path_sonar_and_deps_stages_run_their_scripts(shell: FakeShell) -> None:
    assert pipeline.run_stage("sonar", shell.context()) == []
    assert pipeline.run_stage("deps", shell.context()) == []
    assert gate_commands(shell) == ["bash scripts/ci/sonar_scan.sh", "python3 scripts/ci/check_dependency_updates.py"]


def test_happy_path_fonts_gate_checks_the_kit_subset_after_i18n() -> None:
    static = STAGES["static"]

    assert static.index("fonts") == static.index("i18n") + 1
    assert GATES["fonts"].command == ("npm", "run", "--silent", "fonts:check", "--workspace", "@hcm/ui")


def test_happy_path_commits_gate_runs_after_the_history_scan() -> None:
    static = STAGES["static"]

    assert static.index("commits") == static.index("gitleaks-history") + 1
    assert GATES["commits"].command == ("python3", "scripts/ci/check_commits.py")


# --- setup: node_modules --------------------------------------------------------------------------


def write_lockfile(root: Path, content: str = '{"lockfileVersion": 3}\n') -> str:
    (root / "package-lock.json").write_text(content, encoding="utf-8")
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def test_happy_path_no_lockfile_needs_no_install(shell: FakeShell) -> None:
    assert pipeline.ensure_node_modules(shell.context()) is True
    assert shell.calls == []


def test_happy_path_missing_node_modules_are_installed_and_stamped(shell: FakeShell) -> None:
    digest = write_lockfile(shell.root)
    (shell.root / "node_modules").mkdir()

    assert pipeline.ensure_node_modules(shell.context()) is True
    assert shell.calls == [list(pipeline.NPM_CI)]
    assert (shell.root / pipeline.INSTALL_STAMP).read_text(encoding="utf-8") == digest + "\n"


def test_happy_path_current_stamp_skips_the_install(shell: FakeShell) -> None:
    digest = write_lockfile(shell.root)
    (shell.root / "node_modules").mkdir()
    (shell.root / pipeline.INSTALL_STAMP).write_text(digest + "\n", encoding="utf-8")

    assert pipeline.ensure_node_modules(shell.context()) is True
    assert shell.calls == []


def test_bad_path_stale_stamp_reinstalls(shell: FakeShell) -> None:
    write_lockfile(shell.root, '{"lockfileVersion": 3, "changed": true}\n')
    (shell.root / "node_modules").mkdir()
    (shell.root / pipeline.INSTALL_STAMP).write_text("old-digest\n", encoding="utf-8")

    assert pipeline.ensure_node_modules(shell.context()) is True
    assert shell.calls == [list(pipeline.NPM_CI)]


def test_bad_path_failed_install_fails_the_whole_run(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_lockfile(tmp_path)
    shell = FakeShell(tmp_path, failing=["npm ci"])

    assert pipeline.run_pipeline("tests", shell.context()) == 1
    assert shell.calls == [list(pipeline.NPM_CI)]
    assert log.messages[-1] == "[FAILURE] stage 'tests' failed: setup/npm-ci"
    assert not (tmp_path / pipeline.INSTALL_STAMP).exists()


# --- verdicts and green markers -------------------------------------------------------------------


def test_happy_path_passing_stage_writes_green_marker(shell: FakeShell, log: pytest.LogCaptureFixture) -> None:
    assert pipeline.run_pipeline("build", shell.context()) == 0

    marker = json.loads((shell.root / "reports" / "pipeline" / "green-build.json").read_text(encoding="utf-8"))
    assert marker == {"stage": "build", "head": "0123abcd", "status_sha256": hashlib.sha256(b"?? new-file.ts\n").hexdigest()}
    assert log.messages[-1] == "[SUCCESS] stage 'build' passed (reports/pipeline/green-build.json)"


def test_bad_path_failing_stage_writes_no_marker(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    shell = FakeShell(tmp_path, failing=["python3 -m pytest"])

    assert pipeline.run_pipeline("tests", shell.context()) == 1
    assert log.messages[-1] == "[FAILURE] stage 'tests' failed: tests/pytest"
    assert not (tmp_path / "reports").exists()


def test_bad_path_composite_stage_reports_every_failed_part(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    shell = FakeShell(tmp_path, failing=["check_bundle_budget.py", "sonar_scan.sh"])

    assert pipeline.run_pipeline("all", shell.context()) == 1
    assert log.messages[-1] == "[FAILURE] stage 'all' failed: build/bundle-budget, sonar/sonar"
    assert "e2e 3/3 playwright" in log.messages
    assert "build 1/3 vite-build" in log.messages
    assert "sonar 1/1 sonar" in log.messages


def test_bad_path_unborn_head_is_recorded(tmp_path: Path) -> None:
    def capture(argv: Sequence[str]) -> str:
        if argv[1] == "rev-parse":
            raise subprocess.CalledProcessError(128, list(argv))
        return ""

    ctx = Context(root=tmp_path, run=lambda _argv: 0, capture=capture)

    marker = pipeline.write_green_marker("static", ctx)

    assert json.loads(marker.read_text(encoding="utf-8"))["head"] == "unborn"


# --- subprocess-backed defaults -------------------------------------------------------------------


def test_happy_path_run_command_returns_the_exit_code(tmp_path: Path) -> None:
    assert pipeline.run_command([sys.executable, "-c", "raise SystemExit(3)"], tmp_path) == 3


def test_bad_path_missing_executable_exits_127(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    assert pipeline.run_command(["hcm-no-such-tool"], tmp_path) == pipeline.COMMAND_NOT_FOUND
    assert log.messages == ["  command not found: hcm-no-such-tool"]


def test_happy_path_capture_output_returns_stdout(tmp_path: Path) -> None:
    assert pipeline.capture_output([sys.executable, "-c", "import sys; sys.stdout.write('ok')"], tmp_path) == "ok"


def test_bad_path_capture_output_raises_on_failure(tmp_path: Path) -> None:
    with pytest.raises(subprocess.CalledProcessError):
        pipeline.capture_output([sys.executable, "-c", "raise SystemExit(1)"], tmp_path)


def test_happy_path_default_context_runs_from_the_root(tmp_path: Path) -> None:
    ctx = pipeline.default_context(tmp_path)

    assert ctx.root == tmp_path
    assert ctx.run([sys.executable, "-c", "pass"]) == 0
    assert ctx.capture([sys.executable, "-c", "import os, sys; sys.stdout.write(os.getcwd())"]) == str(tmp_path)


# --- CLI ------------------------------------------------------------------------------------------


def test_happy_path_list_prints_the_registry(log: pytest.LogCaptureFixture) -> None:
    assert pipeline.main(["--list"]) == 0
    assert "e2e      e2e-matrix e2e-build playwright" in log.messages
    assert "sonar    sonar" in log.messages
    assert "deps     dependency-updates" in log.messages
    assert "all      quality sonar" in log.messages
    assert "tests    vitest site-unit rules-coverage pytest pipeline-pytest coverage" in log.messages


def test_bad_path_inconsistent_registry_refuses_to_run(monkeypatch: pytest.MonkeyPatch, log: pytest.LogCaptureFixture) -> None:
    monkeypatch.setitem(STAGES, "tests", ("vitest", "jest"))

    assert pipeline.main(["--stage", "tests"]) == pipeline.EXIT_USAGE
    assert log.messages[0] == "[ERROR] pipeline registry: stage 'tests' uses unknown gate 'jest'"


def test_bad_path_missing_stage_is_a_usage_error(monkeypatch: pytest.MonkeyPatch, log: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv(pipeline.IMAGE_MARKER, "1")

    assert pipeline.main([]) == pipeline.EXIT_USAGE
    assert log.messages[-1].startswith("[ERROR] run `PIPELINE_STAGE=<stage> bash scripts/ci/run-all-checks.sh`")


def test_bad_path_refuses_to_run_outside_the_quality_image(monkeypatch: pytest.MonkeyPatch, shell: FakeShell) -> None:
    monkeypatch.delenv(pipeline.IMAGE_MARKER, raising=False)

    assert pipeline.main(["--stage", "build"], shell.context()) == pipeline.EXIT_USAGE
    assert shell.calls == []


def test_bad_path_unknown_stage_is_rejected_by_argparse() -> None:
    with pytest.raises(SystemExit) as exit_info:
        pipeline.main(["--stage", "deploy"])

    assert exit_info.value.code == pipeline.EXIT_USAGE


def test_happy_path_main_runs_the_stage_inside_the_image(monkeypatch: pytest.MonkeyPatch, shell: FakeShell) -> None:
    monkeypatch.setenv(pipeline.IMAGE_MARKER, "1")

    assert pipeline.main(["--stage", "build"], shell.context()) == 0
    assert gate_commands(shell) == ["npm run --silent build", "python3 scripts/ci/check_bundle_budget.py", "npm run --silent build:site"]


def test_happy_path_main_defaults_to_the_real_repository(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[Path] = []

    def fake_run_pipeline(_stage: str, ctx: Context) -> int:
        seen.append(ctx.root)
        return 0

    monkeypatch.setenv(pipeline.IMAGE_MARKER, "1")
    monkeypatch.setattr(pipeline, "run_pipeline", fake_run_pipeline)

    assert pipeline.main(["--stage", "static"]) == 0
    assert seen == [pipeline.ROOT]


def test_happy_path_script_entry_point_exits_with_main_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", [str(PIPELINE_PY), "--list"])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(PIPELINE_PY), run_name="__main__")

    assert exit_info.value.code == 0
