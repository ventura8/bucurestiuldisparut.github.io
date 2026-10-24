"""The pipeline's constants and paths equal the golden contract both languages share (docs/research/M3-interfaces.md §5.8)."""

from collections.abc import Callable

import pytest
from hcm_pipeline import contract, paths

from tests.contracts_loader import golden, record, records

ENUMS = golden("enums.json")
PATHS = golden("paths.json")
BUILDERS: dict[str, Callable[..., str]] = {
    "upload": paths.upload,
    "usgsRaw": paths.usgs_raw,
    "browse": paths.browse,
    "work": paths.work,
    "version": paths.version,
    "reference": paths.reference,
}


def test_happy_path_the_constants_equal_the_shared_copy() -> None:
    sensors = {name: spec.as_contract() for name, spec in contract.SENSOR_SPECS.items()}

    assert {key: value for key, value in ENUMS.items() if key != "comment"} == {
        "JOB_STATUSES": list(contract.JOB_STATUSES),
        "JOB_WAIT_REASONS": list(contract.JOB_WAIT_REASONS),
        "JOB_STEP_STATES": list(contract.JOB_STEP_STATES),
        "PIPELINE_STEPS": list(contract.PIPELINE_STEPS),
        "JOB_STEPS": {job_type: list(steps) for job_type, steps in contract.JOB_STEPS.items()},
        "LAYER_VERSION_STATES": list(contract.LAYER_VERSION_STATES),
        "GEOREF_TRANSFORMS": list(contract.GEOREF_TRANSFORMS),
        "MIN_GCPS": dict(contract.MIN_GCPS),
        "GCP_ORIGINS": list(contract.GCP_ORIGINS),
        "VERSION_FILES": list(contract.VERSION_FILES),
        "LEASE_SECONDS": contract.LEASE_SECONDS,
        "HEARTBEAT_SECONDS": contract.HEARTBEAT_SECONDS,
        "USGS_BACKOFF_MINUTES": list(contract.USGS_BACKOFF_MINUTES),
        "SCAN_PREVIEW_MAX_PX": contract.SCAN_PREVIEW_MAX_PX,
        "STUDIO_MAX_BYTES": contract.STUDIO_MAX_BYTES,
        "SENSOR_SPECS": sensors,
    }


@pytest.mark.parametrize("job_type", ["usgs-import", "geotiff-import", "regeoref"])
def test_happy_path_each_pipeline_job_type_weighs_its_steps_to_one(job_type: str) -> None:
    weights = contract.step_weights(job_type)

    assert tuple(weights) == contract.pipeline_steps_of(job_type)
    assert sum(weights.values()) == pytest.approx(1.0)


def test_happy_path_usgs_import_keeps_the_contract_weights() -> None:
    assert contract.step_weights("usgs-import")["fetch"] == pytest.approx(0.25)
    assert contract.pipeline_steps_of("republish") == ()
    assert contract.pipeline_steps_of("unknown") == ()


@pytest.mark.parametrize("case", records(PATHS["built"]), ids=lambda case: str(case["path"]))
def test_happy_path_paths_build_exactly_the_golden_ones(case: dict[str, object]) -> None:
    args = case["args"]
    assert isinstance(args, list)

    assert BUILDERS[str(case["builder"])](*args) == case["path"]


@pytest.mark.parametrize("case", records(PATHS["refused"]), ids=lambda case: f"{case['builder']}:{case['args']}")
def test_bad_path_paths_refuse_exactly_the_golden_ones(case: dict[str, object]) -> None:
    args = case["args"]
    assert isinstance(args, list)

    with pytest.raises(paths.PathError):
        BUILDERS[str(case["builder"])](*args)


def test_happy_path_a_jobs_scratch_prefix_ends_with_a_slash() -> None:
    assert paths.work_prefix("bucharest", "job-1") == "work/bucharest/job-1/"
    assert record({"a": 1}) == {"a": 1}


@pytest.mark.parametrize(
    ("builder", "args"),
    [
        (paths.version, ("bucharest", "layer", "v1", "secrets.json")),
        (paths.reference, ("bucharest", "dem", "0f3c9a2e")),
        (paths.browse, ("declass1", "E1")),
    ],
)
def test_bad_path_unknown_files_kinds_and_datasets_are_refused(builder: object, args: tuple[str, ...]) -> None:
    assert callable(builder)
    with pytest.raises(paths.PathError):
        builder(*args)
