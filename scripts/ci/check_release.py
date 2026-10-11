#!/usr/bin/env python3
"""Release gate (stage `release`, run by .github/workflows/release.yml on a v* tag): the tag being
released agrees with the repository before anything is published.

- Exactly one tag `vMAJOR.MINOR.PATCH` points at HEAD (or `--tag` names it, to check before tagging);
  no pre-release or build suffix.
- The root package.json, every workspace package.json and ENGINE_VERSION in
  packages/engine/src/index.ts carry that version.
- Both release-notes files exist and are not empty (docs/releases/README.md):
  docs/releases/vX.Y.Z.md and docs/releases/vX.Y.Z_github_description.md (the GitHub Release body).

Usage: check_release.py [--root DIR] [--tag vX.Y.Z]. Exit status: 0 consistent, 1 problems found,
2 usage (argparse).
"""

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from cilog import get_logger
from cirepo import GIT

LOG = get_logger("release")
ROOT = Path(__file__).resolve().parents[2]
ENGINE_INDEX = Path("packages", "engine", "src", "index.ts")
RELEASE_NOTES = Path("docs", "releases")
SEMVER_TAG = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
ENGINE_VERSION = re.compile(r"ENGINE_VERSION\s*=\s*'([^']*)'")

Capture = Callable[[Sequence[str]], str]


class ReleaseError(Exception):
    """A manifest that cannot be read as a JSON object."""


def git_capture(root: Path) -> Capture:
    def capture(argv: Sequence[str]) -> str:
        return subprocess.run([GIT, "-C", str(root), *argv], check=True, capture_output=True, text=True).stdout

    return capture


def head_tags(capture: Capture) -> list[str]:
    """The v* tags that point at HEAD (annotated or lightweight); none outside a repository."""
    try:
        output = capture(("tag", "--points-at", "HEAD", "--list", "v*"))
    except OSError, subprocess.CalledProcessError:
        return []
    return sorted(line.strip() for line in output.splitlines() if line.strip())


def pick_tag(tags: Sequence[str]) -> tuple[str | None, list[str]]:
    """(the tag to release, problems): exactly one tag must point at HEAD."""
    if len(tags) == 1:
        return tags[0], []
    if not tags:
        return None, ["no v* tag points at HEAD: tag the release commit, or pass --tag vX.Y.Z to check before tagging"]
    return None, [f"several v* tags point at HEAD ({', '.join(tags)}): a commit is released once"]


def read_manifest(path: Path) -> dict[str, object]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ReleaseError(f"{path}: cannot read it as JSON ({error})") from error
    if not isinstance(document, dict):
        raise ReleaseError(f"{path}: expected a JSON object")
    return document


def workspace_dirs(root: Path, patterns: list[object]) -> set[Path]:
    """Every directory below root that one of the `workspaces` globs matches."""
    return {path for pattern in patterns for path in root.glob(str(pattern))}


def workspace_manifests(root: Path) -> list[Path]:
    """The root package.json, then the package.json of every directory its `workspaces` globs match."""
    patterns = read_manifest(root / "package.json").get("workspaces", [])
    if not isinstance(patterns, list):
        raise ReleaseError(f"{root / 'package.json'}: `workspaces` must be an array of globs")
    manifests = (directory / "package.json" for directory in workspace_dirs(root, patterns))
    return [root / "package.json", *sorted(manifest for manifest in manifests if manifest.is_file())]


def manifest_problems(root: Path, version: str) -> list[str]:
    versions = {manifest: read_manifest(manifest).get("version") for manifest in workspace_manifests(root)}
    return [
        f"{manifest.relative_to(root)}: version {found!r}, the tag says {version!r}"
        for manifest, found in versions.items()
        if found != version
    ]


def engine_problems(root: Path, version: str) -> list[str]:
    path = root / ENGINE_INDEX
    match = ENGINE_VERSION.search(path.read_text(encoding="utf-8")) if path.is_file() else None
    found = match.group(1) if match else None
    return [] if found == version else [f"{ENGINE_INDEX}: ENGINE_VERSION {found!r}, the tag says {version!r}"]


def _has_text(path: Path) -> bool:
    return path.is_file() and bool(path.read_text(encoding="utf-8").strip())


def notes_problems(root: Path, tag: str) -> list[str]:
    names = (f"{tag}.md", f"{tag}_github_description.md")
    return [
        f"{RELEASE_NOTES / name} is missing or empty (docs/releases/README.md)"
        for name in names
        if not _has_text(root / RELEASE_NOTES / name)
    ]


def release_problems(root: Path, tag: str) -> list[str]:
    """Everything that disagrees with releasing `tag` from `root` (empty when consistent)."""
    if not SEMVER_TAG.match(tag):
        return [f"tag {tag!r} is not vMAJOR.MINOR.PATCH (no pre-release or build suffix)"]
    version = tag.removeprefix("v")
    try:
        return [*manifest_problems(root, version), *engine_problems(root, version), *notes_problems(root, tag)]
    except ReleaseError as error:
        return [str(error)]


def verdict(tag: str | None, problems: Sequence[str]) -> int:
    if problems:
        LOG.error("[release] FAILED for %s:\n%s", tag or "HEAD", "\n".join(f"  - {problem}" for problem in problems))
        return 1
    LOG.info("[release] OK: %s matches every package version, ENGINE_VERSION and both release-notes files", tag)
    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check that a release tag agrees with the package versions and release notes.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--tag", help="the tag to check (default: the v* tag pointing at HEAD)")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None, capture: Capture | None = None) -> int:
    args = parse_args(argv)
    root: Path = args.root
    tag, problems = (args.tag, []) if args.tag else pick_tag(head_tags(capture or git_capture(root)))
    return verdict(tag, release_problems(root, tag) if tag else problems)


if __name__ == "__main__":
    sys.exit(main())
