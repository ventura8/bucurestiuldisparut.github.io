"""check_i18n.py: ro/en key parity, placeholders, empty messages and unreadable catalogue lines."""

import runpy
import sys
from pathlib import Path

import check_i18n as i18n
import pytest
from treeutil import write

SCRIPT = Path(i18n.__file__)
RO = """/** Romanian catalogue. */
export const ro = {
    // Application
    'app.title': 'București dispărut',
    "hello.greeting": "Salut, {name}!",
    plain: `fără`,
} as const;

export type MessageKey = keyof typeof ro;
"""
EN = """import type { Messages } from './ro.js';

export const en: Messages = {
    'app.title': 'Vanished Bucharest',
    'hello.greeting': 'Hello, {name}!',
    plain: 'plain',
};
"""


def catalogues(root: Path, ro: str = RO, en: str = EN, package: str = "shared") -> None:
    write(root, f"packages/{package}/src/i18n/ro.ts", ro, newline=False)
    write(root, f"packages/{package}/src/i18n/en.ts", en, newline=False)


def test_happy_path_matching_catalogues_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    catalogues(tmp_path)
    catalogues(tmp_path, package="admin")

    assert i18n.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[i18n] OK: 2 catalogue folder(s), 6 keys, identical in ro and en"]


def test_bad_path_key_and_placeholder_drift_is_reported(tmp_path: Path) -> None:
    en = EN.replace("'Hello, {name}!'", "'Hello, {nume}!'").replace("plain: 'plain',", "'extra.key': 'Extra',\n    'empty': ' ',")
    catalogues(tmp_path, en=en)

    problems, _, _ = i18n.check(tmp_path)

    assert problems == [
        "packages/shared/src/i18n/en.ts: missing key 'plain' (defined in ro)",
        "packages/shared/src/i18n/en.ts: extra key 'empty' (not in ro)",
        "packages/shared/src/i18n/en.ts: extra key 'extra.key' (not in ro)",
        "packages/shared/src/i18n/en.ts: 'empty' is empty",
        "packages/shared/src/i18n/en.ts: 'hello.greeting' uses placeholders ['nume'], ro uses ['name']",
    ]


def test_bad_path_unreadable_lines_duplicates_and_empty_source_messages(tmp_path: Path) -> None:
    ro = RO.replace("plain: `fără`,", "plain: '',\n    'app.title': 'Again',\n    [computed]: 'x',\n    'split':\n        'value',")
    catalogues(tmp_path, ro=ro)

    problems, _, _ = i18n.check(tmp_path)

    assert problems == [
        "packages/shared/src/i18n/ro.ts:7: key 'app.title' defined twice",
        "packages/shared/src/i18n/ro.ts:8: not a one-line `'key': 'message',` entry",
        "packages/shared/src/i18n/ro.ts:9: not a one-line `'key': 'message',` entry",
        "packages/shared/src/i18n/ro.ts:10: not a one-line `'key': 'message',` entry",
        "packages/shared/src/i18n/ro.ts: 'plain' is empty",
    ]


def test_bad_path_missing_catalogue_file_or_literal(tmp_path: Path) -> None:
    write(tmp_path, "packages/ui/src/i18n/ro.ts", RO)
    catalogues(tmp_path, en="export const english = {\n};\n")

    problems, folders, _ = i18n.check(tmp_path)

    assert folders == 2
    assert problems == [
        "packages/shared/src/i18n/en.ts: no `export const en = { ... }` catalogue",
        "packages/shared/src/i18n/en.ts: missing key 'app.title' (defined in ro)",
        "packages/shared/src/i18n/en.ts: missing key 'hello.greeting' (defined in ro)",
        "packages/shared/src/i18n/en.ts: missing key 'plain' (defined in ro)",
        "packages/ui/src/i18n/en.ts: missing catalogue",
    ]


def test_bad_path_no_catalogue_folder(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    assert i18n.main(["--root", str(tmp_path)]) == 1
    assert caplog.messages == ["[i18n] FAILED:\n  - no catalogue folder matches packages/*/src/i18n"]


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    catalogues(tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
