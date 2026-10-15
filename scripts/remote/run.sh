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
cores=$(nproc)
at_least() { echo $(( $1 > $2 ? $1 : $2 )); }
export GALLERY_BROWSER=chromium JUNO_HEAVY_SLOTS=1 JUNO_TEST_FILE_PARALLEL=1
export JUNO_TYPECHECK_JOBS=${JUNO_TYPECHECK_JOBS:-$(at_least $(( cores / 2 )) 1)}
export JUNO_VITEST_WORKERS=${JUNO_VITEST_WORKERS:-$(at_least $cores 2)}
# An Electron test runs the app, its engine and a fake Slack: half a core's worth
# of workers kept tests on time on 4 cores, one per core did not. The gallery
# mostly waits on frames and timers, so it runs more workers than cores.
export JUNO_E2E_WORKERS=${JUNO_E2E_WORKERS:-$(at_least $(( cores / 2 )) 2)}
export GALLERY_WORKERS=${GALLERY_WORKERS:-$(( cores * 3 ))} GALLERY_SHIFT_PARTS=${GALLERY_SHIFT_PARTS:-$(( cores * 3 ))}
# Spec simulations run beside the Apalache checks here (on the Mac they run first).
export SPECS_JOBS=${SPECS_JOBS:-$(at_least $(( cores / 2 )) 1)} SPECS_APALACHE=${SPECS_APALACHE:-$(at_least $(( cores / 4 )) 1)} SPECS_OVERLAP=1
# Samples how busy the machine is every 2 s, to size the workers above.
( prev=($(head -1 /proc/stat)); while sleep 2; do
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
  sort -n /out/cpu.txt | awk '{ s += $1; v[NR] = $1 } END { printf "remote: CPU busy %d%% on average, %d%% at the median, over %d s on %d cores\n", s / NR, v[int((NR + 1) / 2)], NR * 2, '"$(nproc)"' }' >&2
fi

reports=()
for path in specs/traces apps/desktop/test-results apps/desktop/playwright-report apps/gallery/test-results apps/gallery/playwright-report apps/gallery/shots; do
  [ -e "$path" ] && reports+=("$path")
done
# The spec cache pnpm remote brought along, with what this run added to it.
[ -n "${SPECS_CACHE_DIR:-}" ] && [ -d "$SPECS_CACHE_DIR" ] && reports+=("${SPECS_CACHE_DIR#/work/}")
[ -n "${JUNO_TYPECHECK_CACHE_DIR:-}" ] && [ -d "$JUNO_TYPECHECK_CACHE_DIR" ] && reports+=("${JUNO_TYPECHECK_CACHE_DIR#/work/}")
[ ${#reports[@]} -gt 0 ] && tar -czf /out/reports.tgz "${reports[@]}"
exit $code
