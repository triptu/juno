# Sourced by run.sh. Explicit worker settings take precedence.
# SSH workers scale with the CPU limit, since nproc can see the whole host.
cores=${JUNO_RUNNER_JOB_CORES:-$(nproc)}
# JUNO_MEMORY_BUDGET=4g sets each lane's workers to fit that memory (scripts/memory-budget.mjs).
if [ -n "${JUNO_MEMORY_BUDGET:-}" ]; then eval "$(bun scripts/memory-budget.mjs "$JUNO_MEMORY_BUDGET" "$cores")"; fi
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
# A serial plan (a full run) runs each step alone too.
case " $* " in *" + "*) [ "${JUNO_PLAN_SERIAL:-}" = 1 ] && gallery_workers=$(at_least $(( cores * 4 / 3 )) 1) ;; *" test:gallery "*) gallery_workers=$(at_least $(( cores * 4 / 3 )) 1) ;; esac
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
# A run that walks only changed states (no GALLERY_SHIFT_ALL) uses GALLERY_CACHED_WORKERS: on one
# loaded page per worker, half a worker per thread ran it in the least CPU at the same wall (10-26).
# An explicit GALLERY_WORKERS sets both.
export GALLERY_CACHED_WORKERS=${GALLERY_CACHED_WORKERS:-${GALLERY_WORKERS:-$(at_least $(( cores / 2 )) 1)}}
# Fast-only full runs are CPU-heavy: one worker per allocated thread beat
# four per three threads (89 s versus 99 s on six threads, 10-26).
export GALLERY_FAST_WORKERS=${GALLERY_FAST_WORKERS:-${GALLERY_WORKERS:-$cores}}
export GALLERY_WORKERS=${GALLERY_WORKERS:-$gallery_workers}
# Spec simulations run beside the Apalache checks here (on the Mac they run first).
spec_jobs=$(at_least $(( cores / 2 )) 1)
if [ "$1" = specs:traces ]; then spec_jobs=$cores; fi
# check.mjs sizes Apalache lanes from allocated threads and cgroup memory.
export SPECS_JOBS=${SPECS_JOBS:-$spec_jobs} SPECS_OVERLAP=1
# JUNO_STRESS=1 (`bun run flake --stress`, `bun run remote --env JUNO_STRESS=1 <script>`) runs a suite the way a loaded
# machine would: twice the workers, a CPU burner per allocated thread beside them (run.sh), the browser lane's
# renderers throttled JUNO_STRESS_CPU_RATE times through CDP, and the default test and expect timeouts
# JUNO_STRESS_SCALE times longer, so a failure is a test that depends on timing, not one that ran out of time
# (docs/development.md, "Stress runs").
if [ "${JUNO_STRESS:-}" = 1 ]; then
  export JUNO_STRESS_SCALE=${JUNO_STRESS_SCALE:-3} JUNO_STRESS_CPU_RATE=${JUNO_STRESS_CPU_RATE:-3}
  export JUNO_TEST_WORKERS=$(( JUNO_TEST_WORKERS * 2 )) JUNO_E2E_WORKERS=$(( JUNO_E2E_WORKERS * 2 ))
  export JUNO_BROWSER_WORKERS=$(( ${JUNO_BROWSER_WORKERS:-$(( (cores * 5 + 4) / 8 ))} * 2 ))
  [ -n "${JUNO_DOM_WORKERS:-}" ] && export JUNO_DOM_WORKERS=$(( JUNO_DOM_WORKERS * 2 ))
  export GALLERY_WORKERS=$(( GALLERY_WORKERS * 2 )) GALLERY_CACHED_WORKERS=$(( GALLERY_CACHED_WORKERS * 2 )) GALLERY_FAST_WORKERS=$(( GALLERY_FAST_WORKERS * 2 ))
fi
