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

# One job per machine, so it can use all of it.
export GALLERY_BROWSER=chromium JUNO_HEAVY_SLOTS=1 JUNO_TEST_FILE_PARALLEL=1
export JUNO_E2E_WORKERS=${JUNO_E2E_WORKERS:-$(( $(nproc) / 3 ))} GALLERY_WORKERS=${GALLERY_WORKERS:-$(( $(nproc) * 2 ))} GALLERY_SHIFT_PARTS=${GALLERY_SHIFT_PARTS:-$(( $(nproc) * 2 ))} SPECS_JOBS=${SPECS_JOBS:-$(( $(nproc) / 2 ))} SPECS_APALACHE=${SPECS_APALACHE:-$(( $(nproc) / 4 ))}
# Samples how busy the machine is every 2 s, to size the workers above.
( prev=($(head -1 /proc/stat)); while sleep 2; do
    now=($(head -1 /proc/stat)); idle=$(( now[4] + now[5] - prev[4] - prev[5] )); total=0
    for i in 1 2 3 4 5 6 7 8; do total=$(( total + now[i] - prev[i] )); done
    [ $total -gt 0 ] && echo $(( 100 * (total - idle) / total )) >> /out/cpu.txt; prev=("${now[@]}")
  done ) &
sampler=$!
xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' pnpm "$@"
code=$?
kill $sampler 2>/dev/null
if [ -s /out/cpu.txt ]; then
  sort -n /out/cpu.txt | awk '{ s += $1; v[NR] = $1 } END { printf "remote: CPU busy %d%% on average, %d%% at the median, over %d s on %d cores\n", s / NR, v[int((NR + 1) / 2)], NR * 2, '"$(nproc)"' }' >&2
fi

reports=()
for path in specs/traces apps/desktop/test-results apps/gallery/test-results apps/gallery/playwright-report apps/gallery/shots; do
  [ -e "$path" ] && reports+=("$path")
done
[ ${#reports[@]} -gt 0 ] && tar -czf /out/reports.tgz "${reports[@]}"
exit $code
