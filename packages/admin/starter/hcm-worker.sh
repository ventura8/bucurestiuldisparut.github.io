#!/bin/sh
# Historic City Map Maker: use this computer for the imagery pipeline's jobs (docs/research/M7-local-worker.md, section 1.5).
#
# The admin's "Use this computer" fills the three values below and gives this file a name (hcm-worker.sh on Linux,
# hcm-worker.command on macOS). It holds no secret: the admin pairs this computer by itself once the worker runs.
#
#   sh hcm-worker.sh            sets this computer up once: checks Docker, copies itself to a folder of yours and
#                               installs a background service of your user (systemd --user on Linux, a LaunchAgent on
#                               macOS; no sudo), which starts with your session and after a reboot
#   sh hcm-worker.sh run        the service itself: asks the server for the installed pipeline image, pulls it by digest,
#                               runs the worker, and when the worker ends (an update, a crash) waits and starts again;
#                               beside it, while a frame needs the local AI, the sidecar on this computer's graphics card
#   sh hcm-worker.sh matcher    that sidecar's loop alone
#   sh hcm-worker.sh governor   the governor's loop alone: host hints and the worker's CPU quota (docs/research/M26-governor.md)
#   sh hcm-worker.sh update     one look for a newer starter of the installed release (the service looks when it starts, whenever
#                               the worker ends, and once a day): checked against the release's list, it replaces this file
#   sh hcm-worker.sh uninstall  removes the service, the worker, the sidecar, their Docker volumes and the sidecar's image
#                               (the admin's "Stop using this computer" gives this file with uninstall already chosen)
#
# The worker leaves this computer usable (reports/resource-audit.md): it may hold at most 60 % of the memory Docker has
# (an out-of-memory run ends the job, not the desktop) and yields the processor to everything else. To change that, set
# in the service's environment: HCM_WORKER_MEMORY (a Docker size as 8g, or none for no limit) and HCM_WORKER_THREADS
# (how many threads GDAL uses; the worker's own choice is the cores but one).
set -u

# This file's version: the first 12 hex digits of the SHA-256 of both starter templates with this line emptied
# (scripts/site/src/admin/starter.ts; a test fails when the files change and it does not). The worker gets it as HCM_STARTER.
STARTER_VERSION=881afefcef25

HCM_PROJECT='__HCM_PROJECT__'
HCM_CITY='__HCM_CITY__'
HCM_ACTION='__HCM_ACTION__'

NAME=hcm-worker
PORT=8765
OUTDATED=75
# The worker's usage error (argparse): an image older than this starter's supervisor (finding 74 of 2026-11-03).
USAGE=2
REFUSALS=3
LABEL=org.historiccitymap.worker
GET_DOCKER=https://docs.docker.com/get-started/get-docker/
IMAGE_API="https://us-central1-${HCM_PROJECT}.cloudfunctions.net/worker-image"
IMAGE_PREFIX="us-central1-docker.pkg.dev/${HCM_PROJECT}/hcm/pipeline@sha256:"
# The starter the installed release publishes (docs/research/M7-local-worker.md, *The starter updates itself*): the list on the map's
# Hosting (the admin's build writes it: the version and each template's SHA-256) and the file from the server's worker.starter.
STARTER_LIST="https://${HCM_PROJECT}.web.app/admin/starter.json"
STARTER_API="https://us-central1-${HCM_PROJECT}.cloudfunctions.net/worker-starter"
UPDATE_SECONDS=86400
# What the last look said, for the admin (the worker passes it on as HCM_STARTER_UPDATE).
update_said=unchecked
# The local AI (docs/research/M10-local-ai.md): a sidecar with no network, started here because the worker has no Docker socket.
MATCHER=hcm-matcher
AI_FILES=hcm-ai-files
AI_BOX=hcm-ai-box
AI_MIN_FREE_KB=31457280
AI_SECONDS=20
# The sidecar's folder of unpacked packages in the AI's volume: lib for PyTorch's image, lib-cpu for the worker's own (ai_start).
AI_LIB=lib
# The governor (docs/research/M26-governor.md): what only the host can say, every few seconds, and the worker's CPU quota.
GOVERN_SECONDS=5
HINTS=/work/host-hints.json
# The worker's share of the memory Docker has, and its weight against other containers (Docker's default is 1024).
WORKER_MEMORY_PCT=60
WORKER_CPU_SHARES=256

say() {
	printf '%s\n' "$*"
}

# Keeps a Terminal window that a double-click opened until the owner has read it.
pause() {
	if [ -t 0 ]; then
		printf '%s' 'Press Enter to close this window. '
		read -r _
	fi
}

is_mac() {
	[ "$(uname -s)" = Darwin ]
}

home_dir() {
	if is_mac; then
		printf '%s' "$HOME/Library/Application Support/$NAME"
	else
		printf '%s' "${XDG_DATA_HOME:-$HOME/.local/share}/$NAME"
	fi
}

open_url() {
	if is_mac; then
		open "$1" >/dev/null 2>&1 || true
	else
		xdg-open "$1" >/dev/null 2>&1 || true
	fi
}

# Docker must be installed and running, and usable by this account.
check_docker() {
	if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
		return 0
	fi
	say 'Docker is not installed or not running (or this account may not use it).'
	say "Get Docker: $GET_DOCKER"
	say 'Start Docker, then open this file again.'
	open_url "$GET_DOCKER"
	return 1
}

# The installed pipeline image, by digest, as the server names it (worker.image); nothing when it cannot say.
current_image() {
	answer=$(curl -fsS -m 30 -X POST -H 'Content-Type: application/json' -d '{"data":{}}' "$IMAGE_API" 2>/dev/null) || return 1
	image=$(printf '%s' "$answer" | sed -n 's/.*"image":"\([^"]*\)".*/\1/p')
	case "$image" in
	"$IMAGE_PREFIX"*) ;;
	*) return 1 ;;
	esac
	digest=${image#"$IMAGE_PREFIX"}
	if [ "${#digest}" -ne 64 ] || [ -n "$(printf '%s' "$digest" | tr -d '0-9a-f')" ]; then
		return 1
	fi
	printf '%s' "$image"
}

# The local AI's image as the worker's /state names it: pytorch/pytorch by digest, or `worker` (the worker's own image, on a computer
# with no NVIDIA card) and nothing else; nothing when it says otherwise.
ai_image() {
	found=$(printf '%s' "$1" | sed -n 's/.*"image": *"\([^"]*\)".*/\1/p')
	case "$found" in
	worker)
		printf worker
		return 0
		;;
	pytorch/pytorch@sha256:* | pytorch/pytorch:*@sha256:*) ;;
	*) return 1 ;;
	esac
	digest=${found##*@sha256:}
	if [ "${#digest}" -ne 64 ] || [ -n "$(printf '%s' "$digest" | tr -d '0-9a-f')" ]; then
		return 1
	fi
	case "${found%%@*}" in
	*[!A-Za-z0-9/:._-]*) return 1 ;;
	esac
	printf '%s' "$found"
}

# Which sidecar this computer gets (docs/research/M26-governor.md §5): gpu when an NVIDIA card answers here, PyTorch's own image of
# about 10 GB; else cpu, the worker's own image and PyTorch for the processor in the AI's volume, about 1 GB. HCM_AI_VARIANT decides.
ai_variant() {
	case "${HCM_AI_VARIANT:-}" in
	gpu | cpu)
		printf '%s' "$HCM_AI_VARIANT"
		return
		;;
	esac
	if nvidia-smi -L 2>/dev/null | grep -q '^GPU'; then
		printf gpu
	else
		printf cpu
	fi
}

# The image the worker's container runs: what prepares the volumes and reads the disk, since a host's own tools may not see Docker's disk.
worker_image() {
	docker inspect --format '{{.Config.Image}}' "$NAME" 2>/dev/null
}

# Says in the box why the sidecar cannot come (the panel shows it, the worker stops waiting); a word of this file only, never data.
ai_refused() {
	say "local AI: unavailable ($2)"
	docker run --rm -u 10001:10001 --network none -v "$AI_BOX:/ai/box" --entrypoint sh "$1" \
		-c "printf '{\"state\":\"unavailable\",\"why\":\"$2\"}' > /ai/box/starter.json" >/dev/null 2>&1 || true
}

# Free kilobytes where Docker keeps images, read inside a container: on Docker Desktop the host's disk says nothing of it.
docker_free_kb() {
	docker run --rm --network none --entrypoint df "$1" -Pk / 2>/dev/null | sed -n '2s/^[^ ]* *[0-9]* *[0-9]* *\([0-9]*\).*/\1/p'
}

# The image on this computer: pulled once a frame needs it, when there is room for it. One already here is used as it is: every start of
# this loop comes here, and a computer offline, or Docker Hub refusing, must not cost a working sidecar.
ai_pull() {
	if docker image inspect "$2" >/dev/null 2>&1; then
		return 0
	fi
	free=$(docker_free_kb "$1")
	if [ -z "$free" ] || [ "$free" -lt "$AI_MIN_FREE_KB" ]; then
		ai_refused "$1" disk
		return 1
	fi
	say 'local AI: first use: about 10 GB to fetch, once; it runs on this computer, never in a cloud'
	if ! docker pull "$2" >/dev/null; then
		ai_refused "$1" pull
		return 1
	fi
	ai_note "$2"
}

# The images this file pulled, one a line: uninstall removes those and no other. A new pin's pull lets the earlier ones go at once, about
# 10 GB each; one Docker will not remove yet stays noted.
ai_note() {
	mkdir -p "$(home_dir)"
	note="$(home_dir)/ai-image"
	ai_stop
	touch "$note"
	while IFS= read -r old || [ -n "$old" ]; do
		if [ "$old" != "$1" ] && ! docker image rm "$old" >/dev/null 2>&1 </dev/null; then
			printf '%s\n' "$old"
		fi
	done <"$note" >"$note.new"
	printf '%s\n' "$1" >>"$note.new"
	mv "$note.new" "$note"
}

# The volumes' owner is the sidecar's user: one run of the worker's image, whose empty folders Docker copies with their owner.
ai_volumes() {
	docker run --rm --network none -v "$AI_FILES:/ai/files" -v "$AI_BOX:/ai/box" --entrypoint true "$1" >/dev/null 2>&1 || true
}

# What PyTorch sees under these flags, inside the sidecar's own image and limits: 0 it may use the card, else why not, said: a Docker or
# a driver that refused this once is not a computer with no card. `none` is the reason's place: a graphics card needs none, and Windows
# PowerShell drops an empty argument, so both files pass a word.
ai_probe() {
	image=$1
	shift
	docker run --rm "$@" --network none --cap-drop ALL --security-opt no-new-privileges -u 10001:10001 -e HOME=/tmp --tmpfs /tmp \
		-e HCM_AI_ROOT=/ai -e PYTHONPATH=/ai/files/code:/ai/files/$AI_LIB \
		-v "$AI_FILES:/ai/files:ro" -v "$AI_BOX:/ai/box" --entrypoint python "$image" -m matcher.child probe gpu none >/dev/null 2>&1
	code=$?
	case $code in
	0) ;;
	77) say 'local AI: no graphics card seen' ;;
	76) say 'local AI: the graphics card has under 2 GB of memory' ;;
	*) say "local AI: Docker or the graphics driver refused the graphics card (code $code)" ;;
	esac
	return "$code"
}

# The sidecar itself, beside this loop: the loop keeps reading /state. The client in the background keeps its log in this service's and
# carries a stop of the service to the container.
ai_run() {
	image=$1
	device=$2
	why=$3
	shift 3
	docker rm -f "$MATCHER" >/dev/null 2>&1 || true
	docker run --rm --name "$MATCHER" "$@" --network none --cap-drop ALL \
		--security-opt no-new-privileges --memory 4g --memory-swap 4g --cpu-shares 128 --shm-size 1g --pids-limit 512 \
		--tmpfs /tmp -u 10001:10001 -e HOME=/tmp -e HCM_AI_ROOT=/ai -e PYTHONPATH=/ai/files/code:/ai/files/$AI_LIB \
		-e HCM_AI_DEVICE="$device" -e HCM_AI_WHY="$why" \
		-v "$AI_FILES:/ai/files:ro" -v "$AI_BOX:/ai/box" --entrypoint python "$image" -m matcher.serve &
}

# Graphics card first, through each way Docker offers one; only then the processor, said in plain words. Every start probes again, and a
# sidecar lives only while a frame wants it, so a driver installed later, or a card back from a suspend, is found by the next frame. A
# silent processor run is impossible: the sidecar refuses HCM_AI_DEVICE=cpu without a reason.
ai_start() {
	AI_LIB=lib
	if [ "$1" = "$(worker_image)" ]; then
		AI_LIB=lib-cpu
		say "local AI: on the processor, in the worker's own image (no NVIDIA card on this computer)"
		ai_run "$1" cpu no-gpu
	elif ai_probe "$1" --gpus all; then
		say 'local AI: graphics card found'
		ai_run "$1" gpu '' --gpus all
	elif docker info 2>/dev/null | grep -q nvidia.com/gpu && ai_probe "$1" --device nvidia.com/gpu=all; then
		say 'local AI: graphics card found'
		ai_run "$1" gpu '' --device nvidia.com/gpu=all
	else
		say 'local AI: no usable graphics card; using the processor (slower)'
		ai_run "$1" cpu no-gpu
	fi
}

# The sidecar this loop started, by its image, gone: what a frame no longer wants, or a worker no longer here, holds no container.
ai_stop() {
	if [ -n "$sidecar" ]; then
		docker rm -f "$MATCHER" >/dev/null 2>&1 || true
		sidecar=''
	fi
}

ai_up() {
	[ "$(docker inspect --format '{{.State.Running}}' "$MATCHER" 2>/dev/null)" = true ]
}

# The sidecar of the image the worker names, up: a new pin, or one that ended (77, 76, a crash), starts again and probes again.
ai_keep() {
	if [ "$sidecar" = "$1" ] && ai_up; then
		return 0
	fi
	ai_stop
	ai_start "$1"
	sidecar=$1
}

# Beside the worker: polls its /state, and while a frame wants the AI and its files are there, keeps the sidecar up; once none does, or the
# worker has not answered twice running, removes it. Never a Docker socket in the worker: this file, the owner's own, is what may start a
# container. A sidecar an earlier loop left goes first.
run_matcher() {
	pulled=''
	sidecar=''
	missed=0
	supervisor=$$
	docker rm -f "$MATCHER" >/dev/null 2>&1 || true
	trap 'ai_stop; exit 0' TERM INT
	while kill -0 "$supervisor" 2>/dev/null; do
		state=$(curl -fsS -m 5 "http://127.0.0.1:$PORT/state" 2>/dev/null) || state=''
		matcher_heard "$state"
		sleep "$AI_SECONDS"
	done
	ai_stop
}

matcher_heard() {
	case "$1" in
	'')
		missed=$((missed + 1))
		if [ "$missed" -ge 2 ]; then
			ai_stop
		fi
		;;
	*'"wanted": true'* | *'"wanted":true'*)
		missed=0
		matcher_pass "$1"
		;;
	*)
		missed=0
		ai_stop
		;;
	esac
}

matcher_pass() {
	wanted=$(ai_image "$1") || {
		say 'local AI: refused an unexpected program image'
		return 0
	}
	worker=$(worker_image) || return 0
	if [ "$wanted" = worker ]; then
		wanted=$worker
	fi
	if [ "$pulled" != "$wanted" ]; then
		if [ "$wanted" != "$worker" ]; then
			ai_pull "$worker" "$wanted" || return 0
		fi
		ai_volumes "$worker"
		pulled=$wanted
	fi
	case "$1" in
	*'"files": true'* | *'"files":true'*) ai_keep "$wanted" ;;
	esac
}

# Seconds since the last keyboard or mouse input on this computer; nothing when it cannot be read (the governor then never says active).
# GNOME's idle monitor (Wayland and X11), xprintidle, then logind's IdleHint (set only after the desktop's own idle delay); macOS's HID.
idle_seconds() {
	if is_mac; then
		ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ { print int($NF / 1000000000); exit }'
		return
	fi
	ms=$(gdbus call --session --dest org.gnome.Mutter.IdleMonitor --object-path /org/gnome/Mutter/IdleMonitor/Core \
		--method org.gnome.Mutter.IdleMonitor.GetIdletime 2>/dev/null | sed -n 's/^(uint64 \([0-9]*\),)$/\1/p')
	[ -n "$ms" ] || ms=$(xprintidle 2>/dev/null)
	if [ -n "$ms" ]; then
		printf '%s' $((ms / 1000))
		return
	fi
	logind_idle
}

logind_idle() {
	session=${XDG_SESSION_ID:-$(loginctl list-sessions --no-legend 2>/dev/null | awk -v u="$(id -un)" '$3 == u { print $1; exit }')}
	[ -n "$session" ] || return 0
	case "$(loginctl show-session "$session" -p IdleHint --value 2>/dev/null)" in
	no) printf '0' ;;
	yes)
		since=$(loginctl show-session "$session" -p IdleSinceHint --value 2>/dev/null)
		[ -n "$since" ] && [ "$since" -gt 0 ] && printf '%s' $(($(date +%s) - since / 1000000))
		;;
	esac
}

# The graphics cards and NPUs Docker could pass to the sidecar, as JSON fields: NVIDIA's (nvidia-smi: memory, use, heat; CUDA when
# Docker has the NVIDIA runtime or CDI), Intel's and AMD's render nodes (OpenVINO, ROCm), Intel's NPU (/dev/accel). Never on macOS.
host_gpus() {
	via=null
	if docker info 2>/dev/null | grep -qi 'nvidia'; then
		via='"cuda"'
	fi
	nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null |
		awk -F', *' -v via="$via" '{ printf "%s{\"vendor\":\"nvidia\",\"name\":\"%s\",\"vramMb\":%d,\"othersMb\":%d,\"busyPct\":%d,\"tempC\":%d,\"via\":%s}", \
			(NR > 1 ? "," : ""), $1, $2, $3, $4, $5, via }'
	for vendor in /sys/class/drm/card*/device/vendor; do
		case "$(cat "$vendor" 2>/dev/null)" in
		0x8086) [ -e /dev/dri ] && printf '%s' ',{"vendor":"intel","name":"Intel graphics","vramMb":0,"via":"openvino"}' ;;
		0x1002) [ -e /dev/kfd ] && printf '%s' ',{"vendor":"amd","name":"AMD graphics","vramMb":0,"via":"rocm"}' ;;
		esac
	done
}

host_npus() {
	if [ -e /dev/accel/accel0 ]; then
		printf '%s' '{"vendor":"intel","name":"NPU","via":"openvino"}'
	fi
}

# macOS's battery (a Linux container reads its own from /sys).
host_power() {
	is_mac || return 0
	pmset -g batt 2>/dev/null | awk '/Battery Power/ { b = 1 } /AC Power/ { b = 0 } /[0-9]+%/ { match($0, /[0-9]+%/); p = substr($0, RSTART, RLENGTH - 1) }
		END { printf ",\"power\":{\"source\":\"%s\",\"percent\":%d}", (b ? "battery" : "ac"), p }'
}

# The hints in the worker's volume, by a rename, through the worker's own container (this file never mounts its volume).
write_hints() {
	idle=$(idle_seconds)
	gpus=$(host_gpus | sed 's/^,//')
	json=$(printf '{"at":%s,"idleS":%s,"gpus":[%s],"npus":[%s]%s}' "$(date +%s)" "${idle:-null}" "$gpus" "$(host_npus)" "$(host_power)")
	printf '%s' "$json" | docker exec -i "$NAME" sh -c "cat > $HINTS.part && mv $HINTS.part $HINTS" >/dev/null 2>&1 || true
}

# The budget's threads as the worker's CPU quota: `docker update --cpus`, only when they change (a pause keeps the last quota: the step
# waits at the gate). The worker reads the quota back from its cgroup's cpu.max.
govern_pass() {
	write_hints
	threads=$(printf '%s' "$1" | sed -n 's/.*"budget": *{"threads": *\([0-9]*\).*/\1/p')
	if [ -n "$threads" ] && [ "$threads" -gt 0 ] && [ "$threads" != "$quota" ]; then
		docker update --cpus "$threads" "$NAME" >/dev/null 2>&1 && quota=$threads && say "governor: the worker may use $threads cores"
	fi
}

# Beside the worker, for as long as the supervisor lives: the host's hints and the quota, every GOVERN_SECONDS.
run_governor() {
	quota=''
	supervisor=$$
	while kill -0 "$supervisor" 2>/dev/null; do
		state=$(curl -fsS -m 3 "http://127.0.0.1:$PORT/state" 2>/dev/null) && govern_pass "$state"
		sleep "$GOVERN_SECONDS"
	done
}

# The machine Docker runs on, whatever an emulated image reads from inside (the worker refuses the AI on arm64).
docker_arch() {
	docker version --format '{{.Server.Arch}}' 2>/dev/null
}

# The worker's memory limit in bytes: HCM_WORKER_MEMORY as given (none: no limit), else WORKER_MEMORY_PCT of what Docker
# has (on Docker Desktop, of its virtual machine); nothing when Docker does not say.
worker_memory() {
	case "${HCM_WORKER_MEMORY:-}" in
	none) return ;;
	'') ;;
	*)
		printf '%s' "$HCM_WORKER_MEMORY"
		return
		;;
	esac
	total=$(docker info --format '{{.MemTotal}}' 2>/dev/null)
	case "$total" in
	'' | *[!0-9]*) return ;;
	esac
	printf '%s' "$((total * WORKER_MEMORY_PCT / 100))"
}

# The worker in the foreground, from the image $1: capped in memory (no swap beyond it), light against other containers.
start_worker() {
	image=$1
	set -- --cpu-shares "$WORKER_CPU_SHARES"
	memory=$(worker_memory)
	if [ -n "$memory" ]; then
		set -- "$@" --memory "$memory" --memory-swap "$memory"
	fi
	if [ -n "${HCM_WORKER_THREADS:-}" ]; then
		set -- "$@" -e "GDAL_NUM_THREADS=$HCM_WORKER_THREADS"
	fi
	docker run --rm --name "$NAME" "$@" -p "127.0.0.1:$PORT:$PORT" -v "$NAME:/work" \
		-v "$AI_FILES:/ai/files" -v "$AI_BOX:/ai/box" -e HCM_STARTER="$STARTER_VERSION" -e HCM_STARTER_UPDATE="$update_said" \
		-e HCM_DOCKER_ARCH="$(docker_arch)" -e HCM_AI_VARIANT="$(ai_variant)" "$image" \
		worker --city "$HCM_CITY" --project "$HCM_PROJECT" --supervised --image "sha256:${image##*@sha256:}"
}

# The copy the installer made, which the service runs: the only file that updates itself.
installed_copy() {
	printf '%s' "$(home_dir)/$NAME.sh"
}

sha256_of_input() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum
	else
		shasum -a 256
	fi | sed -n '1s/^\([0-9a-f]\{64\}\).*/\1/p'
}

# The template a served file was filled from: its three values put back as the marks (written here in pieces: the server fills
# every whole mark of this file).
as_template() {
	u=_
	sed -e "s/^HCM_PROJECT=.*/HCM_PROJECT='$u${u}HCM_PROJECT$u$u'/" -e "s/^HCM_CITY=.*/HCM_CITY='$u${u}HCM_CITY$u$u'/" \
		-e "s/^HCM_ACTION=.*/HCM_ACTION='$u${u}HCM_ACTION$u$u'/" "$1"
}

# The version written in a file (the installed copy, once the look beside the worker replaced it).
version_in() {
	sed -n 's/^STARTER_VERSION=\([0-9a-f]*\)$/\1/p' "$1" 2>/dev/null
}

# One look at the starter the installed release publishes: 0 when a newer one, whose SHA-256 is the release's list's, replaced
# this file (update_said=updated); else 1, and update_said says why not: current, not-installed, no-list, no-file, bad-sum, read-only.
starter_update() {
	self=$(installed_copy)
	if [ "$0" != "$self" ]; then
		update_said=not-installed
		return 1
	fi
	listed=$(curl -fsS -m 30 "$STARTER_LIST" 2>/dev/null | tr -d ' \r\n')
	version=$(printf '%s' "$listed" | sed -n 's/.*"version":"\([0-9a-f]\{12\}\)".*/\1/p')
	sum=$(printf '%s' "$listed" | sed -n 's/.*"posix":"\([0-9a-f]\{64\}\)".*/\1/p')
	if [ -z "$version" ] || [ -z "$sum" ]; then
		update_said=no-list
		return 1
	fi
	if [ "$version" = "$STARTER_VERSION" ]; then
		update_said=current
		return 1
	fi
	starter_replace "$self" "$version" "$sum"
}

# The newer file fetched, checked against the list (its SHA-256 as a template, its version line), and put in place by a rename.
starter_replace() {
	os=linux
	if is_mac; then
		os=mac
	fi
	rm -f "$1.part" "$1.new"
	if ! curl -fsS -m 60 -o "$1.part" "$STARTER_API?city=$HCM_CITY&os=$os&action=install" 2>/dev/null; then
		update_said=no-file
	elif [ "$(as_template "$1.part" | sha256_of_input)" != "$3" ] || [ "$(version_in "$1.part")" != "$2" ]; then
		update_said=bad-sum
	elif sed "s/^HCM_ACTION=.*/HCM_ACTION='run'/" "$1.part" >"$1.new" 2>/dev/null && chmod 700 "$1.new" && mv -f "$1.new" "$1"; then
		update_said=updated
	else
		update_said=read-only
	fi
	rm -f "$1.part" "$1.new"
	say "starter: the look for a newer starter said $update_said"
	[ "$update_said" = updated ]
}

# Once a day beside the worker: a newer file waits for the worker to be idle, then the worker stops and the supervisor starts the file.
run_updater() {
	supervisor=$$
	while sleep "$UPDATE_SECONDS" && kill -0 "$supervisor" 2>/dev/null; do
		if starter_update; then
			while curl -fsS -m 5 "http://127.0.0.1:$PORT/state" 2>/dev/null | grep -q '"state": *"busy"'; do
				sleep 60
			done
			docker stop "$NAME" >/dev/null 2>&1 || true
		fi
	done
}

# This process becomes the newer file: the loops beside the worker go first (the file starts its own).
starter_restart() {
	kill "$matcher_pid" "$governor_pid" "$updater_pid" 2>/dev/null || true
	say 'starter: starting the updated file'
	exec /bin/sh "$0" run
}

# The supervisor: a newer starter of the installed release first (this process then runs it), then the worker in the
# foreground, started again whenever it ends (a newer starter, the daily look's too, first): at once after an outdated image (75),
# else after a wait that grows to five minutes while it keeps failing (and starts small again after a long run). A worker
# that refuses the supervisor's arguments (usage error 2) three times in a row runs an image older than this starter:
# that is said once in the log, and the supervisor asks again every five minutes until the map is updated.
run_worker() {
	if starter_update; then
		exec /bin/sh "$0" run
	fi
	say "starter $STARTER_VERSION: the look for a newer starter said $update_said"
	run_matcher &
	matcher_pid=$!
	run_governor &
	governor_pid=$!
	run_updater &
	updater_pid=$!
	wait_seconds=10
	refused=0
	while :; do
		if image=$(current_image) && docker pull "$image" >/dev/null; then
			docker rm -f "$NAME" >/dev/null 2>&1 || true
			started=$(date +%s)
			start_worker "$image"
			code=$?
			if [ "$code" -eq "$OUTDATED" ] || [ $(($(date +%s) - started)) -gt 600 ]; then
				wait_seconds=0
			fi
			refused=$((code == USAGE ? refused + 1 : 0))
		fi
		if [ "$refused" -eq "$REFUSALS" ]; then
			say "The server named an image that does not support this computer's starter: update the map."
			say 'In the admin: Setup, Update the map. The worker is asked for again every 5 minutes.'
		fi
		if [ "$refused" -ge "$REFUSALS" ]; then
			wait_seconds=300
		fi
		sleep "$wait_seconds"
		if [ "$(version_in "$0")" != "$STARTER_VERSION" ] || starter_update; then
			starter_restart
		fi
		wait_seconds=$((wait_seconds < 145 ? wait_seconds * 2 + 10 : 300))
	done
}

install_linux() {
	unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
	mkdir -p "$unit_dir"
	{
		say '[Unit]'
		say 'Description=Historic City Map Maker worker (the imagery pipeline on this computer)'
		say 'After=network-online.target'
		say '[Service]'
		say "Environment=\"PATH=$PATH\""
		if [ -n "${DOCKER_HOST:-}" ]; then
			say "Environment=\"DOCKER_HOST=$DOCKER_HOST\""
		fi
		say "ExecStart=/bin/sh \"$1\" run"
		say 'Restart=always'
		say 'RestartSec=30'
		say '[Install]'
		say 'WantedBy=default.target'
	} >"$unit_dir/$NAME.service"
	systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user enable "$NAME.service" >/dev/null 2>&1 &&
		systemctl --user restart "$NAME.service" >/dev/null 2>&1
}

# Without systemd's user services: the desktop's autostart at the next login, and the supervisor started now.
install_autostart() {
	rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$NAME.service"
	autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
	mkdir -p "$autostart"
	{
		say '[Desktop Entry]'
		say 'Type=Application'
		say 'Name=Historic City Map Maker worker'
		say "Exec=sh \"$1\" run"
		say 'NoDisplay=true'
	} >"$autostart/$NAME.desktop"
	pkill -f "$NAME.sh run" >/dev/null 2>&1 || true
	nohup sh "$1" run >/dev/null 2>&1 &
}

install_mac() {
	agents="$HOME/Library/LaunchAgents"
	plist="$agents/$LABEL.plist"
	mkdir -p "$agents" "$HOME/Library/Logs"
	cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key><array><string>/bin/sh</string><string>$1</string><string>run</string></array>
	<key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin</string></dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>$HOME/Library/Logs/$NAME.log</string>
	<key>StandardErrorPath</key><string>$HOME/Library/Logs/$NAME.log</string>
</dict>
</plist>
PLIST
	launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
	launchctl bootstrap "gui/$(id -u)" "$plist"
}

install_worker() {
	check_docker || return 1
	folder=$(home_dir)
	mkdir -p "$folder"
	copy="$folder/$NAME.sh"
	sed "s/^HCM_ACTION=.*/HCM_ACTION='run'/" "$0" >"$copy"
	chmod 700 "$copy"
	if is_mac; then
		install_mac "$copy" || return 1
	elif ! install_linux "$copy"; then
		install_autostart "$copy"
	fi
	say 'This computer is set up: the worker runs in the background and starts with your session.'
	say 'Go back to the admin: it connects this computer by itself.'
}

uninstall_worker() {
	if is_mac; then
		launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
		rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
	else
		systemctl --user disable --now "$NAME.service" >/dev/null 2>&1 || true
		rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$NAME.service"
		systemctl --user daemon-reload >/dev/null 2>&1 || true
		rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/$NAME.desktop"
		pkill -f "$NAME.sh run" >/dev/null 2>&1 || true
	fi
	docker rm -f "$NAME" "$MATCHER" >/dev/null 2>&1 || true
	docker volume rm "$NAME" "$AI_FILES" "$AI_BOX" >/dev/null 2>&1 || true
	# Only the images this file pulled, by the names it noted: the owner's other PyTorch images stay.
	if [ -s "$(home_dir)/ai-image" ]; then
		while IFS= read -r each || [ -n "$each" ]; do
			docker image rm "$each" >/dev/null 2>&1 </dev/null || true
		done <"$(home_dir)/ai-image"
	fi
	rm -rf "$(home_dir)"
	say 'The worker is removed from this computer.'
}

case "${1:-$HCM_ACTION}" in
run) run_worker ;;
matcher) run_matcher ;;
governor) run_governor ;;
update)
	starter_update
	say "$update_said"
	;;
uninstall)
	uninstall_worker
	pause
	;;
*)
	install_worker
	status=$?
	pause
	exit "$status"
	;;
esac
