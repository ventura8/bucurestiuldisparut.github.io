"""`python -m hcm_pipeline <step>`: the entry point of the Cloud Run Job image."""

import sys

from hcm_pipeline.main import main

if __name__ == "__main__":
    sys.exit(main())
