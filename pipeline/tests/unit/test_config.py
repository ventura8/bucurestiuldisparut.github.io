"""Job configuration from the environment: complete, validated, and never echoing a value back."""

import pytest
from hcm_pipeline.config import DEFAULT_M2M_BASE_URL, Config, ConfigError, config_problems, load_config

from tests.fakes.environment import VALID_ENV


def env_with(**overrides: str) -> dict[str, str]:
    return {**VALID_ENV, **overrides}


def test_happy_path_complete_environment_loads_with_defaults() -> None:
    config = load_config(VALID_ENV)

    assert config == Config(
        job_id="job-2026-10-11_a",
        city_id="bucharest",
        project_id="demo-hcm",
        private_bucket="demo-hcm.firebasestorage.app",
        public_bucket="demo-hcm-public",
        m2m_base_url=DEFAULT_M2M_BASE_URL,
        execution="local",
        task_attempt=0,
    )
    assert config.lease_owner == "local/0"


def test_happy_path_cloud_run_variables_name_the_lease_owner() -> None:
    config = load_config(env_with(CLOUD_RUN_EXECUTION="raster-pipeline-x7k2p", CLOUD_RUN_TASK_ATTEMPT="2"))

    assert config.lease_owner == "raster-pipeline-x7k2p/2"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://m2m.cr.usgs.gov/api/api/json/stable", "https://m2m.cr.usgs.gov/api/api/json/stable/"),
        ("http://127.0.0.1:8123/api/api/json/stable/", "http://127.0.0.1:8123/api/api/json/stable/"),
        ("http://localhost:8123/m2m", "http://localhost:8123/m2m/"),
    ],
)
def test_happy_path_m2m_base_url_is_normalised(url: str, expected: str) -> None:
    assert load_config(env_with(USGS_M2M_BASE_URL=url)).m2m_base_url == expected


def test_bad_path_empty_environment_lists_every_missing_variable() -> None:
    with pytest.raises(ConfigError) as caught:
        load_config({})

    assert caught.value.problems == (
        "JOB_ID is not set",
        "CITY_ID is not set",
        "GOOGLE_CLOUD_PROJECT is not set",
        "HCM_PRIVATE_BUCKET is not set",
        "HCM_PUBLIC_BUCKET is not set",
    )
    assert str(caught.value).startswith("JOB_ID is not set; CITY_ID is not set")


@pytest.mark.parametrize(
    ("name", "value", "problem"),
    [
        ("JOB_ID", "../../etc", "JOB_ID must be an id of letters, digits, '_' and '-'"),
        ("CITY_ID", "bucharest/../x", "CITY_ID must be an id of letters, digits, '_' and '-'"),
        ("GOOGLE_CLOUD_PROJECT", "Demo_Project", "GOOGLE_CLOUD_PROJECT must be a Google Cloud project id"),
        ("HCM_PRIVATE_BUCKET", "gs://bucket", "HCM_PRIVATE_BUCKET must be a Cloud Storage bucket name"),
        ("HCM_PUBLIC_BUCKET", "UPPER", "HCM_PUBLIC_BUCKET must be a Cloud Storage bucket name"),
        ("CLOUD_RUN_TASK_ATTEMPT", "-1", "CLOUD_RUN_TASK_ATTEMPT must be a non-negative integer"),
        ("CLOUD_RUN_TASK_ATTEMPT", "²", "CLOUD_RUN_TASK_ATTEMPT must be a non-negative integer"),
    ],
)
def test_bad_path_invalid_value_is_named_but_not_echoed(name: str, value: str, problem: str) -> None:
    problems = config_problems(env_with(**{name: value}))

    assert problems == [problem]
    assert value not in problem


@pytest.mark.parametrize(
    "url",
    [
        "http://m2m.cr.usgs.gov/api/api/json/stable/",
        "ftp://127.0.0.1/",
        "https:///no-host",
        "https://[::1",
        "m2m.cr.usgs.gov",
    ],
)
def test_bad_path_m2m_base_url_must_be_https_or_loopback_http(url: str) -> None:
    assert config_problems(env_with(USGS_M2M_BASE_URL=url)) == [
        "USGS_M2M_BASE_URL must be an https:// URL (http:// only for a loopback test server)"
    ]
