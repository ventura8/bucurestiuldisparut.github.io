#!/bin/sh
# Historic City Map: use this computer for the imagery pipeline's jobs (docs/research/M7-local-worker.md, section 1.5).
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
#   sh hcm-worker.sh uninstall  removes the service, the worker, the sidecar, their Docker volumes and the sidecar's image
#                               (the admin's "Stop using this computer" gives this file with uninstall already chosen)
set -u

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
# The local AI (docs/research/M10-local-ai.md): a sidecar with no network, started here because the worker has no Docker socket.
MATCHER=hcm-matcher
AI_FILES=hcm-ai-files
AI_BOX=hcm-ai-box
AI_MIN_FREE_KB=31457280
AI_SECONDS=20

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

# The local AI's image as the worker's /state names it: pytorch/pytorch by digest and nothing else; nothing when it says otherwise.
ai_image() {
	found=$(printf '%s' "$1" | sed -n 's/.*"image": *"\([^"]*\)".*/\1/p')
	case "$found" in
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
		-e HCM_AI_ROOT=/ai -e PYTHONPATH=/ai/files/code:/ai/files/lib \
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
		--security-opt no-new-privileges --memory 6g --memory-swap 6g --shm-size 1g --pids-limit 512 \
		--tmpfs /tmp -u 10001:10001 -e HOME=/tmp -e HCM_AI_ROOT=/ai -e PYTHONPATH=/ai/files/code:/ai/files/lib \
		-e HCM_AI_DEVICE="$device" -e HCM_AI_WHY="$why" \
		-v "$AI_FILES:/ai/files:ro" -v "$AI_BOX:/ai/box" --entrypoint python "$image" -m matcher.serve &
}

# Graphics card first, through each way Docker offers one; only then the processor, said in plain words. Every start probes again, and a
# sidecar lives only while a frame wants it, so a driver installed later, or a card back from a suspend, is found by the next frame. A
# silent processor run is impossible: the sidecar refuses HCM_AI_DEVICE=cpu without a reason.
ai_start() {
	if ai_probe "$1" --gpus all; then
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
	if [ "$pulled" != "$wanted" ]; then
		ai_pull "$worker" "$wanted" || return 0
		ai_volumes "$worker"
		pulled=$wanted
	fi
	case "$1" in
	*'"files": true'* | *'"files":true'*) ai_keep "$wanted" ;;
	esac
}

# The machine Docker runs on, whatever an emulated image reads from inside (the worker refuses the AI on arm64).
docker_arch() {
	docker version --format '{{.Server.Arch}}' 2>/dev/null
}

# The supervisor: the worker in the foreground, started again whenever it ends: at once after an outdated image (75),
# else after a wait that grows to five minutes while it keeps failing (and starts small again after a long run). A worker
# that refuses the supervisor's arguments (usage error 2) three times in a row runs an image older than this starter:
# that is said once in the log, and the supervisor asks again every five minutes until the map is updated.
run_worker() {
	run_matcher &
	wait_seconds=10
	refused=0
	while :; do
		if image=$(current_image) && docker pull "$image" >/dev/null; then
			docker rm -f "$NAME" >/dev/null 2>&1 || true
			started=$(date +%s)
			docker run --rm --name "$NAME" -p "127.0.0.1:$PORT:$PORT" -v "$NAME:/work" \
				-v "$AI_FILES:/ai/files" -v "$AI_BOX:/ai/box" -e HCM_STARTER=2 -e HCM_DOCKER_ARCH="$(docker_arch)" "$image" \
				worker --city "$HCM_CITY" --project "$HCM_PROJECT" --supervised --image "sha256:${image##*@sha256:}"
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
		wait_seconds=$((wait_seconds < 145 ? wait_seconds * 2 + 10 : 300))
	done
}

install_linux() {
	unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
	mkdir -p "$unit_dir"
	{
		say '[Unit]'
		say 'Description=Historic City Map worker (the imagery pipeline on this computer)'
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
		say 'Name=Historic City Map worker'
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
