"""Job configuration, read from the environment of the Cloud Run Job execution.

The job is deployed with plain environment variables (ids, project, buckets) and, in later
milestones, secrets mapped by `--set-secrets` (docs/research/design-review-security-cost.md §1.2);
secrets are never part of `Config`. Every value that ends up in a Cloud Storage path or a Firestore
document id is validated here, so a malformed id cannot escape its prefix.

| Variable | Meaning |
| --- | --- |
| `JOB_ID`, `CITY_ID` | the `jobs/{id}` document and its city (letters, digits, `_`, `-`) |
| `GOOGLE_CLOUD_PROJECT` | the Google Cloud project id |
| `HCM_PRIVATE_BUCKET`, `HCM_PUBLIC_BUCKET` | Cloud Storage buckets (rasters and USGS files; public previews) |
| `USGS_M2M_BASE_URL` | optional; the M2M API root (https, or http on loopback for the test server) |
| `CLOUD_RUN_EXECUTION`, `CLOUD_RUN_TASK_ATTEMPT` | set by Cloud Run; together they name the job lease owner |
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final
from urllib.parse import urlsplit

ENV_JOB_ID: Final = "JOB_ID"
ENV_CITY_ID: Final = "CITY_ID"
ENV_PROJECT: Final = "GOOGLE_CLOUD_PROJECT"
ENV_PRIVATE_BUCKET: Final = "HCM_PRIVATE_BUCKET"
ENV_PUBLIC_BUCKET: Final = "HCM_PUBLIC_BUCKET"
ENV_M2M_BASE_URL: Final = "USGS_M2M_BASE_URL"
ENV_EXECUTION: Final = "CLOUD_RUN_EXECUTION"
ENV_TASK_ATTEMPT: Final = "CLOUD_RUN_TASK_ATTEMPT"

DEFAULT_M2M_BASE_URL: Final = "https://m2m.cr.usgs.gov/api/api/json/stable/"
LOCAL_EXECUTION: Final = "local"
LOOPBACK_HOSTS: Final = frozenset({"127.0.0.1", "localhost", "::1"})

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
# Google Cloud project ids: 6-30 characters, lowercase letters, digits and hyphens, starting with a letter.
_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]")
# Bucket names: lowercase letters, digits, '-', '_' and '.' (domain-named buckets such as
# `<project>.firebasestorage.app`), starting and ending with a letter or digit.
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]")

_REQUIRED: Final[tuple[tuple[str, re.Pattern[str], str], ...]] = (
    (ENV_JOB_ID, _ID, "an id of letters, digits, '_' and '-'"),
    (ENV_CITY_ID, _ID, "an id of letters, digits, '_' and '-'"),
    (ENV_PROJECT, _PROJECT, "a Google Cloud project id"),
    (ENV_PRIVATE_BUCKET, _BUCKET, "a Cloud Storage bucket name"),
    (ENV_PUBLIC_BUCKET, _BUCKET, "a Cloud Storage bucket name"),
)


class ConfigError(ValueError):
    """The environment is incomplete or invalid; `problems` names every variable at fault (never its value)."""

    def __init__(self, problems: Sequence[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = tuple(problems)


@dataclass(frozen=True)
class Config:
    job_id: str
    city_id: str
    project_id: str
    private_bucket: str
    public_bucket: str
    m2m_base_url: str
    execution: str
    task_attempt: int

    @property
    def lease_owner(self) -> str:
        """`<execution>/<attempt>`: who holds the job lease, so a duplicate execution exits early."""
        return f"{self.execution}/{self.task_attempt}"


def _required_problem(env: Mapping[str, str], name: str, pattern: re.Pattern[str], expected: str) -> str | None:
    value = env.get(name, "")
    if not value:
        return f"{name} is not set"
    return None if pattern.fullmatch(value) else f"{name} must be {expected}"


def _url_problem(url: str) -> str | None:
    problem = f"{ENV_M2M_BASE_URL} must be an https:// URL (http:// only for a loopback test server)"
    try:
        parts = urlsplit(url)
    except ValueError:
        return problem
    allowed = {"https", "http"} if parts.hostname in LOOPBACK_HOSTS else {"https"}
    return None if parts.scheme in allowed and parts.hostname else problem


def _attempt_problem(value: str) -> str | None:
    return None if value.isdecimal() else f"{ENV_TASK_ATTEMPT} must be a non-negative integer"


def _m2m_base_url(env: Mapping[str, str]) -> str:
    url = env.get(ENV_M2M_BASE_URL) or DEFAULT_M2M_BASE_URL
    return url if url.endswith("/") else f"{url}/"


def config_problems(env: Mapping[str, str]) -> list[str]:
    """Every problem with the environment, in a stable order (empty when the job can start)."""
    found = [_required_problem(env, name, pattern, expected) for name, pattern, expected in _REQUIRED]
    found += [_url_problem(_m2m_base_url(env)), _attempt_problem(env.get(ENV_TASK_ATTEMPT, "0"))]
    return [problem for problem in found if problem is not None]


def load_config(env: Mapping[str, str]) -> Config:
    """The job configuration; raises ConfigError listing every missing or invalid variable."""
    problems = config_problems(env)
    if problems:
        raise ConfigError(problems)
    return Config(
        job_id=env[ENV_JOB_ID],
        city_id=env[ENV_CITY_ID],
        project_id=env[ENV_PROJECT],
        private_bucket=env[ENV_PRIVATE_BUCKET],
        public_bucket=env[ENV_PUBLIC_BUCKET],
        m2m_base_url=_m2m_base_url(env),
        execution=env.get(ENV_EXECUTION) or LOCAL_EXECUTION,
        task_attempt=int(env.get(ENV_TASK_ATTEMPT, "0")),
    )
