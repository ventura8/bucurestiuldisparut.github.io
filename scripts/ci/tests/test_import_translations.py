"""import_translations.py: a local model's translated catalogues, checked and merged into packages/shared/src/i18n."""

import runpy
import sys
from pathlib import Path

import import_translations as importer
import pytest
from treeutil import write

SCRIPT = Path(importer.__file__)
RO = """export const ro = {
    'shell.title': 'Administrare {city}',
    'shell.close': 'Închide',
    'shell.long': 'Un text',
} as const;

export type ShellKey = keyof typeof ro;
"""
FAMILY = "packages/shared/src/i18n/admin-shell"


def tree(root: Path) -> Path:
    """A repository with one family, and a translations folder beside it."""
    write(root, f"{FAMILY}/ro.ts", RO, newline=False)
    write(root, "packages/shared/src/i18n/ro.ts", RO.replace("ShellKey", "MessageKey"), newline=False)
    return root / "out"


def test_happy_path_valid_entries_are_written_in_the_sources_order(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    out = tree(tmp_path)
    write(
        out,
        "admin-shell/fr.ts",
        "export const fr = {\n    'shell.close': \"Fermer l'aide\",\n    'shell.title': 'Administration {city}',\n};",
    )

    assert importer.main([str(out), "--root", str(tmp_path)]) == 0

    written = (tmp_path / FAMILY / "fr.ts").read_text(encoding="utf-8")
    assert "import type { ShellKey } from './ro.js';" in written
    assert "export const fr: Readonly<Partial<Record<ShellKey, string>>> = {\n    'shell.title': 'Administration {city}',\n" in written
    assert "    'shell.close': \"Fermer l'aide\",\n};\n" in written
    assert caplog.messages[-1] == f"[i18n-import] 2 new text(s) in 1 file(s):\n  - {FAMILY}/fr.ts"


def test_bad_path_entries_that_fail_the_gate_are_left_out_and_reported(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    out = tree(tmp_path)
    write(
        out,
        "admin-shell/de.ts",
        "export const de = {\n    'shell.title': 'Verwaltung {stadt}',\n    'shell.close': '<b>Schließen</b>',\n"
        "    'shell.extra': 'x',\n    'shell.long': 'Ein Text',\n    [computed]: 'y',\n};",
    )

    assert importer.main([str(out), "--root", str(tmp_path)]) == 0

    written = (tmp_path / FAMILY / "de.ts").read_text(encoding="utf-8")
    assert "'shell.long': 'Ein Text'," in written
    assert "shell.title" not in written
    assert "shell.close" not in written
    assert caplog.messages[0].splitlines()[1:] == [
        f"  - {FAMILY}/de.ts (from de.ts:6: not a one-line entry)",
        f"  - {FAMILY}/de.ts: 'shell.title' uses placeholders ['stadt'], ro uses ['city']",
        f"  - {FAMILY}/de.ts: 'shell.close' holds an HTML tag",
        f"  - {FAMILY}/de.ts: extra key 'shell.extra' (not in ro)",
    ]


def test_happy_path_a_second_import_merges_with_the_file_there_and_a_dry_run_writes_nothing(tmp_path: Path) -> None:
    out = tree(tmp_path)
    write(out, "admin-shell/ja.ts", "export const ja = {\n    'shell.close': '閉じる',\n};")
    assert importer.main([str(out), "--root", str(tmp_path)]) == 0
    write(out, "admin-shell/ja.ts", "export const ja = {\n    'shell.long': `テキスト`,\n};")
    assert importer.main([str(out), "--root", str(tmp_path), "--dry-run"]) == 0
    assert "テキスト" not in (tmp_path / FAMILY / "ja.ts").read_text(encoding="utf-8")

    assert importer.main([str(out), "--root", str(tmp_path), "--locale", "ja"]) == 0

    written = (tmp_path / FAMILY / "ja.ts").read_text(encoding="utf-8")
    assert "'shell.close': '閉じる'," in written
    assert "'shell.long': 'テキスト'," in written


def test_bad_path_nothing_importable_is_an_error(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    out = tree(tmp_path)
    write(out, "admin-shell/ro.ts", "export const ro = {\n    'shell.close': 'x',\n};")
    write(out, "admin-shell/sv.ts", "export const sv = {\n    'shell.close': 'Stäng',\n};")
    write(out, "no-such-family/fr.ts", "export const fr = {\n    'shell.close': 'Fermer',\n};")
    write(out, "fr.ts", "export const fr = {\n    'shell.close': 'Fermer',\n};")
    write(out, "admin-shell/it.ts", "export const it = {\n    'shell.extra': 'Chiudi',\n};")

    assert importer.main([str(out), "--root", str(tmp_path)]) == 1
    assert caplog.messages[-1] == f"[i18n-import] nothing to import from {out}"


def test_happy_path_the_viewers_own_languages_are_never_touched(tmp_path: Path) -> None:
    out = tree(tmp_path)
    write(out, "fr.ts", "export const fr = {\n    'shell.close': 'Fermer',\n};")
    write(out, "nl.ts", "export const nl = {\n    'shell.close': 'Sluiten',\n};")

    assert importer.main([str(out), "--root", str(tmp_path)]) == 0

    assert not (tmp_path / "packages/shared/src/i18n/fr.ts").exists()
    assert "import type { MessageKey }" in (tmp_path / "packages/shared/src/i18n/nl.ts").read_text(encoding="utf-8")


def test_happy_path_prettiers_quotes() -> None:
    assert importer.encode("plain") == "'plain'"
    assert importer.encode("l'aide") == '"l\'aide"'
    assert importer.encode('a "b" l\'c') == "'a \"b\" l\\'c'"
    assert importer.encode("back\\slash\nline") == "'back\\\\slash\\nline'"
    assert importer.decode("'l\\'aide'") == "l'aide"


def test_bad_path_a_family_without_a_key_type_is_not_written(tmp_path: Path) -> None:
    out = tree(tmp_path)
    write(tmp_path, f"{FAMILY}/ro.ts", RO.replace("export type ShellKey = keyof typeof ro;", ""), newline=False)
    write(out, "admin-shell/fr.ts", "export const fr = {\n    'shell.close': 'Fermer',\n};")

    assert importer.main([str(out), "--root", str(tmp_path)]) == 1


def test_happy_path_both_entry_points_exit_with_mains_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out = tree(tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), str(out), "--root", str(tmp_path)])
    with pytest.raises(SystemExit) as exited:
        runpy.run_path(str(SCRIPT), run_name="__main__")
    assert exited.value.code == 1
    owner_entry = SCRIPT.parents[1] / "i18n" / "import_translations.py"
    with pytest.raises(SystemExit) as again:
        runpy.run_path(str(owner_entry), run_name="__main__")
    assert again.value.code == 1
