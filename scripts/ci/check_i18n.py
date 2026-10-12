#!/usr/bin/env python3
"""Static gate: the Romanian and English UI catalogues hold the same messages.

Every UI string exists in both `ro` (the default locale and the source of truth for keys) and
`en`. TypeScript already rejects a missing key in `en` (it is typed `Messages`, derived from
`ro`); this gate also catches what the type system cannot see, in every `packages/*/src/i18n/`
folder and every folder directly inside one (`packages/shared/src/i18n/api/`: the backend's error
messages, kept apart so the public viewer never ships them):

* each folder has one catalogue per locale (`ro.ts`, `en.ts`);
* both define exactly the same keys, none of them twice;
* every message is non-empty and uses the same `{placeholder}` names in both languages (a
  translated placeholder name would stay visible on screen).

A catalogue is a flat object literal of one-line entries, the shape Prettier keeps:

    export const ro = {
        'app.title': 'București dispărut',
        'hello.greeting': 'Salut, {name}!',
    } as const;

Any other line inside the literal (a computed key, a nested object, a value split over lines)
is reported rather than skipped, so the parity check never passes on a catalogue it misread.

Usage: check_i18n.py [--root DIR]. Exit status: 0 OK, 1 problems found, 2 usage.
"""

import argparse
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import chain
from pathlib import Path

from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("i18n")

LOCALES = ("ro", "en")
SOURCE_LOCALE = LOCALES[0]
# The UI catalogues, and the catalogues one level below them (the API error messages).
CATALOGUE_GLOBS = ("packages/*/src/i18n", "packages/*/src/i18n/*")
_STRING = r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\""
ENTRY_RE = re.compile(rf"^\s*(?P<key>{_STRING}|[A-Za-z_$][\w$]*)\s*:\s*(?P<value>{_STRING}|`[^`$]*`)\s*,?\s*$")
OPEN_RE = re.compile(r"^export\s+const\s+(?P<name>\w+)\b[^=]*=\s*\{\s*$")
CLOSE_RE = re.compile(r"^\}")
COMMENT_RE = re.compile(r"^\s*(//|/\*|\*)")
PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")


@dataclass
class Catalogue:
    """One locale's messages, and what could not be read."""

    messages: dict[str, str] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)


def unquote(token: str) -> str:
    return token[1:-1] if token[:1] in "'\"`" else token


def opens(line: str, locale: str) -> bool:
    """True for the `export const <locale> ... = {` line."""
    match = OPEN_RE.match(line)
    return match is not None and match.group("name") == locale


def literal_start(lines: Sequence[str], locale: str) -> int | None:
    return next((index for index, line in enumerate(lines) if opens(line, locale)), None)


def literal_end(lines: Sequence[str], start: int) -> int:
    return next((index for index in range(start, len(lines)) if CLOSE_RE.match(lines[index])), len(lines))


def literal_lines(text: str, locale: str) -> list[tuple[int, str]]:
    """(line number, line) inside `export const <locale> = {` ... `}` (empty without that literal)."""
    lines = text.splitlines()
    start = literal_start(lines, locale)
    if start is None:
        return []
    end = literal_end(lines, start + 1)
    return list(enumerate(lines[start + 1 : end], start=start + 2))


def read_entry(catalogue: Catalogue, where: str, line: str) -> None:
    match = ENTRY_RE.match(line)
    if match is None:
        catalogue.problems.append(f"{where}: not a one-line `'key': 'message',` entry")
        return
    key, value = unquote(match.group("key")), unquote(match.group("value"))
    if key in catalogue.messages:
        catalogue.problems.append(f"{where}: key {key!r} defined twice")
    catalogue.messages[key] = value


def is_entry_candidate(line: str) -> bool:
    """Every non-blank, non-comment line inside the literal must be an entry."""
    return bool(line.strip()) and not COMMENT_RE.match(line)


def read_catalogue(path: Path, rel: str, locale: str) -> Catalogue:
    catalogue = Catalogue()
    for number, line in literal_lines(path.read_text(encoding="utf-8"), locale):
        if is_entry_candidate(line):
            read_entry(catalogue, f"{rel}:{number}", line)
    if not catalogue.messages and not catalogue.problems:
        catalogue.problems.append(f"{rel}: no `export const {locale} = {{ ... }}` catalogue")
    return catalogue


def message_problems(rel: str, source: dict[str, str], other: dict[str, str]) -> list[str]:
    """Empty messages of `other`, and placeholders that differ from the source locale's."""
    problems = [f"{rel}: {key!r} is empty" for key, value in other.items() if not value.strip()]
    for key in sorted(set(source) & set(other)):
        expected, found = set(PLACEHOLDER_RE.findall(source[key])), set(PLACEHOLDER_RE.findall(other[key]))
        if expected != found:
            problems.append(f"{rel}: {key!r} uses placeholders {sorted(found)}, {SOURCE_LOCALE} uses {sorted(expected)}")
    return problems


def key_problems(rel: str, source: dict[str, str], other: dict[str, str]) -> list[str]:
    missing = [f"{rel}: missing key {key!r} (defined in {SOURCE_LOCALE})" for key in sorted(set(source) - set(other))]
    return missing + [f"{rel}: extra key {key!r} (not in {SOURCE_LOCALE})" for key in sorted(set(other) - set(source))]


def relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def parity_problems(root: Path, files: dict[str, Path], catalogues: dict[str, Catalogue]) -> list[str]:
    """Every other locale against the source locale: keys, placeholders and empty messages."""
    source = catalogues[SOURCE_LOCALE].messages
    problems = message_problems(relative(root, files[SOURCE_LOCALE]), {}, source)
    for locale in LOCALES[1:]:
        rel, other = relative(root, files[locale]), catalogues[locale].messages
        problems += key_problems(rel, source, other) + message_problems(rel, source, other)
    return problems


def compare(root: Path, files: dict[str, Path]) -> tuple[list[str], int]:
    catalogues = {locale: read_catalogue(path, relative(root, path), locale) for locale, path in files.items()}
    problems = list(chain.from_iterable(catalogue.problems for catalogue in catalogues.values()))
    return problems + parity_problems(root, files, catalogues), len(catalogues[SOURCE_LOCALE].messages)


def check_folder(root: Path, folder: Path) -> tuple[list[str], int]:
    """(problems, keys of the source locale) for one i18n folder."""
    files = {locale: folder / f"{locale}.ts" for locale in LOCALES}
    absent = [f"{relative(root, path)}: missing catalogue" for path in files.values() if not path.is_file()]
    if absent:
        return absent, 0
    return compare(root, files)


def catalogue_folders(root: Path) -> list[Path]:
    return sorted(path for pattern in CATALOGUE_GLOBS for path in root.glob(pattern) if path.is_dir())


def merge(results: Sequence[tuple[list[str], int]]) -> tuple[list[str], int]:
    return list(chain.from_iterable(problems for problems, _ in results)), sum(keys for _, keys in results)


def check(root: Path) -> tuple[list[str], int, int]:
    """(problems, catalogue folders, keys) for every catalogue folder (`CATALOGUE_GLOBS`)."""
    folders = catalogue_folders(root)
    if not folders:
        return [f"no catalogue folder matches {' or '.join(CATALOGUE_GLOBS)}"], 0, 0
    problems, keys = merge([check_folder(root, folder) for folder in folders])
    return problems, len(folders), keys


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that the ro and en UI catalogues hold the same messages.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    problems, folders, keys = check(parser.parse_args(argv).root)
    if problems:
        LOG.error("[i18n] FAILED:\n%s", bullets(problems))
        return 1
    LOG.info("[i18n] OK: %d catalogue folder(s), %d keys, identical in %s", folders, keys, " and ".join(LOCALES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
