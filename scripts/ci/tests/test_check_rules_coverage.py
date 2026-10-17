"""check_rules_coverage.py: saving the emulator report and gating on it.

The reports here are fakes shaped like the Firestore emulator's `:ruleCoverage` JSON (firebase-tools
15.33.0): each expression has a 1-based `sourcePosition` with inclusive character offsets, `values`
with `{value, count}` entries (`{}` = short-circuited, `{"undefined": ...}` = error) and `children`.
"""

import json
import logging
import runpy
import socketserver
import sys
import threading
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import override

import check_rules_coverage as coverage
import pytest

SCRIPT = Path(coverage.__file__)

RULES_TEXT = """rules_version = '2';
service cloud.firestore {
    match /databases/{database}/documents {
        function signedIn() {
            return request.auth != null;
        }
        match /{document=**} {
            allow read, write: if false;
        }
        match /cities/{city} {
            allow read: if signedIn() && city == 'bucuresti';
        }
    }
}
"""

TRUE: dict[str, object] = {"boolValue": True}
FALSE: dict[str, object] = {"boolValue": False}
ERROR: dict[str, object] = {"undefined": {"causeMessage": "Property auth is undefined"}}
SKIPPED: dict[str, object] = {}
MAP: dict[str, object] = {"mapValue": {"fields": {}}}


def node(snippet: str, values: Sequence[Mapping[str, object]] | None, children: Sequence[dict[str, object]] = ()) -> dict[str, object]:
    """A report node for the first occurrence of `snippet` in RULES_TEXT; `values=None` = never evaluated."""
    start = RULES_TEXT.index(snippet)
    line = RULES_TEXT.count("\n", 0, start) + 1
    column = start - (RULES_TEXT.rfind("\n", 0, start) + 1) + 1
    position = {"line": line, "column": column, "currentOffset": start, "endOffset": start + len(snippet) - 1}
    result: dict[str, object] = {"sourcePosition": position, "children": list(children)}
    if values is not None:
        result["values"] = [{"value": value, "count": 1} for value in values]
    return result


def full_report(
    *,
    body: Sequence[Mapping[str, object]] | None = (TRUE, FALSE),
    condition: Sequence[Mapping[str, object]] | None = (TRUE, FALSE),
    city: Sequence[Mapping[str, object]] | None = (TRUE, FALSE),
    content: str = RULES_TEXT,
) -> dict[str, object]:
    roots = [
        node("request.auth != null", body, [node("request.auth", (MAP,))]),
        node("false", (FALSE,)),
        node(
            "signedIn() && city == 'bucuresti'",
            condition,
            [node("signedIn()", (TRUE, FALSE)), node("city == 'bucuresti'", city)],
        ),
    ]
    return {"rules": {"files": [{"name": "/repo/firebase/firestore.rules", "content": content}]}, "report": roots}


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    rules = tmp_path / "firebase" / "firestore.rules"
    rules.parent.mkdir(parents=True)
    rules.write_text(RULES_TEXT, encoding="utf-8")
    return tmp_path


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


def save(repo: Path, report: Mapping[str, object] | str) -> None:
    target = repo / coverage.JSON_REPORT
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(report if isinstance(report, str) else json.dumps(report), encoding="utf-8")


def errors(log: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in log.records if record.levelno >= logging.ERROR]


# --- check -----------------------------------------------------------------------------------------


def test_happy_path_fully_covered_report_passes(repo: Path, log: pytest.LogCaptureFixture) -> None:
    save(repo, full_report())

    assert coverage.main(["check", "--root", str(repo)]) == 0
    assert errors(log) == []
    assert log.messages[-1].startswith("[SUCCESS] rules coverage: every expression of firebase/firestore.rules evaluated")


def test_happy_path_an_error_counts_as_a_denial(repo: Path) -> None:
    save(repo, full_report(condition=(TRUE, ERROR)))

    assert coverage.check_report(repo) == []


def test_happy_path_function_bodies_and_constant_conditions_need_only_one_outcome(repo: Path) -> None:
    save(repo, full_report(body=(TRUE,)))

    assert coverage.check_report(repo) == []


def test_happy_path_a_non_boolean_value_counts_as_evaluated() -> None:
    assert coverage.outcomes_of({"values": [{"value": MAP, "count": 2}, {"value": SKIPPED, "count": 1}]}) == {"value"}


def test_bad_path_never_evaluated_expressions_are_reported_with_their_location(repo: Path, log: pytest.LogCaptureFixture) -> None:
    save(repo, full_report(city=None))

    assert coverage.main(["check", "--root", str(repo)]) == coverage.EXIT_FAILURE
    assert errors(log) == [
        "  firebase/firestore.rules:11:42 never evaluated: city == 'bucuresti'",
        "[FAILURE] rules coverage: 1 uncovered expression(s) in firebase/firestore.rules",
    ]


def test_bad_path_short_circuited_operands_are_not_evaluated(repo: Path) -> None:
    save(repo, full_report(city=(SKIPPED,)))

    assert coverage.check_report(repo) == ["firebase/firestore.rules:11:42 never evaluated: city == 'bucuresti'"]


@pytest.mark.parametrize(
    ("values", "reason"),
    [
        ((TRUE,), "condition never denied a request"),
        ((FALSE, ERROR), "condition never allowed a request"),
    ],
)
def test_bad_path_conditions_must_allow_and_deny(repo: Path, values: Sequence[Mapping[str, object]], reason: str) -> None:
    save(repo, full_report(condition=values))

    assert coverage.check_report(repo) == [f"firebase/firestore.rules:11:28 {reason}: signedIn() && city == 'bucuresti'"]


def test_bad_path_a_report_of_other_rules_is_stale(repo: Path, log: pytest.LogCaptureFixture) -> None:
    save(repo, full_report(content=RULES_TEXT.replace("bucuresti", "cluj")))

    assert coverage.main(["check", "--root", str(repo)]) == coverage.EXIT_FAILURE
    assert "was produced from different rules than firebase/firestore.rules" in errors(log)[0]


@pytest.mark.parametrize(
    ("report", "message"),
    [
        ("{not json", "is not JSON"),
        ("[]", "is not a coverage report object"),
        ({"rules": {"files": []}, "report": []}, "exactly one rules file"),
        ({"rules": [], "report": []}, "exactly one rules file"),
        ({"rules": {"files": [{"content": RULES_TEXT}]}}, "has no expression list"),
        ({"rules": {"files": [{"content": RULES_TEXT}]}, "report": [{"values": []}]}, "has no sourcePosition"),
    ],
)
def test_bad_path_malformed_reports_fail(repo: Path, log: pytest.LogCaptureFixture, report: object, message: str) -> None:
    save(repo, report if isinstance(report, str) else json.dumps(report))

    assert coverage.main(["check", "--root", str(repo)]) == coverage.EXIT_FAILURE
    assert message in errors(log)[0]


def test_bad_path_missing_report_explains_how_to_produce_it(repo: Path, log: pytest.LogCaptureFixture) -> None:
    assert coverage.main(["check", "--root", str(repo)]) == coverage.EXIT_FAILURE
    assert "not found: run the tests stage" in errors(log)[0]


def test_bad_path_malformed_children_and_values_are_ignored() -> None:
    assert coverage.children_of({"children": "x"}) == []
    assert coverage.children_of({"children": [1, {"a": 1}]}) == [{"a": 1}]
    assert coverage.outcomes_of({"values": ["x", {"count": 1}]}) == frozenset()


# --- save ------------------------------------------------------------------------------------------


class RecordingFetch:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def __call__(self, host: str, path: str) -> bytes:
        self.calls.append((host, path))
        return f"report for {path}".encode()


def test_happy_path_save_writes_json_and_html_reports(repo: Path, log: pytest.LogCaptureFixture) -> None:
    fetch = RecordingFetch()
    env = {"FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080", "GCLOUD_PROJECT": "demo-other"}

    assert coverage.main(["save", "--root", str(repo)], env=env, fetch=fetch) == 0

    assert sorted(fetch.calls) == [
        ("127.0.0.1:8080", "/emulator/v1/projects/demo-other:ruleCoverage"),
        ("127.0.0.1:8080", "/emulator/v1/projects/demo-other:ruleCoverage.html"),
    ]
    assert (repo / coverage.JSON_REPORT).read_text(encoding="utf-8") == "report for /emulator/v1/projects/demo-other:ruleCoverage"
    assert (repo / coverage.HTML_REPORT).read_text(encoding="utf-8") == "report for /emulator/v1/projects/demo-other:ruleCoverage.html"
    assert log.messages == [
        "rules coverage report saved: reports/rules/firestore-coverage.json",
        "rules coverage report saved: reports/rules/firestore-coverage.html",
    ]


def test_happy_path_save_defaults_to_the_demo_project(repo: Path) -> None:
    fetch = RecordingFetch()

    coverage.save_report(repo, {"FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"}, fetch)

    assert ("127.0.0.1:8080", "/emulator/v1/projects/demo-hcm:ruleCoverage") in fetch.calls


def test_happy_path_save_asks_for_both_reports_at_once(repo: Path) -> None:
    # Each answer costs the emulator seconds: the second request must not wait for the first answer. A fetch that
    # answers only once both requests have arrived passes only when they are in flight together.
    both_asked = threading.Barrier(2, timeout=10)

    def fetch(host: str, path: str) -> bytes:
        both_asked.wait()
        return f"{host}{path}".encode()

    written = coverage.save_report(repo, {"FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"}, fetch)

    assert [path.relative_to(repo) for path in written] == [coverage.JSON_REPORT, coverage.HTML_REPORT]


def test_bad_path_a_failed_report_fails_the_save(repo: Path, log: pytest.LogCaptureFixture) -> None:
    def fetch(host: str, path: str) -> bytes:
        if path.endswith(".html"):
            raise coverage.CoverageError(f"GET {path} from {host} returned HTTP 500")
        return b"{}"

    assert (
        coverage.main(["save", "--root", str(repo)], env={"FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080"}, fetch=fetch)
        == coverage.EXIT_FAILURE
    )
    assert errors(log) == [
        "[FAILURE] rules coverage: GET /emulator/v1/projects/demo-hcm:ruleCoverage.html from 127.0.0.1:8080 returned HTTP 500"
    ]


def test_bad_path_save_outside_the_emulators_fails(repo: Path, log: pytest.LogCaptureFixture) -> None:
    assert coverage.main(["save", "--root", str(repo)], env={}, fetch=RecordingFetch()) == coverage.EXIT_FAILURE
    assert errors(log) == ["[FAILURE] rules coverage: FIRESTORE_EMULATOR_HOST is not set: run inside `firebase emulators:exec`"]


# --- HTTP ------------------------------------------------------------------------------------------


class EmulatorHandler(socketserver.StreamRequestHandler):
    """Answers like the emulator: 200 with a JSON body for the coverage path, 404 otherwise."""

    @override
    def handle(self) -> None:
        path = self.rfile.readline().decode("ascii").split()[1]
        while self.rfile.readline().strip():
            continue
        status = "200 OK" if path.endswith(":ruleCoverage") else "404 Not Found"
        body = b'{"report": []}'
        head = f"HTTP/1.1 {status}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n"
        self.wfile.write(head.encode("ascii") + body)


@pytest.fixture
def emulator() -> Iterator[str]:
    server = socketserver.TCPServer(("127.0.0.1", 0), EmulatorHandler)
    # shutdown() waits for the serving loop's next poll: the default half second was the slowest step of this suite.
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    yield f"127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def test_happy_path_fetch_http_reads_the_body(emulator: str) -> None:
    assert coverage.fetch_http(emulator, "/emulator/v1/projects/demo-hcm:ruleCoverage") == b'{"report": []}'


def test_bad_path_fetch_http_rejects_non_200(emulator: str) -> None:
    with pytest.raises(coverage.CoverageError, match="returned HTTP 404"):
        coverage.fetch_http(emulator, "/missing")


def test_bad_path_fetch_http_reports_an_unreachable_emulator() -> None:
    server = socketserver.TCPServer(("127.0.0.1", 0), EmulatorHandler)
    host = f"127.0.0.1:{server.server_address[1]}"
    server.server_close()

    with pytest.raises(coverage.CoverageError, match="cannot reach the Firestore emulator"):
        coverage.fetch_http(host, "/emulator/v1/projects/demo-hcm:ruleCoverage")


# --- CLI -------------------------------------------------------------------------------------------


def test_bad_path_script_entry_point_exits_with_the_verdict(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "check", "--root", str(repo)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == coverage.EXIT_FAILURE
