# Sourced by run.sh. Explicit worker settings take precedence.
# SSH workers scale with the CPU limit, since nproc can see the whole host.
cores=${JUNO_RUNNER_JOB_CORES:-$(nproc)}
at_least() { echo $(( $1 > $2 ? $1 : $2 )); }
export GALLERY_BROWSER=chromium JUNO_HEAVY_SLOTS=1
# Marks the isolated test workspace; build-cached.mjs uses the mounted build cache.
export JUNO_REMOTE_CONTAINER=1
export JUNO_TYPECHECK_JOBS=${JUNO_TYPECHECK_JOBS:-$(at_least $(( cores / 2 )) 1)}
# Unit tests run in one bun test, a process per file.
test_workers=$(at_least $cores 4)
gallery_workers=$(( cores * 3 ))
if [ -n "${JUNO_RUNNER_JOB_CORES:-}" ]; then
  test_workers=$cores
  gallery_workers=$(at_least $(( cores * 3 / 4 )) 1)
  if [ "$cores" -eq 3 ]; then gallery_workers=3; fi
  # Four threads on the usual two physical cores overlap the frame waits.
  if [ "$cores" -eq 4 ]; then gallery_workers=4; fi
fi
# A job that runs only the gallery mostly waits for frames and motion to settle:
# four walkers per three threads kept 6 threads 94% busy and cut a full walk by 36%.
case " $* " in *" + "*) ;; *" test:gallery "*) gallery_workers=$(at_least $(( cores * 4 / 3 )) 1) ;; esac
export JUNO_TEST_WORKERS=${JUNO_TEST_WORKERS:-$test_workers}
# An Electron test runs the app, its engine and a fake Slack: half a core's worth
# of workers kept tests on time on 4 cores, one per core did not (8 cores take
# one per core, below).
desktop_workers=$(at_least $(( cores / 2 )) 2)
if [ -n "${JUNO_RUNNER_JOB_CORES:-}" ]; then desktop_workers=$(at_least $(( cores / 2 )) 1); fi
# Larger allocations can run one desktop worker per thread.
if [ "$cores" -ge 8 ]; then desktop_workers=$cores; fi
# Standalone desktop runs can overlap one more app while another waits for I/O.
# Plans retain their own lane budgets.
if [ "$cores" -eq 4 ] && [ "$1" = test:desktop ]; then desktop_workers=3; fi
export JUNO_E2E_WORKERS=${JUNO_E2E_WORKERS:-$desktop_workers}
export GALLERY_WORKERS=${GALLERY_WORKERS:-$gallery_workers}
export GALLERY_SHIFT_PARTS=${GALLERY_SHIFT_PARTS:-$GALLERY_WORKERS}
# Spec simulations run beside the Apalache checks here (on the Mac they run first).
spec_jobs=$(at_least $(( cores / 2 )) 1)
if [ "$1" = specs:traces ]; then spec_jobs=$cores; fi
# check.mjs sizes Apalache lanes from allocated threads and cgroup memory.
export SPECS_JOBS=${SPECS_JOBS:-$spec_jobs} SPECS_OVERLAP=1
