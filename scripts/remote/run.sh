#!/usr/bin/env bash
# Runs inside the remote container (scripts/remote/Dockerfile) after the
# worktree has been unpacked over /work: links the workspace from the
# installed store, runs `pnpm <script> [args...]` under a virtual display, and
# packs the reports into /out for scripts/remote.mjs to fetch.
set -uo pipefail
cd /work
pnpm install --frozen-lockfile --offline --reporter=silent || exit 70
echo "remote: workspace linked in ${SECONDS} s" >&2
# Electron's first start on the container's layered filesystem copies the
# binary up; parallel test workers starting it then fail with ETXTBSY.
electron=$(node -e "console.log(require('./apps/desktop/node_modules/electron'))" 2>/dev/null) && "$electron" --version >/dev/null 2>&1

# One job per machine, so it can use all of it. Sizes follow the core count
# (2 to 16, see remoteShapes in scripts/remote.mjs) and never drop below 1.
cores=${JUNO_RUNNER_JOB_CORES:-$(nproc)}
at_least() { echo $(( $1 > $2 ? $1 : $2 )); }
export GALLERY_BROWSER=chromium JUNO_HEAVY_SLOTS=1 JUNO_TEST_FILE_PARALLEL=1
# Lets scripts/build-cached.mjs reuse a build made earlier in this run.
export JUNO_REMOTE_CONTAINER=1
export JUNO_TYPECHECK_JOBS=${JUNO_TYPECHECK_JOBS:-$(at_least $(( cores / 2 )) 1)}
export JUNO_TEST_PACKAGE_JOBS=${JUNO_TEST_PACKAGE_JOBS:-2}
if [ "$cores" -eq 2 ]; then export JUNO_TEST_TIMING_SEPARATE=${JUNO_TEST_TIMING_SEPARATE:-1}; fi
export JUNO_VITEST_WORKERS=${JUNO_VITEST_WORKERS:-$(at_least $cores 4)}
# An Electron test runs the app, its engine and a fake Slack: half a core's worth
# of workers kept tests on time on 4 cores, one per core did not. The gallery
# mostly waits on frames and timers, so it runs more workers than cores.
desktop_workers=$(at_least $(( cores / 2 )) 2)
if [ "$cores" -eq 4 ] && [ "$1" = test:desktop ] && [ -n "${JUNO_SHARD:-}" ]; then desktop_workers=3; fi
export JUNO_E2E_WORKERS=${JUNO_E2E_WORKERS:-$desktop_workers}
export GALLERY_WORKERS=${GALLERY_WORKERS:-$(( cores * 3 ))} GALLERY_SHIFT_PARTS=${GALLERY_SHIFT_PARTS:-$(( cores * 3 ))}
# Spec simulations run beside the Apalache checks here (on the Mac they run first).
spec_jobs=$(at_least $(( cores / 2 )) 1)
if [ "$1" = specs:traces ]; then spec_jobs=$cores; fi
export SPECS_JOBS=${SPECS_JOBS:-$spec_jobs} SPECS_APALACHE=${SPECS_APALACHE:-$(at_least $(( cores / 4 )) 1)} SPECS_OVERLAP=1
# Samples how busy the machine is every 2 s, to size the workers above.
( prev=($(head -1 /proc/stat)); previous_usage=$(awk '$1 == "usage_usec" { print $2 }' /sys/fs/cgroup/cpu.stat 2>/dev/null)
  while sleep 2; do
    if [ -n "${JUNO_RUNNER_JOB_CORES:-}" ]; then
      usage=$(awk '$1 == "usage_usec" { print $2 }' /sys/fs/cgroup/cpu.stat)
      echo $(( (usage - previous_usage) / (20000 * cores) )) >> /out/cpu.txt
      previous_usage=$usage
      continue
    fi
    now=($(head -1 /proc/stat)); idle=$(( now[4] + now[5] - prev[4] - prev[5] )); total=0
    for i in 1 2 3 4 5 6 7 8; do total=$(( total + now[i] - prev[i] )); done
    [ $total -gt 0 ] && echo $(( 100 * (total - idle) / total )) >> /out/cpu.txt; prev=("${now[@]}")
  done ) &
sampler=$!
script_started=$SECONDS
xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' pnpm "$@"
code=$?
echo "remote: script time $(( SECONDS - script_started )) s" >&2
kill $sampler 2>/dev/null
if [ -s /out/cpu.txt ]; then
  sort -n /out/cpu.txt | awk '{ s += $1; v[NR] = $1 } END { printf "remote: CPU busy %d%% on average, %d%% at the median, over %d s on %d cores\n", s / NR, v[int((NR + 1) / 2)], NR * 2, '"$cores"' }' >&2
fi

reports=()
for path in specs/traces apps/desktop/test-results apps/desktop/playwright-report apps/desktop/blob-report apps/gallery/test-results apps/gallery/playwright-report apps/gallery/shots; do
  [ -e "$path" ] && reports+=("$path")
done
# The spec cache pnpm remote brought along, with what this run added to it.
[ -n "${SPECS_CACHE_DIR:-}" ] && [ -d "$SPECS_CACHE_DIR" ] && reports+=("${SPECS_CACHE_DIR#/work/}")
[ -n "${JUNO_TYPECHECK_CACHE_DIR:-}" ] && [ -d "$JUNO_TYPECHECK_CACHE_DIR" ] && reports+=("${JUNO_TYPECHECK_CACHE_DIR#/work/}")
[ ${#reports[@]} -gt 0 ] && tar -czf /out/reports.tgz "${reports[@]}"
exit $code
