#!/usr/bin/env bash
# Executed over SSH; stdin is the compressed workspace. The host owns capacity,
# so clients on different Macs/worktrees cannot overbook it.
set -euo pipefail
reserved=$1
run=$2
command=$3
wait_seconds=$4
deadline=$(( SECONDS + wait_seconds ))
state="$HOME/.cache/juno-runner"
mkdir -p "$state/jobs"
exec 9>"$state/lock"
capacity=$(cat "$HOME/.config/juno-runner/cores")
[[ "$capacity" =~ ^[1-9][0-9]*$ && "$reserved" =~ ^[1-9][0-9]*$ ]] || exit 70
(( reserved <= capacity )) || { echo "runner: job needs $reserved cores, host has $capacity" >&2; exit 70; }
container="juno-$run"
lease="$state/jobs/$run"
exec 8<&0
cleanup() {
  if [ -n "${child:-}" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  flock -x 9
  rm -f "$lease"
  flock -u 9
  echo __juno_remote_released
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
# Tell the client it reached the queue; do not retry a queued command.
echo __juno_remote_started
while :; do
  flock -x 9
  used=0
  containers=$(docker ps --format '{{.Names}}')
  for job in "$state"/jobs/*; do
    [ -f "$job" ] || continue
    read -r pid count name < "$job"
    if kill -0 "$pid" 2>/dev/null || grep -Fxq "$name" <<< "$containers"; then
      used=$(( used + count ))
    else
      rm -f "$job"
    fi
  done
  if (( used + reserved <= capacity )); then
    echo "$$ $reserved $container" > "$lease"
    flock -u 9
    break
  fi
  flock -u 9
  if (( wait_seconds >= 0 && SECONDS >= deadline )); then
    echo __juno_remote_busy
    exit 75
  fi
  sleep 2
done
echo __juno_remote_allocated
# A finite lifetime also bounds an orphan after a client/network failure.
# Keep this shell alive as lease owner until Docker has stopped.
timeout --signal=TERM --kill-after=30s 3h bash -c "$command" <&8 &
child=$!
wait "$child"
