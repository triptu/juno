#!/usr/bin/env bash
# Runs inside the remote container (scripts/remote/Dockerfile) after the
# worktree has been unpacked over /work: links the workspace from the
# installed store, runs `bun run <script> [args...]` under a virtual display, and
# packs the reports into .remote for scripts/remote.mjs to fetch.
set -uo pipefail
cd /work
export JUNO_RUNNER_JOB_CORES=${RUNNER_THREADS:?tstack did not provide allocated threads}
echo "remote: allocated threads=$JUNO_RUNNER_JOB_CORES"
export JUNO_REMOTE_INSTALL=1 JUNO_BUILD_CACHE_DIR=/cache/builds
# Spec check and conformance results stay on the runner, shared by every job. An entry is
# touched when it is read; one unused for 14 days is removed (compiled/ is small and stays).
export SPECS_CACHE_DIR=${SPECS_CACHE_DIR:-/cache/specs}
mkdir -p "$SPECS_CACHE_DIR" && find "$SPECS_CACHE_DIR" -maxdepth 1 -type f -mtime +14 -delete 2>/dev/null
export electron_config_cache=/cache/electron
export TMP=/tmp TEMP=/tmp XDG_RUNTIME_DIR=/tmp/juno-runtime
mkdir -p "$XDG_RUNTIME_DIR" /cache/builds /cache/electron .remote
chmod 700 "$XDG_RUNTIME_DIR"
source scripts/remote/install.sh
# Electron's first start on the container's layered filesystem copies the
# binary up; parallel test workers starting it then fail with ETXTBSY. Only suites that start it pay for this.
case " $* " in *" test:desktop "*|*" test:electron "*|*" test:e2e "*|*" test:gallery "*)
  electron=$(node -e "console.log(require('./apps/desktop/node_modules/electron'))" 2>/dev/null) && "$electron" --version >/dev/null 2>&1 ;;
esac

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
# JUNO_MEMORY_PROFILE=1 records each process's memory (scripts/memory-profile.mjs).
if [ "${JUNO_MEMORY_PROFILE:-}" = 1 ]; then
  bun scripts/memory-profile.mjs "memory-profile/${1//[^a-z0-9]/-}-$$.json" & profiler=$!
fi
# Under JUNO_STRESS (workers.sh), one busy loop per allocated thread takes its share of the CPU for the whole script.
burners=()
if [ "${JUNO_STRESS:-}" = 1 ]; then
  for _ in $(seq "$cores"); do bun -e 'for (;;) Math.sqrt(Math.random())' & burners+=($!); done
  echo "remote: stress: ${#burners[@]} CPU burners, test workers $JUNO_TEST_WORKERS, browser workers $JUNO_BROWSER_WORKERS, Electron workers $JUNO_E2E_WORKERS, timeouts x$JUNO_STRESS_SCALE, renderer CPU /$JUNO_STRESS_CPU_RATE" >&2
fi
xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' bun run "$@"
code=$?
[ ${#burners[@]} -gt 0 ] && kill "${burners[@]}" 2>/dev/null
echo "remote: script time $(( SECONDS - script_started )) s" >&2
kill $sampler 2>/dev/null
[ -n "${profiler:-}" ] && kill $profiler 2>/dev/null && wait $profiler 2>/dev/null
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
for path in specs/traces apps/desktop/test-results apps/desktop/playwright-report apps/desktop/blob-report apps/gallery/test-results apps/gallery/playwright-report apps/gallery/shots memory-profile; do
  [ -e "$path" ] && reports+=("$path")
done
[ -n "${JUNO_TYPECHECK_CACHE_DIR:-}" ] && [ -d "$JUNO_TYPECHECK_CACHE_DIR" ] && reports+=("${JUNO_TYPECHECK_CACHE_DIR#/work/}")
[ ${#reports[@]} -gt 0 ] && tar -czf .remote/reports.tgz "${reports[@]}"
exit $code
