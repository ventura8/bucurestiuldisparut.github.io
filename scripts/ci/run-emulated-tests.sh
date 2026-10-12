#!/usr/bin/env bash
# Body of the `vitest` gate (`npm test`): runs INSIDE `firebase emulators:exec --project demo-hcm
# --only auth,firestore,storage` (package.json), so every Vitest project shares the emulators: the
# security-rules matrix (firebase/rules-tests) and the emulator-backed functions tests run in the same
# `vitest run --coverage` as the rest, which keeps ONE merged lcov (reports/coverage/ts/lcov.info).
#
# Afterwards it saves the Firestore emulator's rule-coverage report (only reachable while the
# emulators run) to reports/rules/; the `rules-coverage` gate then checks it
# (scripts/ci/check_rules_coverage.py). The report is saved even when Vitest fails, and the
# Vitest exit status is preserved.
set -uo pipefail

# No test may reach the network: without this, firebase-admin's Google clients probe the GCE metadata
# server (MetadataLookupWarning ... ETIMEDOUT), which on a busy machine also pushed emulator tests past
# their hook timeouts (CR-M2-34, docs/research/M2-interfaces.md).
export METADATA_SERVER_DETECTION=none

npm run --silent test:unit
status=$?
python3 scripts/ci/check_rules_coverage.py save || status=1
exit "$status"
