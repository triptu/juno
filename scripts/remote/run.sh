#!/usr/bin/env bash
# Runs inside the remote container (scripts/remote/Dockerfile) after the
# worktree has been unpacked over /work: links the workspace from the
# installed store, runs `pnpm <script> [args...]` under a virtual display, and
# packs the reports into /out for scripts/remote.mjs to fetch.
set -uo pipefail
cd /work
pnpm install --frozen-lockfile --offline --reporter=silent || exit 70

# One job per machine, so it can use all of it.
export GALLERY_BROWSER=chromium JUNO_HEAVY_SLOTS=1 JUNO_TEST_FILE_PARALLEL=1
export JUNO_E2E_WORKERS=${JUNO_E2E_WORKERS:-$(( $(nproc) / 3 ))} GALLERY_WORKERS=${GALLERY_WORKERS:-$(( $(nproc) / 2 ))} SPECS_JOBS=${SPECS_JOBS:-$(( $(nproc) / 2 ))}
xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' pnpm "$@"
code=$?

reports=()
for path in specs/traces apps/desktop/test-results apps/gallery/test-results apps/gallery/playwright-report apps/gallery/shots; do
  [ -e "$path" ] && reports+=("$path")
done
[ ${#reports[@]} -gt 0 ] && tar -czf /out/reports.tgz "${reports[@]}"
exit $code
