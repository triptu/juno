# Sourced by run.sh. Explicit worker settings take precedence.
# SSH containers use their CPU limit, since nproc can see the whole host.
# Namespace containers have a machine to themselves.
cores=${JUNO_RUNNER_JOB_CORES:-$(nproc)}
at_least() { echo $(( $1 > $2 ? $1 : $2 )); }
export GALLERY_BROWSER=chromium JUNO_HEAVY_SLOTS=1 JUNO_TEST_FILE_PARALLEL=1
# Lets scripts/build-cached.mjs reuse a build made earlier in this run.
export JUNO_REMOTE_CONTAINER=1
export JUNO_TYPECHECK_JOBS=${JUNO_TYPECHECK_JOBS:-$(at_least $(( cores / 2 )) 1)}
package_jobs=2
vitest_workers=$(at_least $cores 4)
gallery_workers=$(( cores * 3 ))
if [ -n "${JUNO_RUNNER_JOB_CORES:-}" ]; then
  package_jobs=1
  vitest_workers=$cores
  # Two packages share wide jobs; their Vitest workers fit the CPU limit.
  if [ "$cores" -ge 4 ]; then
    package_jobs=2
    vitest_workers=$(( cores / package_jobs ))
  fi
  gallery_workers=$(at_least $(( cores * 3 / 4 )) 1)
  if [ "$cores" -eq 3 ]; then gallery_workers=3; fi
fi
export JUNO_TEST_PACKAGE_JOBS=${JUNO_TEST_PACKAGE_JOBS:-$package_jobs}
if [ "$cores" -eq 2 ]; then export JUNO_TEST_TIMING_SEPARATE=${JUNO_TEST_TIMING_SEPARATE:-1}; fi
export JUNO_VITEST_WORKERS=${JUNO_VITEST_WORKERS:-$vitest_workers}
# An Electron test runs the app, its engine and a fake Slack: half a core's worth
# of workers kept tests on time on 4 cores, one per core did not (8 cores take
# one per core, below).
desktop_workers=$(at_least $(( cores / 2 )) 2)
if [ -n "${JUNO_RUNNER_JOB_CORES:-}" ]; then desktop_workers=$(at_least $(( cores / 2 )) 1); fi
# On the standard 8x16 shape, eight workers ran all 380 tests in 266 s without a failure (10-17).
if [ "$cores" -ge 8 ]; then desktop_workers=$cores; fi
if [ "$cores" -eq 4 ] && [ "$1" = test:desktop ] && [ -n "${JUNO_SHARD:-}" ]; then desktop_workers=3; fi
export JUNO_E2E_WORKERS=${JUNO_E2E_WORKERS:-$desktop_workers}
export GALLERY_WORKERS=${GALLERY_WORKERS:-$gallery_workers}
export GALLERY_SHIFT_PARTS=${GALLERY_SHIFT_PARTS:-$GALLERY_WORKERS}
# Spec simulations run beside the Apalache checks here (on the Mac they run first).
spec_jobs=$(at_least $(( cores / 2 )) 1)
if [ "$1" = specs:traces ]; then spec_jobs=$cores; fi
export SPECS_JOBS=${SPECS_JOBS:-$spec_jobs} SPECS_APALACHE=${SPECS_APALACHE:-$(at_least $(( cores / 4 )) 1)} SPECS_OVERLAP=1
