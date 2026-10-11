"""check_release.py: the tag, every package version, ENGINE_VERSION and the release notes agree.

Repositories are built under tmp_path; the tag lookup gets a fake `git` answer except in the tests
that run the real git (the default capture) in a throwaway repository.
"""

import json
import logging
import os
import runpy
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

import check_release
import pytest

RELEASE_PY = Path(check_release.__file__)
GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "Release Test",
    "GIT_AUTHOR_EMAIL": "release@example.invalid",
    "GIT_COMMITTER_NAME": "Release Test",
    "GIT_COMMITTER_EMAIL": "release@example.invalid",
}


def write_json(path: Path, document: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")


def write_release(root: Path, version: str = "1.2.3", *, notes: bool = True) -> None:
    """A consistent repository for `version`: root + two workspaces, engine constant, both notes files."""
    write_json(root / "package.json", {"name": "historic-city-map", "version": version, "workspaces": ["packages/*", "functions"]})
    write_json(root / "packages" / "engine" / "package.json", {"name": "@hcm/engine", "version": version})
    write_json(root / "functions" / "package.json", {"name": "@hcm/functions", "version": version})
    (root / "packages" / "notes-only").mkdir(parents=True)
    engine = root / check_release.ENGINE_INDEX
    engine.parent.mkdir(parents=True, exist_ok=True)
    engine.write_text(f"export const ENGINE_VERSION = '{version}';\n", encoding="utf-8")
    if notes:
        (root / "docs" / "releases").mkdir(parents=True)
        (root / "docs" / "releases" / f"v{version}.md").write_text("# v1.2.3\n\nNotes.\n", encoding="utf-8")
        (root / "docs" / "releases" / f"v{version}_github_description.md").write_text("# Release\n", encoding="utf-8")


def tags(*names: str) -> check_release.Capture:
    def capture(argv: Sequence[str]) -> str:
        assert list(argv) == ["tag", "--points-at", "HEAD", "--list", "v*"]
        return "".join(f"{name}\n" for name in names)

    return capture


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


def test_happy_path_consistent_release_passes(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.3")) == 0
    assert "[release] OK: v1.2.3 matches every package version, ENGINE_VERSION and both release-notes files" in log.text


def test_happy_path_explicit_tag_checks_before_tagging(tmp_path: Path) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3"], tags()) == 0


def test_bad_path_every_disagreement_is_listed(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path, "1.2.2", notes=False)
    write_json(tmp_path / "packages" / "engine" / "package.json", {"name": "@hcm/engine", "version": "1.2.3"})

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.3")) == 1
    assert "[release] FAILED for v1.2.3:" in log.text
    assert "  - package.json: version '1.2.2', the tag says '1.2.3'" in log.text
    assert "  - functions/package.json: version '1.2.2', the tag says '1.2.3'" in log.text
    assert "packages/engine/package.json" not in log.text
    assert "  - packages/engine/src/index.ts: ENGINE_VERSION '1.2.2', the tag says '1.2.3'" in log.text
    assert "  - docs/releases/v1.2.3.md is missing or empty (docs/releases/README.md)" in log.text
    assert "  - docs/releases/v1.2.3_github_description.md is missing or empty" in log.text


def test_bad_path_empty_notes_and_missing_engine_constant_fail(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)
    (tmp_path / "docs" / "releases" / "v1.2.3_github_description.md").write_text("  \n", encoding="utf-8")
    (tmp_path / check_release.ENGINE_INDEX).unlink()

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.3")) == 1
    assert "ENGINE_VERSION None, the tag says '1.2.3'" in log.text
    assert "docs/releases/v1.2.3_github_description.md is missing or empty" in log.text


@pytest.mark.parametrize("tag", ["v1.2", "v01.2.3", "1.2.3", "v1.2.3-rc.1", "v1.2.3+build"])
def test_bad_path_tag_must_be_plain_semver(tmp_path: Path, log: pytest.LogCaptureFixture, tag: str) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path), "--tag", tag]) == 1
    assert f"tag {tag!r} is not vMAJOR.MINOR.PATCH" in log.text


def test_bad_path_no_tag_at_head(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path)], tags()) == 1
    assert "[release] FAILED for HEAD:" in log.text
    assert "no v* tag points at HEAD" in log.text


def test_bad_path_several_tags_at_head(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.4", "v1.2.3")) == 1
    assert "several v* tags point at HEAD (v1.2.3, v1.2.4): a commit is released once" in log.text


@pytest.mark.parametrize(
    ("root_manifest", "message"),
    [
        ("{broken", "package.json: cannot read it as JSON"),
        ("[]", "package.json: expected a JSON object"),
        ('{"version": "1.2.3", "workspaces": {"packages": ["packages/*"]}}', "`workspaces` must be an array of globs"),
    ],
)
def test_bad_path_unreadable_root_manifest(tmp_path: Path, log: pytest.LogCaptureFixture, root_manifest: str, message: str) -> None:
    write_release(tmp_path)
    (tmp_path / "package.json").write_text(root_manifest, encoding="utf-8")

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.3")) == 1
    assert message in log.text


def test_happy_path_real_git_finds_the_annotated_tag(tmp_path: Path) -> None:
    write_release(tmp_path)
    for argv in (
        ["init", "-q", "-b", "master"],
        ["add", "-A"],
        ["commit", "-q", "-m", "chore: release"],
        ["tag", "-a", "v1.2.3", "-m", "x"],
    ):
        subprocess.run(["git", "-C", str(tmp_path), *argv], env=GIT_ENV, check=True)

    assert check_release.head_tags(check_release.git_capture(tmp_path)) == ["v1.2.3"]


def test_bad_path_outside_a_repository_no_tag_is_found(tmp_path: Path) -> None:
    assert check_release.head_tags(check_release.git_capture(tmp_path)) == []


def test_bad_path_script_entry_point_exits_with_main_status(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "argv", [str(RELEASE_PY), "--root", str(tmp_path), "--tag", "v1"])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(RELEASE_PY), run_name="__main__")

    assert exit_info.value.code == 1
