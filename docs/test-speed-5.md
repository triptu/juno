# Full-run scheduling and gallery overhead

The candidate splits gallery and desktop into independent allocator jobs and
reduces gallery driver round trips. It keeps the existing state selection,
assertions and two-core browser-job budgets. The measurement compares one
completed run with today's retained successful baseline. It is not a controlled
worker benchmark: main gained huddle work and flaky-test fixes between commits,
and other users shared the allocator.

## Measurement

The baseline is `f5d3854e4`, run `20261020T060638323Z`. The candidate is
`4260ce84e`, run `20261020T105115050Z`, after merging main at `67cffc883`.
Both use the same toolchain image and the runner's configured eight-core pool.
Gallery and desktop each have two physical cores, four hardware threads and a
6 GiB memory cap. Specs has four physical cores and 12 GiB.

| Step | Before, s | After, s |
| --- | ---: | ---: |
| Unit | 192 | 265 |
| Quint checks | 347 | 418 |
| Conformance | 15 | 19 |
| Gallery | 1,139 | 1,055 |
| Desktop | 933 | 1,317 |
| Full run, wall | 2,079.332 | 1,330.647 |

| Candidate job | Script, s | Client wall, s | Allocator wait, s |
| --- | ---: | ---: | ---: |
| Unit | 265 | 272.968 | 0 |
| Specs, both steps | 437 | 1,199.624 | 748 |
| Gallery | 1,055 | 1,064.221 | 0 |
| Desktop | 1,316 | 1,325.021 | 0 |

The desktop step and shell script timers differ by one second because they
round different timing intervals. Baseline job script times were 192 s for
unit, 362 s for specs and 2,072 s for gallery followed by desktop.

Step times include the root command's build and test work. A job's script time
also includes its sequential steps. Client job wall time includes admission,
installation, reports and cleanup. Baseline client job wall times were not
retained; do not mistake its script times for those wall times. No baseline job
reported an allocator wait. The baseline's full wall time is measured from its
run ID to the recorded finish, 2,079.332 s.

The full run finished 748.685 s sooner, a 36.0% reduction in this one observed
pair. Gallery finished 84 s sooner while checking 312 tests instead of 297.
Desktop passed 457 tests instead of 418, with 48 Mac-only skips instead of 45.
Both browser suites reported zero flakes, errors or incomplete tests. Unit,
specs and desktop all took longer, so this pair does not isolate the speedup
from any one code or worker change.

Keep four gallery workers. Its peak cgroup memory was 3.90 GiB, including file
cache, below the 6 GiB cap; sampled memory events showed no limit or OOM hits.
The baseline combined browser job peaked at 3.47 GiB. Candidate peaks were
1.69 GiB for unit, 2.02 GiB for specs and 2.36 GiB for desktop. Gallery used
83% of its allocated threads on average; desktop used 79%. Browser work and
frame waits still dominate. Specs was delayed by other allocator
users even after unit released its cores. The measured final bottleneck was
desktop, not gallery. No extra cores were lent.

## Coverage and failure handling

Gallery keeps every state's cursor check, up to eight controls per state,
screenshot-only DOM equivalence checks, all six native input actions, full
markup-based resets and fresh contexts every 20 states. It still settles for
two frames and layout motion, then checks browser shift entries and every
element's layout box.

Readiness combines font, image, theme and entrance-motion checks into one
browser call. Pending chunks use a bounded mutation observer. Initial markup
is saved with the DOM signature, and selected controls' visibility checks
can overlap. No state-selection or assertion policy changed.

The candidate's broad walk checked 1,662 states, skipped 170 proven
screenshot-only DOM duplicates, touched 6,032 selected elements and performed
458 markup resets. Both injected faults passed their negative controls: the
hover rule and delayed chunk size change each produced a hover layout-box
failure. The nested-offset, recent-input and layout-transition controls passed
as part of the same complete suite.

One returned desktop coverage partial was merged into a map with 121 spec
files and 968 source files, up from the baseline's 115 and 927. The merged
map was compared with the returned partial, not just the summary message.

`pnpm affected` passed the Bun check, all 11 lint checks, eight health checks,
74 repository-tool tests, 23 runner checks, the complete gallery and the four
desktop bridge tests. Its log is
`/Volumes/AgentWork/artifacts/juno-speed-affected-20261020.log`.
The coordinator regression fix was made after the timed full run and checked
by this affected run. Main advanced during validation; the batch checks cover
the final combined tree, while the full-run timing remains tied to `4260ce84e`.

The coordinator checks each result's script and original step index. A missing
result fails. The full-run summary also preserves a coordinator failure after
all steps pass, such as a failed report download. Regression checks cover a
nonzero step, a missing or mismatched result, and a nonzero coordinator after
successful steps. The last case previously allowed a false green summary.

## Evidence

Logs are in the main checkout's `.juno-status/verify-main/` under the run IDs
above. Retained candidate job logs and reports are in
`/Volumes/AgentWork/artifacts/juno-speed-full-20261020-remote/` and
`juno-speed-full-20261020-reports/`. The command log is
`juno-speed-full-20261020.log`; cgroup observations are in
`juno-speed-memory-20261020.txt` in the same artifacts folder.

The earlier run `20261020T092743837Z` ended when SSH reported `Host is down`.
The abandoned local pair ran above the Mac's load ceiling. Neither is a speed
sample. This continuation uses remote measurements; the Mac was above its
load ceiling again and did not run browser suites locally.

## Selective states, not implemented

The research report models retaining 5% of broad-walk work, 10% of focus-ring
work and 40% of other work. Historical timing shares put that at about 9.2% of
gallery work before fixed overhead, targeting 112–114 s against the older
19-minute gallery. This is an estimate, not a measured gate.

Applying the same historical workload shares to this candidate's 1,055 s gives
about 97 s before fixed overhead. That is an estimate using old timing shares,
not a prediction from measured state selection. Even a free gallery would
leave this run's 1,317 s desktop path, about 22 minutes plus setup. A narrower
gallery gate could release cores for specs earlier, but would not shorten the
observed desktop bottleneck.

Such a gate gives up exhaustive state/control coverage on every invocation.
It would retain targeted regressions, affected components and periodic full
walks, and needs an explicit coverage-policy decision. No selective gate was
built.
