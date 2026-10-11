#!/usr/bin/env bash
# The single entry point for every quality stage, locally and in CI:
#
#   PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh
#
# Stages: static, tests, e2e, build, sonar, deps, release, contract, quality (static+tests+e2e+build)
# and all (quality+sonar, the default). Gates never run on the host: this wrapper builds the quality
# image, then runs scripts/ci/in-container.sh inside it as the calling user, with the repository
# mounted at the SAME absolute path (coverage report paths match Sonar's) and a throwaway HOME.
# Variables forwarded by name only (`--env NAME`, never NAME=value, so no value is in argv): CI,
# the commit ranges CI computes (GITLEAKS_LOG_OPTS, COMMIT_RANGE), E2E_SHARD and SONAR_TOKEN.
set -euo pipefail

main() {
	local root image
	root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	image="${HCM_IMAGE:-hcm-quality:local}"
	HCM_IMAGE="$image" bash "$root/scripts/ci/build-and-test.sh"
	local -a tty=()
	if [[ -t 1 ]]; then
		tty=(--tty)
	fi
	docker run --rm --init "${tty[@]}" \
		--user "$(id -u):$(id -g)" \
		--env HOME=/tmp/hcm-home \
		--env PIPELINE_STAGE="${PIPELINE_STAGE:-all}" \
		--env CI \
		--env GITLEAKS_LOG_OPTS \
		--env COMMIT_RANGE \
		--env E2E_SHARD \
		--env SONAR_TOKEN \
		--volume "$root:$root" \
		--workdir "$root" \
		"$image" bash scripts/ci/in-container.sh
	return 0
}

main "$@"
