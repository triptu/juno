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
# Direct execution is used by the Linux host tests; SSH embeds this helper.
declare -F runner_capacity >/dev/null || source "$(dirname "$0")/runner-capacity.sh"
runner_capacity "$HOME/.config/juno-runner/cores" || { echo 'runner: invalid cores config or topology' >&2; exit 70; }
[[ "$reserved" =~ ^[1-9][0-9]*$ ]] || exit 70
(( reserved <= capacity )) || { echo "runner: job needs $reserved cores, host has $capacity" >&2; exit 70; }
container="juno-$run"
lease="$state/jobs/$run"
exec 8<&0
stop_container() {
  docker rm -f "$1" >/dev/null 2>&1 && return 0
  local remaining
  remaining=$(docker ps -a --format '{{.Names}}') || return 1
  ! grep -Fxq "$1" <<< "$remaining"
}
cleanup() {
  if [ -n "${child:-}" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi
  flock -x 9
  # Never advertise free cores while Docker might still be running.
  if ! stop_container "$container"; then flock -u 9; return 70; fi
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
  occupied=''
  legacy=0
  for job in "$state"/jobs/*; do
    [ -f "$job" ] || continue
    read -r pid count name physical supervisor start < "$job"
    if ! kill -0 "$pid" 2>/dev/null; then
      # timeout owns its process group. Stop an orphan before reusing its CPUs.
      if [[ "${supervisor:-}" =~ ^[1-9][0-9]*$ ]] && [ -n "${start:-}" ] &&
        [ "$start" = "$(awk '{print $22}' "/proc/$supervisor/stat" 2>/dev/null)" ]; then
        kill -KILL -- "-$supervisor" 2>/dev/null || true
      fi
      stop_container "$name" || exit 70
      rm -f "$job"
      continue
    fi
    used=$(( used + count ))
    if [ -n "${physical:-}" ] && [ "$physical" != '-' ]; then
      occupied+="${occupied:+,}$physical"
    else
      legacy=1
    fi
  done
  allocated_cores=-
  fits=0
  if (( pinned )); then
    # A quota-only job can run on any CPU. Drain it before lending exact cores.
    if (( !legacy )) && runner_allocate "$occupied" "$reserved"; then fits=1; fi
  elif (( used + reserved <= capacity )); then fits=1
  fi
  if (( fits )); then
    echo "$$ $reserved $container $allocated_cores" > "$lease"
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
if (( pinned )); then
  export JUNO_RUNNER_CPUSET=$allocated_cpus JUNO_RUNNER_THREADS=$allocated_threads
  echo "remote: physical cores $allocated_cores; CPUs $allocated_cpus; threads $allocated_threads" >&2
fi
echo __juno_remote_allocated
# A finite lifetime also bounds an orphan after a client/network failure.
# Keep this shell alive as lease owner until Docker has stopped.
# Publish the supervisor before it may start Docker, so SIGKILL in that window
# cannot leave an unrecorded process that later starts on reassigned CPUs.
timeout --signal=TERM --kill-after=30s 3h bash -c '
  owner=$1 lease=$2 command=$3
  while kill -0 "$owner" 2>/dev/null; do
    read -r pid count name physical supervisor start < "$lease" || exit 70
    if [ "${supervisor:-}" = "$PPID" ]; then exec bash -c "$command"; fi
    sleep 0.05
  done
  exit 130
' _ "$$" "$lease" "$command" <&8 9>&- &
child=$!
flock -x 9
echo "$$ $reserved $container $allocated_cores $child $(awk '{print $22}' "/proc/$child/stat")" > "$state/.$run"
mv "$state/.$run" "$lease"
flock -u 9
wait "$child"
