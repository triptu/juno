#!/usr/bin/env bash
# Runs `pnpm <script> [args...]` on the remote machine as the `juno` user,
# under a virtual display for the Electron and browser suites.
set -euo pipefail
cd /work
env=(PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright GALLERY_BROWSER=chromium CI=1)
# One job per machine, so it can use all of it.
env+=(JUNO_HEAVY_SLOTS=1 JUNO_E2E_WORKERS=3 JUNO_TEST_FILE_PARALLEL=1)
exec sudo -u juno -H env "${env[@]}" xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' pnpm "$@"
