"""Process exit codes of a pipeline run (the Cloud Run Job task's exit status).

The job definitions run with `--max-retries 0` (retries belong to the dispatcher and the lease), and a
run that only WAITS on something outside us (USGS preparing or in maintenance, the admin's points or
approval) exits OK: `imagery.tick` resumes the job later, so no idle vCPU is billed.
"""

import enum


class ExitCode(enum.IntEnum):
    OK = 0
    """The job reached approval, waits, was cancelled or requeued, or was not this execution's to run."""
    FAILED = 1
    """The job failed (its document says why)."""
    USAGE = 2
    """Bad command line (unknown or missing step)."""
    CONFIG = 3
    """The job environment is incomplete or invalid; a retry cannot help."""
