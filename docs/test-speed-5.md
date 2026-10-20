# Full-run scheduling and gallery overhead

Work started from `origin/main` at `ceed49255` on 2026-10-20. The scheduler split is
`aa8c9b808`; the gallery candidate is `c35f75b13`. Production code and the
Notifications and People specs were not changed.

## Split the browser jobs

The SSH coordinator now groups unit, specs, gallery and desktop steps separately.
Gallery and desktop each request the existing two-core, 6 GiB budget. The shared
allocator still caps Juno at its configured eight physical cores. A queued job
can use capacity released by another job. Split plans default to a one-hour
admission wait, with explicit CLI and environment settings taking precedence;
standalone jobs and unsplit plans retain the 60-second default.

Original step indices, per-job reports and exit aggregation remain. A result
must name the expected script as well as its index. Each job uses the existing
verified persistent build cache. Coverage collection and partial-map merging
are unchanged.

The audit's retained observations put the original full run at about 33 minutes:
gallery 1,121–1,144 seconds followed by desktop 856–921 seconds in the app job.
Unit released two cores after 184–192 seconds. With those suite times, separate
jobs put the critical path near 19–20 minutes. That is an estimate, conditional
on allocator capacity and comparable test performance.

The first split full run, against `aa8c9b808`, was interrupted after 637 seconds.
All five suite results are infrastructure failures, and no coverage partials
returned. Other owners occupied four of the eight lent cores during part of the
attempt. Gallery and desktop obtained separate two-core jobs; unit queued and
then started, while specs remained queued. Gallery had state-deadline failures
before the disconnect. The SSH connection then reported `Host is down`; later
health checks failed by hostname and direct IP. This attempt is excluded from
speed comparisons and does not establish complete test coverage.

Its retained log is
`.juno-status/verify-main/20261020T092743837Z/plan.log` in the main checkout.

## Gallery changes

The usual four allocated threads now run four gallery workers rather than three.
Explicit overrides still win. State selection, the existing screenshot-only
DOM equivalence check, at most eight selected controls, all six native input
actions, full markup-based resets and 20-state context rollovers remain.

State readiness combines its font, image, theme and entrance-motion checks into
one browser call. Per-action chunk readiness returns directly when nothing is
pending, or uses a bounded mutation observer when a chunk is pending. The guard
still waits two frames and layout motion, and checks both browser shift entries
and every element's geometry. The initial markup is saved while computing the
DOM signature, rather than serialized again. Target visibility checks overlap
without changing their selection or order.

Two added controls inject size changes into the real primary Button fixture:
a hover rule and a delayed chunk triggered by the pointer. The broad walk must
report a hover layout-box failure in both cases. Existing negative controls for
recent input, nested offset parents and layout transitions remain. All eight
controls passed locally. A focused walk through the states that timed out on
the remote run passed 27 states and 183 selected elements locally.

The gallery saves Playwright JSON and prints state, duplicate, element and reset
counts per part. These make incomplete walks and timing changes inspectable.

## Validation and blocked measurements

There is no valid after-time for either step. The remote outage prevented a
completed split-plan measurement. A local baseline/candidate pair was prepared
under the Mac's exclusive heavy lock, with matching JSON reporters and three
then four workers. The baseline started at 15:22 IST with load already 15.6;
load rose above 28 and swap use reached 6.6 GiB on this 8 GiB Apple M2. The
measurement process tree was stopped by PID at about 15:25, before the candidate
started. This incomplete local attempt is also excluded. The exclusive lock
alone does not establish the required load ceiling of 8. No process belonging
to another owner was stopped.

`pnpm affected` passed the local Bun check, all 11 lint checks, eight health
checks, 74 repository-tool tests and 20 runner tests. Its complete gallery and
changed desktop-spec steps failed with connection errors before execution.
The full run's stale bridge expectation was corrected separately in
`5e871448b`: the exact API list now includes the existing `contentShown` method.
That corrected desktop check still needs to run.

Retained local artifacts are under `/Volumes/AgentWork/artifacts/`:
`juno-full-run-step1.log`, `juno-speed-affected.log`,
`juno-speed-guard-controls.log`, `juno-speed-injected-chunk.log`,
`juno-speed-gallery-diagnosis.log` and `juno-gallery-local-pair.log`.
`juno-gallery-measure.mjs` records the intended local comparison. Its baseline
changed only the reporter, not the harness or fixtures. Local measurements would
not establish Linux throughput or memory use under the allocator's 6 GiB cap.

Remaining work is a completed split-plan full run, a complete before/after
gallery comparison under the allocated two cores with valid memory and failure
counts, a passing affected browser plan, then the batch merge with push. Keep
the reported before/after comparison open until those run successfully. No
coverage map was refreshed from the interrupted full run.

## Selective states, not implemented

The audit models a gallery gate retaining 5% of broad-walk work, 10% of focus-ring
work and 40% of other work. Its historical timing shares give about 9.2% of the
current gallery workload before fixed overhead, targeting roughly 112–114 seconds
against the old 19-minute gallery run. This is an estimate, not a measured gate.
It would stop checking every state and selected control on each gate, while
keeping targeted regressions, affected components and periodic exhaustive runs.
That changes the coverage policy and needs Tushar's decision.

A two-minute gallery gate does not imply a two-minute full run: desktop plus its
allocator wait would still dominate, historically about 14–18 minutes. No state
selection or cadence change was built.
