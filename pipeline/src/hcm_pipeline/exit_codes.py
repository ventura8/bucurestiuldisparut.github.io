"""Process exit codes of a pipeline run (the Cloud Run Job task's exit status).

Cloud Run retries a task that exits non-zero (`--max-retries`), so a step that is only WAITING on
something outside us (USGS preparing or in maintenance, Mapbox processing) exits OK and the scheduled
`ops.tick` resumes the job later; a retry would bill idle vCPU for nothing.
"""

import enum


class ExitCode(enum.IntEnum):
    OK = 0
    """The step finished, or recorded that it waits on USGS or Mapbox."""
    FAILED = 1
    """The step failed; Cloud Run may retry it."""
    USAGE = 2
    """Bad command line (unknown or missing step)."""
    CONFIG = 3
    """The job environment is incomplete or invalid; a retry cannot help."""
