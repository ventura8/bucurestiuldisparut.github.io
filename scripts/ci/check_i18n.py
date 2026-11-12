#!/usr/bin/env python3
"""Static gate: every UI catalogue holds the same messages as the Romanian source.

Every UI string exists in `ro` (the default locale and the source of truth for keys) and in every
other locale of its folder: `en` for the admin's, the API's and the start page's, and the public
viewer's sixteen languages (`VIEWER_LOCALES`) for `packages/shared/src/i18n` and its `map-labels/`.
TypeScript already rejects a missing key (each catalogue is typed against `ro`); this gate also
catches what the type system cannot see, in every `packages/*/src/i18n/` folder and every folder
directly inside one (`packages/shared/src/i18n/api/`: the backend's error messages, kept apart so
the public viewer never ships them):

* each folder has one catalogue per locale (`ro.ts`, `en.ts`, …);
* every locale defines exactly the source's keys, none of them twice;
* every message is non-empty and uses the same `{placeholder}` names as the source (a translated
  placeholder name would stay visible on screen).

The viewer's catalogues, which Claude translates (DECISIONS-for-review.md §159), are also checked for
what a translation gets wrong (`viewer_problems`):

* a counted family (a key ending `.one`) has all six plural forms, `zero` to `other`, as
  `Intl.PluralRules` may select any of them;
* a placeholder is only `{word}` with balanced braces: no ICU syntax, which no runtime reads;
* no message starts or ends with whitespace, and none holds a bidi control (the engine isolates
  values itself);
* outside English, a message equal to the English one is untranslated, unless it has no letter
  outside its placeholders, names a licence (`license.*`) or is a word both languages spell alike
  (`COGNATES`);
* at least 80 % of a catalogue's letters are in its script (`SCRIPTS`): a catalogue pasted into
  the wrong file fails;
* Romanian writes ș and ț with a comma below, never ş and ţ with a cedilla.

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
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import chain
from pathlib import Path

from cilog import bullets, get_logger
from cirepo import ROOT

LOG = get_logger("i18n")

LOCALES = ("ro", "en")
SOURCE_LOCALE = LOCALES[0]
# The public viewer's languages (`VIEWER_LOCALES` of packages/shared/src/i18n/index.ts), in its folders.
VIEWER_LOCALES = ("ro", "en", "es", "fr", "de", "it", "pt", "ru", "uk", "pl", "tr", "ar", "hi", "zh", "ja", "ko")
VIEWER_FOLDERS = frozenset({"packages/shared/src/i18n", "packages/shared/src/i18n/map-labels"})
PLURAL_FORMS = ("zero", "one", "two", "few", "many", "other")
# The letters of a catalogue's script, by the start of their Unicode name; Latin for every other locale.
SCRIPTS = {
    "ru": ("CYRILLIC",),
    "uk": ("CYRILLIC",),
    "ar": ("ARABIC",),
    "hi": ("DEVANAGARI",),
    "zh": ("CJK",),
    "ja": ("CJK", "HIRAGANA", "KATAKANA"),
    "ko": ("HANGUL",),
}
MIN_SCRIPT_SHARE = 0.8
# Words a language spells as English does, checked by a translator: the only messages equal to English allowed.
COGNATES = {
    "ro": frozenset({"consent.accept"}),
    "fr": frozenset({"action.menu", "photos.count.one", "photos.count.two", "photos.count.few", "photos.count.other"}),
    "de": frozenset({"photo.links", "poi.links", "about.engine", "theme.system"}),
    "pt": frozenset({"action.menu", "photo.links", "poi.links"}),
    "pl": frozenset({"action.menu"}),
}
BIDI_CONTROLS = re.compile("[\u200e\u200f\u202a-\u202e\u2066-\u2069]")
CEDILLA = re.compile("[şţŞŢ]")
LETTER_RE = re.compile(r"[^\W\d_]")
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
    for locale in list(files)[1:]:
        rel, other = relative(root, files[locale]), catalogues[locale].messages
        problems += key_problems(rel, source, other) + message_problems(rel, source, other)
    return problems


def missing_forms(family: str, messages: dict[str, str]) -> list[str]:
    """The plural forms `family` lacks."""
    return [form for form in PLURAL_FORMS if f"{family}.{form}" not in messages]


def plural_problems(rel: str, messages: dict[str, str]) -> list[str]:
    """Every counted family (a `.one` key) with all six plural forms."""
    families = sorted(key.removesuffix(".one") for key in messages if key.endswith(".one"))
    return [f"{rel}: {family!r} has no {form!r} plural form" for family in families for form in missing_forms(family, messages)]


def braces_balanced(value: str) -> bool:
    """Every brace is part of a `{word}` placeholder: no ICU syntax (`{count, plural, …}`), no stray brace."""
    return "{" not in PLACEHOLDER_RE.sub("", value) and "}" not in PLACEHOLDER_RE.sub("", value)


def text_problems(rel: str, key: str, value: str) -> list[str]:
    """What one message of a viewer catalogue may not hold."""
    found = [] if braces_balanced(value) else [f"{rel}: {key!r} has a brace outside a {{word}} placeholder"]
    found += [f"{rel}: {key!r} starts or ends with whitespace"] if value != value.strip() else []
    return found + ([f"{rel}: {key!r} holds a bidi control"] if BIDI_CONTROLS.search(value) else [])


def is_untranslated(locale: str, key: str, value: str, english: str | None) -> bool:
    """A message equal to English that has letters of its own, is no licence's name and no known cognate."""
    if value != english or key.startswith("license.") or key in COGNATES.get(locale, frozenset()):
        return False
    return LETTER_RE.search(PLACEHOLDER_RE.sub("", value)) is not None


def letters_of(messages: dict[str, str]) -> list[str]:
    """Every letter of the messages outside their placeholders."""
    return [char for value in messages.values() for char in PLACEHOLDER_RE.sub("", value) if LETTER_RE.match(char)]


def script_share(locale: str, messages: dict[str, str]) -> float:
    """The share of the letters outside placeholders that are in the locale's script (1 without letters)."""
    letters = letters_of(messages)
    scripts = SCRIPTS.get(locale, ("LATIN",))
    inside = sum(1 for char in letters if unicodedata.name(char, "").startswith(scripts))
    return inside / len(letters) if letters else 1.0


def untranslated_problems(rel: str, locale: str, messages: dict[str, str], english: dict[str, str]) -> list[str]:
    """Outside English, every message equal to the English one (`is_untranslated`)."""
    if locale == "en":
        return []
    untranslated = [key for key, value in messages.items() if is_untranslated(locale, key, value, english.get(key))]
    return [f"{rel}: {key!r} is the English text" for key in untranslated]


def script_problems(rel: str, locale: str, messages: dict[str, str]) -> list[str]:
    """Too few letters in the catalogue's script, and Romanian's cedillas."""
    found = [] if script_share(locale, messages) >= MIN_SCRIPT_SHARE else [f"{rel}: fewer than 80 % of its letters are in its script"]
    cedillas = locale == "ro" and any(CEDILLA.search(value) for value in messages.values())
    return found + ([f"{rel}: Romanian writes ș and ț with a comma below"] if cedillas else [])


def catalogue_problems(rel: str, locale: str, messages: dict[str, str], english: dict[str, str]) -> list[str]:
    """One viewer catalogue's own problems (`viewer_problems`)."""
    texts = chain.from_iterable(text_problems(rel, key, value) for key, value in messages.items())
    untranslated = untranslated_problems(rel, locale, messages, english)
    return [*plural_problems(rel, messages), *texts, *untranslated, *script_problems(rel, locale, messages)]


def viewer_problems(root: Path, files: dict[str, Path], catalogues: dict[str, Catalogue]) -> list[str]:
    """What a translation of the viewer's catalogues gets wrong (the module docstring's list)."""
    english = catalogues["en"].messages
    found = (catalogue_problems(relative(root, path), locale, catalogues[locale].messages, english) for locale, path in files.items())
    return list(chain.from_iterable(found))


def compare(root: Path, files: dict[str, Path], viewer: bool = False) -> tuple[list[str], int]:
    catalogues = {locale: read_catalogue(path, relative(root, path), locale) for locale, path in files.items()}
    problems = list(chain.from_iterable(catalogue.problems for catalogue in catalogues.values()))
    problems += parity_problems(root, files, catalogues)
    return problems + (viewer_problems(root, files, catalogues) if viewer else []), len(catalogues[SOURCE_LOCALE].messages)


def locales_of(root: Path, folder: Path) -> tuple[str, ...]:
    """The viewer's sixteen languages in its folders, Romanian and English elsewhere."""
    return VIEWER_LOCALES if relative(root, folder) in VIEWER_FOLDERS else LOCALES


def check_folder(root: Path, folder: Path) -> tuple[list[str], int]:
    """(problems, keys of the source locale) for one i18n folder."""
    locales = locales_of(root, folder)
    files = {locale: folder / f"{locale}.ts" for locale in locales}
    absent = [f"{relative(root, path)}: missing catalogue" for path in files.values() if not path.is_file()]
    if absent:
        return absent, 0
    return compare(root, files, viewer=locales == VIEWER_LOCALES)


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
    parser = argparse.ArgumentParser(description="Check that every UI catalogue holds the Romanian source's messages.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    problems, folders, keys = check(parser.parse_args(argv).root)
    if problems:
        LOG.error("[i18n] FAILED:\n%s", bullets(problems))
        return 1
    languages = " and ".join(LOCALES)
    viewer = len(VIEWER_LOCALES)
    LOG.info("[i18n] OK: %d catalogue folder(s), %d keys, identical in %s (the viewer's in %d languages)", folders, keys, languages, viewer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
