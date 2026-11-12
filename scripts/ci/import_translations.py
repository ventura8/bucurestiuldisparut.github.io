#!/usr/bin/env python3
"""Imports translated catalogues into packages/shared/src/i18n, keeping only what passes the gate's checks.

A local model writes one file per catalogue family and language, in the catalogues' own layout
(`<folder>/<locale>.ts`, `<folder>` relative to packages/shared/src/i18n, `.` for the viewer's main family) and
format (one `'key': 'message',` entry per line, docs/I18N.md). Each entry is checked against the family's
Romanian source with check_i18n.py's own rules for an optional language (`translation_problems`): a key
the source lacks, a different `{placeholder}`, an empty message, a brace outside a placeholder, edge
whitespace, a bidi control or an HTML tag. A passing entry is written; a failing one is left out and
reported, so its key shows in English until a better translation comes.

The written file merges the language's file already there with the new entries (a new text wins), in the
source's key order, typed `Readonly<Partial<Record<Key, string>>>` against the family's key type, its
strings quoted as Prettier quotes them. The viewer's own languages in its folders (`VIEWER_LOCALES`,
translated and complete already) are never touched.

Usage: import_translations.py SOURCE_DIR [--locale CODE ...] [--root DIR] [--dry-run]. Exit status: 0 imported (every
rejection is listed), 1 nothing to import or an unreadable file, 2 usage.
"""

import argparse
import ast
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import check_i18n as i18n
from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("i18n-import")

CATALOGUES = Path("packages/shared/src/i18n")
KEY_TYPE_RE = re.compile(r"^export type (\w+) = keyof typeof ro;$", re.M)
ENTRY_TOKENS_RE = re.compile(rf"^\s*(?P<key>{i18n._STRING}|[A-Za-z_$][\w$]*)\s*:\s*(?P<value>{i18n._STRING}|`[^`$]*`)\s*,?\s*$")


@dataclass
class Outcome:
    """What one import did: files written, entries kept, entries rejected with the reason."""

    written: list[str] = field(default_factory=list)
    kept: int = 0
    rejected: list[str] = field(default_factory=list)


def decode(token: str) -> str:
    """A JavaScript string literal's text (`'…'`, `"…"`: the escapes Python reads alike; a template literal as it is)."""
    return token[1:-1] if token.startswith("`") else str(ast.literal_eval(token))


def encode(text: str) -> str:
    """`text` quoted as Prettier quotes it: single quotes unless double ones need fewer escapes."""
    quote = '"' if text.count("'") > text.count('"') else "'"
    escaped = text.replace("\\", "\\\\").replace("\n", "\\n").replace(quote, "\\" + quote)
    return f"{quote}{escaped}{quote}"


def read_texts(path: Path, locale: str) -> tuple[dict[str, str], list[str]]:
    """(key → text, unreadable lines) of `export const <locale> … = { … }` in `path`."""
    texts: dict[str, str] = {}
    unreadable: list[str] = []
    for number, line in i18n.literal_lines(path.read_text(encoding="utf-8"), locale):
        match = ENTRY_TOKENS_RE.match(line) if i18n.is_entry_candidate(line) else None
        if match is not None:
            texts[decode(match.group("key"))] = decode(match.group("value"))
        elif i18n.is_entry_candidate(line):
            unreadable.append(f"{path.name}:{number}: not a one-line entry")
    return texts, unreadable


def entry_problems(rel: str, key: str, text: str, source: dict[str, str]) -> list[str]:
    """Why one translated entry cannot be imported (empty when it can)."""
    return i18n.translation_problems(rel, source, {key: text})


def accepted(rel: str, texts: dict[str, str], source: dict[str, str], outcome: Outcome) -> dict[str, str]:
    """The entries that pass; the others join the outcome's rejections."""
    kept: dict[str, str] = {}
    for key, text in texts.items():
        problems = entry_problems(rel, key, text, source)
        outcome.rejected.extend(problems)
        if not problems:
            kept[key] = text
    return kept


def key_type(folder: Path) -> str | None:
    """The family's key type, named in its `ro.ts` (`export type AdminShellKey = keyof typeof ro;`)."""
    match = KEY_TYPE_RE.search((folder / "ro.ts").read_text(encoding="utf-8"))
    return match.group(1) if match else None


def render(folder_name: str, locale: str, key_name: str, texts: dict[str, str], order: Sequence[str]) -> str:
    """The catalogue file: its header, the key type's import and one entry per line in the source's order."""
    entries = "".join(f"    '{key}': {encode(texts[key])},\n" for key in order if key in texts)
    return (
        f"import type {{ {key_name} }} from './ro.js';\n\n"
        f"/**\n * The `{folder_name}` family's texts in `{locale}`, imported by scripts/i18n/import_translations.py (docs/I18N.md).\n"
        f" * Partial while the translation goes on: a key not here shows in English.\n */\n"
        f"export const {locale}: Readonly<Partial<Record<{key_name}, string>>> = {{\n{entries}}};\n"
    )


def is_viewer_file(root: Path, folder: Path, locale: str) -> bool:
    """A viewer language in the viewer's folders: translated and complete already, never overwritten."""
    return i18n.relative(root, folder) in i18n.VIEWER_FOLDERS and locale in i18n.VIEWER_LOCALES


def target_of(root: Path, source_dir: Path, file: Path) -> tuple[Path, str] | None:
    """(catalogue folder, locale) of a translated file, or None when it names no family or no importable language."""
    locale, folder = file.stem, root / CATALOGUES / file.parent.relative_to(source_dir)
    importable = locale in i18n.UI_LOCALES and locale not in i18n.LOCALES and (folder / "ro.ts").is_file()
    return (folder, locale) if importable and not is_viewer_file(root, folder, locale) else None


def existing_texts(path: Path, locale: str) -> dict[str, str]:
    """The language's texts already in the catalogue (none before its first import)."""
    return read_texts(path, locale)[0] if path.is_file() else {}


def translated_texts(file: Path, locale: str, rel: str, outcome: Outcome) -> dict[str, str]:
    """A translated file's entries; a line that is no entry joins the outcome's rejections."""
    texts, unreadable = read_texts(file, locale)
    outcome.rejected.extend(f"{rel} (from {line})" for line in unreadable)
    return texts


def import_file(root: Path, file: Path, target: tuple[Path, str], outcome: Outcome, dry_run: bool) -> None:
    """Checks one translated file and merges what passes into the catalogue."""
    folder, locale = target
    path = folder / f"{locale}.ts"
    rel = i18n.relative(root, path)
    source = i18n.read_catalogue(folder / "ro.ts", rel, "ro").messages
    existing = existing_texts(path, locale)
    merged = {**existing, **accepted(rel, translated_texts(file, locale, rel, outcome), source, outcome)}
    key_name = key_type(folder)
    if key_name is None or not merged:
        return
    outcome.kept += len(merged) - len(existing)
    outcome.written.append(rel)
    if not dry_run:
        path.write_text(render(i18n.relative(root, folder), locale, key_name, merged, list(source)), encoding="utf-8")


def translated_files(source_dir: Path, locales: Sequence[str]) -> list[Path]:
    """Every `<locale>.ts` below `source_dir`, the wanted languages only when named."""
    files = sorted(source_dir.rglob("*.ts"))
    return [file for file in files if not locales or file.stem in locales]


def run(root: Path, source_dir: Path, locales: Sequence[str], dry_run: bool) -> Outcome:
    outcome = Outcome()
    for file in translated_files(source_dir, locales):
        target = target_of(root, source_dir, file)
        if target is not None:
            import_file(root, file, target, outcome, dry_run)
    return outcome


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import translated catalogues, keeping only the entries that pass the i18n gate.")
    parser.add_argument("source", type=Path, help="the translations' folder (<folder>/<locale>.ts)")
    parser.add_argument("--locale", action="append", default=[], help="only this language (repeatable)")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--dry-run", action="store_true", help="check and report, write nothing")
    args = parser.parse_args(argv)
    outcome = run(args.root, args.source, args.locale, args.dry_run)
    if outcome.rejected:
        LOG.warning(
            "[i18n-import] %d entr(ies) rejected, shown in English until translated again:\n%s",
            len(outcome.rejected),
            bullets(outcome.rejected),
        )
    if not outcome.written:
        LOG.error("[i18n-import] nothing to import from %s", args.source)
        return 1
    LOG.info("[i18n-import] %d new text(s) in %d file(s):\n%s", outcome.kept, len(outcome.written), bullets(outcome.written))
    return 0


if __name__ == "__main__":
    sys.exit(main())
