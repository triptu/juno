#!/usr/bin/env bash
# Runs inside the remote container (scripts/remote/Dockerfile) after the
# worktree has been unpacked over /work: links the workspace from the
# installed store, runs `pnpm <script> [args...]` under a virtual display, and
# packs the reports into /out for scripts/remote.mjs to fetch.
set -uo pipefail
cd /work
source scripts/remote/install.sh
# Electron's first start on the container's layered filesystem copies the
# binary up; parallel test workers starting it then fail with ETXTBSY.
electron=$(node -e "console.log(require('./apps/desktop/node_modules/electron'))" 2>/dev/null) && "$electron" --version >/dev/null 2>&1

source scripts/remote/workers.sh
script_started=$SECONDS
# Samples how busy the machine is every 2 s, to size the workers above.
( prev=($(head -1 /proc/stat)); previous_usage=$(awk '$1 == "usage_usec" { print $2 }' /sys/fs/cgroup/cpu.stat 2>/dev/null)
  while sleep 2; do
    if [ "${JUNO_RUNNER_PINNED:-0}" = 1 ]; then
      df -B1 --output=target,used /tmp /work | tail -n +2 >> /out/tmpfs.txt
    fi
    awk '/^MemTotal:/ { total = $2 } /^MemAvailable:/ { available = $2 } END { print total - available, available }' /proc/meminfo >> /out/memory.txt
    if [ -n "${JUNO_RUNNER_JOB_CORES:-}" ]; then
      usage=$(awk '$1 == "usage_usec" { print $2 }' /sys/fs/cgroup/cpu.stat)
      echo $(( (usage - previous_usage) / (20000 * cores) )) >> /out/cpu.txt
      previous_usage=$usage
      continue
    fi
    now=($(head -1 /proc/stat)); idle=$(( now[4] + now[5] - prev[4] - prev[5] )); total=0
    for i in 1 2 3 4 5 6 7 8; do total=$(( total + now[i] - prev[i] )); done
    [ $total -gt 0 ] && echo $(( 100 * (total - idle) / total )) >> /out/cpu.txt; prev=("${now[@]}")
    # Busy stops at 100%; the tasks waiting for a core and the time they wait show how far past it the machine is.
    running=$(awk '$1 == "procs_running" { print $2 }' /proc/stat)
    pressure=$(awk -F'avg10=' '/^some/ { split($2, a, " "); print a[1] }' /proc/pressure/cpu 2>/dev/null)
    echo "$(( SECONDS - script_started )) ${running:-0} ${pressure:-0}" >> /out/load.txt
  done ) &
sampler=$!
xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' pnpm "$@"
code=$?
echo "remote: script time $(( SECONDS - script_started )) s" >&2
kill $sampler 2>/dev/null
if [ -n "${JUNO_RUNNER_JOB_CORES:-}" ] && [ -r /sys/fs/cgroup/memory.peak ]; then
  awk '{ printf "remote: peak container memory %.2f GB (includes file cache)\n", $1 / 1073741824 }' /sys/fs/cgroup/memory.peak >&2
fi
if [ -s /out/tmpfs.txt ]; then
  awk '{ if ($2 > peak[$1]) peak[$1] = $2 } END { for (path in peak) printf "remote: sampled peak tmpfs %s %.1f MiB\n", path, peak[path] / 1048576 }' /out/tmpfs.txt >&2
fi
if [ -s /out/memory.txt ]; then
  sort -nr -k1,1 /out/memory.txt | head -1 | awk '{ printf "remote: peak memory used %.1f GB, available %.1f GB\n", $1 / 1048576, $2 / 1048576 }' >&2
fi
if [ -s /out/cpu.txt ]; then
  sort -n /out/cpu.txt | awk '{ s += $1; v[NR] = $1 } END { printf "remote: CPU busy %d%% on average, %d%% at the median, over %d s on %d cores\n", s / NR, v[int((NR + 1) / 2)], NR * 2, '"$cores"' }' >&2
fi
if [ -s /out/load.txt ]; then
  # Runnable tasks per core (1 means every core has one, more means tasks queue) and the share of time some task
  # waited for a core (the kernel's CPU pressure, over 10 s), at the median and the 90th percentile, then every 30 s.
  pick() { sort -n | awk '{ v[NR] = $1 } END { m = int((NR + 1) / 2); q = int(NR * 0.9); if (q < 1) q = 1; print v[m], v[q] }'; }
  runnable=$(awk '{ printf "%.1f\n", $2 / '"$cores"' }' /out/load.txt | pick)
  pressure=$(awk '{ print $3 }' /out/load.txt | pick)
  echo "remote: runnable per core ${runnable% *} at the median, ${runnable#* } at p90; CPU pressure ${pressure% *}% at the median, ${pressure#* }% at p90" >&2
  awk '{ b = int($1 / 30); r[b] += $2; p[b] += $3; c[b]++ } END { for (b in c) printf "remote: load +%d s: runnable per core %.1f, CPU pressure %.0f%%\n", b * 30, r[b] / c[b] / '"$cores"', p[b] / c[b] }' /out/load.txt | sort -t+ -k2 -n >&2
fi

reports=()
for path in specs/traces apps/desktop/coverage/map apps/desktop/test-results apps/desktop/playwright-report apps/desktop/blob-report apps/gallery/test-results apps/gallery/playwright-report apps/gallery/shots; do
  [ -e "$path" ] && reports+=("$path")
done
# The spec cache pnpm remote brought along, with what this run added to it.
[ -n "${SPECS_CACHE_DIR:-}" ] && [ -d "$SPECS_CACHE_DIR" ] && reports+=("${SPECS_CACHE_DIR#/work/}")
[ -n "${JUNO_TYPECHECK_CACHE_DIR:-}" ] && [ -d "$JUNO_TYPECHECK_CACHE_DIR" ] && reports+=("${JUNO_TYPECHECK_CACHE_DIR#/work/}")
[ ${#reports[@]} -gt 0 ] && tar -czf /out/reports.tgz "${reports[@]}"
exit $code
