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
#                               runs the worker, and when the worker ends (an update, a crash) waits and starts again
#   sh hcm-worker.sh uninstall  removes the service, the worker and its Docker volume (the admin's "Stop using this
#                               computer" gives this file with uninstall already chosen)
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

# The supervisor: the worker in the foreground, started again whenever it ends: at once after an outdated image (75),
# else after a wait that grows to five minutes while it keeps failing (and starts small again after a long run). A worker
# that refuses the supervisor's arguments (usage error 2) three times in a row runs an image older than this starter:
# that is said once in the log, and the supervisor asks again every five minutes until the map is updated.
run_worker() {
	wait_seconds=10
	refused=0
	while :; do
		if image=$(current_image) && docker pull "$image" >/dev/null; then
			docker rm -f "$NAME" >/dev/null 2>&1 || true
			started=$(date +%s)
			docker run --rm --name "$NAME" -p "127.0.0.1:$PORT:$PORT" -v "$NAME:/work" "$image" \
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
	docker rm -f "$NAME" >/dev/null 2>&1 || true
	docker volume rm "$NAME" >/dev/null 2>&1 || true
	rm -rf "$(home_dir)"
	say 'The worker is removed from this computer.'
}

case "${1:-$HCM_ACTION}" in
run) run_worker ;;
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
