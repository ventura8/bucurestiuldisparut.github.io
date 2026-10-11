#!/usr/bin/env python3
"""Quality pipeline: the single definition of every stage and gate.

Runs only inside the pinned quality image (docker/Dockerfile.quality sets HCM_TEST_IMAGE=1);
scripts/ci/run-all-checks.sh starts the container and scripts/ci/in-container.sh calls

    python3 scripts/ci/pipeline.py --stage <static|tests|e2e|build|sonar|deps|release|quality|all>

Each gate of the stage runs in order from the repository root, announced as `static 3/24 eslint`.
Every gate runs even after a failure, so one run lists every problem. The run ends with
`[SUCCESS] stage 'static' passed` (exit 0, and reports/pipeline/green-static.json records HEAD and
a hash of `git status`) or `[FAILURE] stage 'static' failed: ...` (exit 1).

Extending the pipeline (docs/research/M0-handoff.md): add a `Gate` to `GATES`, then its name to
a stage in `STAGES`. `validate_registry()` (run first, and by the tests) rejects unknown names.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import partial
from pathlib import Path

from cilog import get_logger

LOG = get_logger("pipeline")
ROOT = Path(__file__).resolve().parents[2]

IMAGE_MARKER = "HCM_TEST_IMAGE"
COMMAND_NOT_FOUND = 127
EXIT_USAGE = 2


@dataclass(frozen=True)
class Gate:
    """A quality gate: `command` runs from the repository root and passes when it exits 0.

    With `files` (git pathspecs), the tracked and untracked-but-not-ignored files matching them
    are appended to the command; when nothing matches, the gate is skipped and counts as passed.
    """

    name: str
    command: tuple[str, ...]
    files: tuple[str, ...] = ()


NPM_RUN = ("npm", "run", "--silent")
SHELL_FILES = ("*.sh", "scripts/git-hooks/*")
DOCKERFILES = (":(glob)**/Dockerfile", ":(glob)**/Dockerfile.*")

GATES: dict[str, Gate] = {
    gate.name: gate
    for gate in (
        # static: cheapest first, network-bound audits last.
        Gate("suppressions", ("python3", "scripts/ci/check_no_inline_suppressions.py")),
        Gate("prettier", (*NPM_RUN, "format:check")),
        Gate("tsc", (*NPM_RUN, "typecheck")),
        Gate("eslint", (*NPM_RUN, "lint")),
        Gate("stylelint", (*NPM_RUN, "lint:css")),
        Gate("htmlhint", (*NPM_RUN, "lint:html", "--"), files=("*.html",)),
        Gate("html-validate", (*NPM_RUN, "lint:html:validate", "--"), files=("*.html",)),
        Gate("markdownlint", (*NPM_RUN, "lint:md")),
        Gate("knip", (*NPM_RUN, "lint:knip")),
        Gate("dependency-cruiser", (*NPM_RUN, "lint:deps")),
        Gate("yamllint", ("yamllint", "--strict", ".")),
        Gate("taplo-fmt", ("taplo", "fmt", "--check")),
        Gate("taplo-lint", ("taplo", "lint")),
        Gate("ruff-check", ("ruff", "check", ".")),
        Gate("ruff-format", ("ruff", "format", "--check", ".")),
        Gate("mypy", ("mypy",)),
        Gate("shellcheck", ("shellcheck", "-x", "--severity=style"), files=SHELL_FILES),
        Gate("shfmt", ("shfmt", "-d"), files=SHELL_FILES),
        Gate("hadolint", ("hadolint", "--failure-threshold", "warning", "--disable-ignore-pragma"), files=DOCKERFILES),
        Gate("actionlint", ("actionlint",), files=(".github/workflows/*.yml", ".github/workflows/*.yaml")),
        Gate(
            "gitleaks",
            ("gitleaks", "dir", "--redact", "--no-banner", "--config", ".gitleaks.toml")
            + ("--report-format", "json", "--report-path", "reports/gitleaks.json", "."),
        ),
        Gate("npm-audit", ("npm", "audit", "--audit-level=low")),
        Gate("pip-audit", ("pip-audit", "--no-deps", "--disable-pip", "--progress-spinner", "off", "-r", "scripts/ci/requirements.txt")),
        # tests
        Gate("vitest", (*NPM_RUN, "test")),
        Gate("pytest", ("python3", "-m", "pytest")),
        # build
        Gate("vite-build", (*NPM_RUN, "build")),
    )
}

STAGES: dict[str, tuple[str, ...]] = {
    "static": (
        "suppressions",
        "prettier",
        "tsc",
        "eslint",
        "stylelint",
        "htmlhint",
        "html-validate",
        "markdownlint",
        "knip",
        "dependency-cruiser",
        "yamllint",
        "taplo-fmt",
        "taplo-lint",
        "ruff-check",
        "ruff-format",
        "mypy",
        "shellcheck",
        "shfmt",
        "hadolint",
        "actionlint",
        "gitleaks",
        "npm-audit",
        "pip-audit",
    ),
    "tests": ("vitest", "pytest"),
    # Filled by later milestones (docs/research/M0-handoff.md). An empty stage FAILS: it must never
    # report green for work that does not exist yet.
    "e2e": (),
    "build": ("vite-build",),
    "sonar": (),
    "deps": (),
    "release": (),
}

COMPOSITE_STAGES: dict[str, tuple[str, ...]] = {
    "quality": ("static", "tests", "e2e", "build"),
    "all": ("quality", "sonar"),
}

NPM_CI = ("npm", "ci", "--prefer-offline", "--no-audit", "--no-fund")
INSTALL_STAMP = Path("node_modules", ".hcm-install-stamp")

Runner = Callable[[Sequence[str]], int]
Capture = Callable[[Sequence[str]], str]


@dataclass(frozen=True)
class Context:
    """Where and how commands run; tests pass fakes instead of subprocess-backed callables."""

    root: Path
    run: Runner
    capture: Capture


def run_command(argv: Sequence[str], cwd: Path) -> int:
    """Runs `argv` in `cwd` with the terminal's stdout/stderr; a missing executable exits 127."""
    try:
        return subprocess.run(list(argv), cwd=cwd, check=False).returncode
    except FileNotFoundError:
        LOG.error("  command not found: %s", argv[0])
        return COMMAND_NOT_FOUND


def capture_output(argv: Sequence[str], cwd: Path) -> str:
    """Runs `argv` in `cwd` and returns its stdout; raises CalledProcessError on a non-zero exit."""
    return subprocess.run(list(argv), cwd=cwd, check=True, capture_output=True, text=True).stdout


def default_context(root: Path = ROOT) -> Context:
    return Context(root=root, run=partial(run_command, cwd=root), capture=partial(capture_output, cwd=root))


def all_stage_names() -> list[str]:
    return sorted([*STAGES, *COMPOSITE_STAGES])


def _unknown_gates() -> list[str]:
    return [f"stage '{stage}' uses unknown gate '{gate}'" for stage, gates in STAGES.items() for gate in gates if gate not in GATES]


def _duplicated_gates() -> list[str]:
    return [f"stage '{stage}' lists gate '{gate}' twice" for stage, gates in STAGES.items() for gate in set(gates) if gates.count(gate) > 1]


def _composite_problems() -> list[str]:
    known = set(STAGES) | set(COMPOSITE_STAGES)
    clashes = [f"stage name '{name}' is both simple and composite" for name in sorted(set(STAGES) & set(COMPOSITE_STAGES))]
    unknown = [f"composite '{name}' uses unknown stage '{part}'" for name, parts in COMPOSITE_STAGES.items() for part in parts if part not in known]
    return clashes + unknown


def validate_registry() -> list[str]:
    """Problems in GATES/STAGES/COMPOSITE_STAGES: unknown or duplicated names (empty when consistent)."""
    return [*_unknown_gates(), *_duplicated_gates(), *_composite_problems()]


def expand_stage(name: str) -> list[str]:
    """The simple stages a stage name stands for, in run order (`all` -> static, tests, e2e, build, sonar)."""
    if name in STAGES:
        return [name]
    return [simple for part in COMPOSITE_STAGES[name] for simple in expand_stage(part)]


def list_files(pathspecs: Sequence[str], ctx: Context) -> list[str]:
    """Existing files matching `pathspecs`: tracked ones plus untracked ones that are not ignored."""
    output = ctx.capture(("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *pathspecs))
    names = sorted({name for name in output.split("\0") if name})
    return [name for name in names if (ctx.root / name).is_file()]


def run_gate(gate: Gate, ctx: Context) -> bool:
    argv = list(gate.command)
    if gate.files:
        files = list_files(gate.files, ctx)
        if not files:
            LOG.info("  %s skipped: no files match %s", gate.name, " ".join(gate.files))
            return True
        argv.extend(files)
    started = time.monotonic()
    code = ctx.run(argv)
    verdict = "passed" if code == 0 else f"FAILED (exit {code})"
    LOG.info("  %s %s in %.1fs", gate.name, verdict, time.monotonic() - started)
    return code == 0


def run_stage(stage: str, ctx: Context) -> list[str]:
    """Runs every gate of a simple stage; returns the failed `stage/gate` names."""
    gates = STAGES[stage]
    if not gates:
        LOG.error("%s: no gates registered yet (docs/research/M0-handoff.md)", stage)
        return [f"{stage} (no gates registered)"]
    failures: list[str] = []
    for index, name in enumerate(gates, start=1):
        LOG.info("%s %d/%d %s", stage, index, len(gates), name)
        if not run_gate(GATES[name], ctx):
            failures.append(f"{stage}/{name}")
    return failures


def ensure_node_modules(ctx: Context) -> bool:
    """`npm ci` when node_modules was not installed from the current package-lock.json by this pipeline.

    The image bakes the npm cache, so the install is offline and fast; the stamp makes repeated
    runs free. Delete node_modules/.hcm-install-stamp to force a reinstall.
    """
    lockfile = ctx.root / "package-lock.json"
    if not lockfile.is_file():
        return True
    digest = hashlib.sha256(lockfile.read_bytes()).hexdigest()
    stamp = ctx.root / INSTALL_STAMP
    if stamp.is_file() and stamp.read_text(encoding="utf-8").strip() == digest:
        return True
    LOG.info("setup: npm ci (node_modules missing or older than package-lock.json)")
    if ctx.run(NPM_CI) != 0:
        return False
    stamp.write_text(digest + "\n", encoding="utf-8")
    return True


def git_head(ctx: Context) -> str:
    try:
        return ctx.capture(("git", "rev-parse", "HEAD")).strip()
    except subprocess.CalledProcessError:
        return "unborn"


def write_green_marker(stage: str, ctx: Context) -> Path:
    """reports/pipeline/green-<stage>.json: HEAD plus a hash of `git status`, read by the pre-push hook."""
    status = ctx.capture(("git", "status", "--porcelain=v1", "--untracked-files=all"))
    marker = ctx.root / "reports" / "pipeline" / f"green-{stage}.json"
    marker.parent.mkdir(parents=True, exist_ok=True)
    payload = {"stage": stage, "head": git_head(ctx), "status_sha256": hashlib.sha256(status.encode("utf-8")).hexdigest()}
    marker.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return marker


def verdict(stage: str, failures: Sequence[str], ctx: Context) -> int:
    """Logs the final verdict line; a pass also writes the green marker."""
    if failures:
        LOG.error("[FAILURE] stage '%s' failed: %s", stage, ", ".join(failures))
        return 1
    marker = write_green_marker(stage, ctx)
    LOG.info("[SUCCESS] stage '%s' passed (%s)", stage, marker.relative_to(ctx.root))
    return 0


def run_pipeline(stage: str, ctx: Context) -> int:
    if not ensure_node_modules(ctx):
        return verdict(stage, ["setup/npm-ci"], ctx)
    return verdict(stage, [failure for simple in expand_stage(stage) for failure in run_stage(simple, ctx)], ctx)


def describe_registry() -> None:
    for stage in all_stage_names():
        parts = COMPOSITE_STAGES.get(stage) or STAGES[stage] or ("(no gates yet)",)
        LOG.info("%-8s %s", stage, " ".join(parts))


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one quality-pipeline stage inside the quality image.")
    parser.add_argument("--stage", choices=all_stage_names(), help="stage to run")
    parser.add_argument("--list", action="store_true", help="print every stage with its gates and exit")
    return parser.parse_args(argv)


def report_registry(problems: Sequence[str]) -> int:
    """`--list` output, also printed when the registry is inconsistent (then exit 2)."""
    for problem in problems:
        LOG.error("[ERROR] pipeline registry: %s", problem)
    describe_registry()
    return EXIT_USAGE if problems else 0


def can_run(stage: str | None) -> bool:
    """Gates run only inside the quality image, which is the only place with the pinned toolchain."""
    return stage is not None and os.environ.get(IMAGE_MARKER) == "1"


def main(argv: Sequence[str] | None = None, ctx: Context | None = None) -> int:
    args = parse_args(argv)
    problems = validate_registry()
    if problems or args.list:
        return report_registry(problems)
    if not can_run(args.stage):
        LOG.error("[ERROR] run `PIPELINE_STAGE=<stage> bash scripts/ci/run-all-checks.sh` (needs --stage, inside the quality image)")
        return EXIT_USAGE
    return run_pipeline(args.stage, ctx or default_context())


if __name__ == "__main__":
    sys.exit(main())
