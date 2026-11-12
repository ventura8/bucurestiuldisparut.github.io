#!/usr/bin/env bash
# `npm run lint`: ESLint over the whole tree, on as many workers as the cores and the free memory allow
# (scripts/ci/parallel.py lint; HCM_LINT_WORKERS sets them). Every worker builds its own TypeScript programs, so one or
# two workers hold more of them each than V8's default heap takes (measured 2026-11-12: one worker aborted at 4 GB,
# two ended ERR_WORKER_OUT_OF_MEMORY): they get a larger heap, unless NODE_OPTIONS already names one.
set -euo pipefail

heap_for() {
	case "$1" in
	1) echo 12288 ;;
	2) echo 8192 ;;
	*) echo "" ;;
	esac
}

main() {
	local workers heap
	workers="${HCM_LINT_WORKERS:-$(python3 scripts/ci/parallel.py lint)}"
	heap="$(heap_for "$workers")"
	if [[ -n "$heap" && "${NODE_OPTIONS:-}" != *max-old-space-size* ]]; then
		export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=$heap"
	fi
	exec npx eslint --concurrency="$workers" --max-warnings 0 --no-inline-config \
		--report-unused-disable-directives-severity error "$@" .
}

main "$@"
