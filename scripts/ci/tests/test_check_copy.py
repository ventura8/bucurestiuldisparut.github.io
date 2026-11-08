"""check_copy.py: developer and test words refused in the catalogues and the other user-facing sources."""

import runpy
import sys
import tomllib
from pathlib import Path
from typing import Any

import check_copy as copy
import pytest
from treeutil import write

SCRIPT = Path(copy.__file__)
RO = """export const ro = {
    'input.padTitle': 'Gamepad standard',
    'adminWorker.openSetup': 'Deschide Configurarea',
} as const;
"""
EN = """export const en: Messages = {
    'input.padTitle': 'Standard gamepad',
    'adminWorker.openSetup': 'Open the imagery pipeline',
};
"""
CONFIG = """
[[term]]
pattern = 'simulat\\w*|simulated'
why = 'how it was tried'

[[term]]
pattern = 'M\\d+'
ignore_case = false
why = 'a milestone'

[[term]]
pattern = 'pipeline\\w*'
locales = ['ro']
why = 'English inside Romanian'

[[term]]
pattern = 'roles/\\w[\\w.]*'
why = 'a raw role'
"""


def config(extra: str = "") -> dict[str, Any]:
    return tomllib.loads(CONFIG + extra)


def catalogues(root: Path, ro: str = RO, en: str = EN) -> None:
    write(root, "packages/shared/src/i18n/ro.ts", ro, newline=False)
    write(root, "packages/shared/src/i18n/en.ts", en, newline=False)


def source(path: str, kind: str) -> str:
    return f"\n[[source]]\npath = '{path}'\nkind = '{kind}'\n"


def test_happy_path_clean_catalogues_pass_and_an_english_word_is_fine_in_english(tmp_path: Path) -> None:
    catalogues(tmp_path)

    assert copy.check(tmp_path, config()) == ([], 4)


def test_bad_path_the_gamepad_note_and_english_inside_romanian_are_refused(tmp_path: Path) -> None:
    ro = RO.replace("'Gamepad standard'", "'Gamepad standard (încercat doar simulat)'").replace(
        "'Deschide Configurarea'", "'Deschide pipeline-ul'"
    )
    catalogues(tmp_path, ro=ro, en=EN.replace("'Standard gamepad'", "'Standard gamepad (tried only Simulated)'"))

    problems, _ = copy.check(tmp_path, config())

    assert problems == [
        "packages/shared/src/i18n/ro.ts: input.padTitle: 'simulat' (how it was tried): Gamepad standard (încercat doar simulat)",
        "packages/shared/src/i18n/ro.ts: adminWorker.openSetup: 'pipeline' (English inside Romanian): Deschide pipeline-ul",
        "packages/shared/src/i18n/en.ts: input.padTitle: 'Simulated' (how it was tried): Standard gamepad (tried only Simulated)",
    ]


def test_happy_path_whole_words_and_case_sensitive_terms_spare_lookalikes(tmp_path: Path) -> None:
    catalogues(tmp_path, en=EN.replace("'Standard gamepad'", "'USGS M2M, 5 m5 units, a dissimulated word'"))

    assert copy.check(tmp_path, config())[0] == []


def test_bad_path_each_source_kind_reads_only_what_a_user_sees(tmp_path: Path) -> None:
    catalogues(tmp_path)
    write(tmp_path, "kit/index.html", "<!-- the M5 kit -->\n<script>const m = 'M5';</script>\n<p>The M5 map</p>")
    write(tmp_path, "kit/city.json", '{"about": {"ro": "Din M5"}, "links": ["M6", 3, null]}')
    write(tmp_path, "kit/README.md", "Use the M7 kit.")
    write(tmp_path, "kit/worker.sh", "# docs, M8\nsay 'needs roles/run.invoker'\n\tWrite-Host 'fine'")
    write(tmp_path, "kit/notes.ts", "// M9 note\nconst text = 'M10 text' + \"ok\" + `M11`;")
    sources = "".join(
        source(path, kind)
        for path, kind in [
            ("kit/index.html", "html"),
            ("kit/city.json", "json"),
            ("kit/README.md", "text"),
            ("kit/worker.sh", "say"),
            ("kit/notes.ts", "strings"),
            ("kit/gone.md", "text"),
        ]
    )

    problems, _ = copy.check(tmp_path, config(sources))

    assert problems == [
        "kit/gone.md: the source is missing",
        "kit/index.html: line 3: 'M5' (a milestone): <p>The M5 map</p>",
        "kit/city.json: a string value: 'M5' (a milestone): Din M5",
        "kit/city.json: a string value: 'M6' (a milestone): M6",
        "kit/README.md: line 1: 'M7' (a milestone): Use the M7 kit.",
        "kit/worker.sh: line 2: 'roles/run.invoker' (a raw role): 'needs roles/run.invoker'",
        "kit/notes.ts: line 2: 'M10' (a milestone): 'M10 text'",
        "kit/notes.ts: line 2: 'M11' (a milestone): `M11`",
    ]


def test_happy_path_an_allowed_use_by_key_or_file_passes_and_a_stale_one_is_reported(tmp_path: Path) -> None:
    catalogues(tmp_path, ro=RO.replace("'Deschide Configurarea'", "'Deschide pipeline-ul'"))
    write(tmp_path, "kit/README.md", "The M5 kit.")
    allow = """
[[allow]]
where = 'adminWorker.openSetup'
term = 'PIPELINE'

[[allow]]
where = 'kit/README.md'
term = 'm5'

[[allow]]
where = 'input.padTitle'
term = 'simulat'
"""

    problems, _ = copy.check(tmp_path, config(source("kit/README.md", "text") + allow))

    assert problems == ["check_copy.toml: the allowed use 'input.padTitle' / 'simulat' no longer matches"]


def test_bad_path_main_reports_and_fails(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    catalogues(tmp_path, en=EN.replace("'Standard gamepad'", "'Standard gamepad (tried only simulated)'"))
    write(tmp_path, "copy.toml", CONFIG)

    assert copy.main(["--root", str(tmp_path), "--config", str(tmp_path / "copy.toml")]) == 1
    assert caplog.messages == [
        "[copy] FAILED:\n  - packages/shared/src/i18n/en.ts: input.padTitle: 'simulated' (how it was tried): "
        "Standard gamepad (tried only simulated)"
    ]


def test_happy_path_the_repository_config_reads_and_the_script_entry_point_exits_with_main_status(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    catalogues(tmp_path)
    page, data, say, code = (
        "<p>Harta se încarcă.</p>",
        '{"title": "București dispărut"}',
        "say 'graphics card found'",
        "const M = 'Searched again';",
    )
    sources = {
        "templates/starter-kit/index.html": page,
        "templates/starter-kit/README.md": page,
        "starter-kit/README.md": page,
        "templates/starter-kit/city.json": data,
        "starter-kit/data/manifest.json": data,
        "sites/bucharest/site.json": data,
        "packages/admin/starter/hcm-worker.sh": say,
        "packages/admin/starter/hcm-worker.bat": say,
        "functions/src/export/documents.ts": code,
        "functions/src/imagery/relocate.ts": code,
    }
    list(map(lambda item: write(tmp_path, *item), sources.items()))
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
    assert caplog.messages == ["[copy] OK: 14 texts, no developer or test words"]
