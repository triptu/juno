# Remote compute audit, 15 October 2026

The roughly $200 day is mostly Littlebird GitHub CI, including macOS, rather
than Juno. Joining Namespace's instance reports to history by instance ID gives
this estimate for machines created on 15 October in Asia/Kolkata, through the
initial audit export at about 23:35 local time. It is a rate-based estimate,
not an invoice export. Included balances, taxes and storage can change the bill.

## Recorded machine lifetimes

| Category | Machines | Machine minutes | Prepaid equivalent | Overage equivalent |
| --- | ---: | ---: | ---: | ---: |
| Littlebird macOS GitHub CI, 6 cores / 14 GB | 164 | 2,175 | $130.52 | $195.78 |
| Littlebird Linux GitHub CI, 4 cores / 16 GB | 173 | 2,436 | $19.49 | $29.23 |
| Other Juno test/startup/idle machines | 733 | 6,980 | $54.77 | $82.16 |
| Twelve-machine cleanup cohort | 12 | 1,091 | $4.17 | $6.26 |
| Total above | 1,082 | | $208.96 | $313.43 |

The account also used ten 16-core builder machines for about 307 machine-minutes,
and seven small unclassified instances. Namespace
[prices Docker builds separately](https://namespace.so/pricing.md), with 1,000
builds included on Team and $10 per additional 1,000 builds. A builder can serve
more than one build. Do not price its lifetime as ordinary Linux compute without
invoice evidence. The installed CLI, v0.0.587, exposes no builder-size flag.

macOS costs $0.06 per minute prepaid or $0.09 overage for 6 cores / 14 GB.
The Linux CI machines have 16 GB on 4 cores, so they cost $0.008 per minute
prepaid or $0.012 overage. CPU counts alone understate both categories.
Juno's usual 2 GB per core shapes cost $0.001 per vCPU-minute prepaid or
$0.0015 overage. The earlier UTC-only export contained 726 Juno machines totaling
58,142 vCPU-minutes. Extending the window back to local midnight adds the prior
UTC evening and produces the table above.

The CI records identify repository `littlebirdai/littlebird`. Within the macOS
subtotal, 138 `[MB] iOS Build and test` jobs account for about $94.50 prepaid,
five `[MB] Native performance on phones` jobs for $25.55, eighteen
`[MB] Native Maestro flows` jobs for $9.52, and three TestFlight release jobs
for $0.95. These sum to the macOS subtotal; they are not additional charges.
The largest Linux CI workflow is Android native tests: 118 jobs, about $14.65.

Juno builds its test image only when the Dockerfile, lockfile or workspace-file
hash changes, then shares that tag across worktrees. It does not build once per
test run. The Juno pool cap does not control Littlebird's GitHub CI profiles.

## Active tests, idle machines and leaks

The retained logs at the audit point covered 213 runs, with CPU samples totaling
about 1,890 vCPU-minutes. They are only a subset of the machine history. The largest
sampled category was desktop e2e, about 1,329 vCPU-minutes. The logs do not support
calling the rest of the machine time idle: most historical run logs are absent,
and old logs omit the full script and machine-held times.

The twelve-machine cleanup batch at 13:08 UTC appears to match the reported leak
incident. It held 44 cores and totaled 4,174 vCPU-minutes over the machines' whole
lifetimes, or $4.17 prepaid and $6.26 overage. Actual idle cost was below that,
because startup and tests are included. Lifetimes ranged from 38 to 172 minutes;
the data does not support treating every machine as idle for two full hours.
This cohort is separated in the table above, not added to Juno's total again.

The cohort IDs are `d3lpptl84v76a`, `lmqquojdsk65i`, `0niprotqlirr0`,
`hjotcakl229nk`, `089646hpecchu`, `ed2u3ksh6dkqs`, `2nvugeg6vgeiq`,
`5a39l5gj28fra`, `7rdo6fg46q4v0`, `mv3g3sovh136k`, `npj6cecjnr9s4`
and `3krvv48h351v8`.

Nineteen Juno machines lived more than 90 minutes, totaling about 19,076
vCPU-minutes. Some reached the three-hour expiry. These overlap the cleanup
cohort and are candidates for further leak investigation, not nineteen additional
proven leaks. The remaining Juno total still mixes active runs, image loading and
warm idle time; the retained logs cannot split those completely.

An unused 8-core machine retained for five minutes costs 40 vCPU-minutes.
The one-minute default reduces that to 8, plus the reaper's 30-second poll delay.
`JUNO_REMOTE_IDLE_MINUTES=0` destroys a released machine immediately. Keep the
one-minute default until fresh-start measurements justify removing reuse entirely.
Live owners and pending creates remain protected at every idle setting.

At one point this run saw 36 tracked cores despite its 24-core cap: other
worktrees were still running the old 64-core policy. All callers need the lower
limits for a machine-wide spend limit. A cap cannot evict live work.
At continuous use, 24 cores at Juno's usual 2 GB per core are $34.56 per day
prepaid or $51.84 overage, before cache charges. This is a theoretical ceiling
for callers honoring the cap, not a workspace-wide invoice budget: Littlebird
CI has its own controls.

## Reproduce the inventory

```sh
nsc instance history --all --since 36h --max_entries 10000 -o json > history.json
nsc instance report --start 2026-10-14T18:30:00Z --end 2026-10-15T00:00:00Z --out evening.csv
nsc instance report --start 2026-10-15T00:00:00Z --end 2026-10-15T12:00:00Z --out am.csv
nsc instance report --start 2026-10-15T12:00:00Z --out pm.csv
pnpm remote:usage --days 1
```

Join CSV `instance_id` to history `cluster_id`, and classify by `nsc.purpose` in
history labels. Calculate each machine's lifetime and apply its platform and memory tier from
the pricing table. Use `shape.os` and `shape.machine_arch` from history.
Use separate report windows and deduplicate IDs, since a single report can stop
at 1,000 rows. Pool state is in the Mac system temp directory under
`juno-remote-pool`; it describes current ownership, not historical utilization.

## Cold-start options

Namespace's [Docker image cache](https://namespace.so/docs/integrations/docker-images)
keeps unpacked layers on cache volumes. Cache volumes provide separate writable
copies to concurrent machines, so a shared tag does not share live Docker state.
A cache miss still pulls the image. Storage is billed separately.

Namespace's [lazy base-image loading](https://namespace.so/blog/container-image-loading)
can avoid full pulls, but the current image is a non-root Docker workload, not a
machine base image. The documented `nsc create --experimental disks` path supports
public images only. Publishing the private workspace image would be inappropriate.
A base-image conversion and a different launch path need separate validation.

A smaller Docker image would help misses, but removing the offline pnpm store,
Electron, browsers, Java or Quint would break current suites. The pnpm store is a
runtime input to offline workspace linking. The change therefore keeps the
existing image and exposes Namespace's native container-cache feature as an
opt-in experiment (`JUNO_REMOTE_IMAGE_CACHE=on`). The installed
CLI accepts it through `--experimental` with `container_cache.tag` and `size_mb`.
A volume mounted only at `/var/lib/docker` was rejected after inspection showed
that Namespace shares a separate containerd store. A private overlay2 daemon
worked, but its first pull took 84 seconds and it adds unnecessary maintenance. No new image build is
needed for script-only changes.

## Cache charges

The image-cache working set measured about 6 GB. The initial experiments requested
16 GB; the opt-in setting is 8 GB to leave headroom without retaining twice the needed
cache capacity. Namespace adds free working space when cloning a populated cache,
so snapshot billing can exceed the requested size.

The published platform rate is $0.002 per GB-hour for snapshots and $0.0048 per
GB-day for storage, after included allowances. Team includes 5,000 GB-hours and
3,000 GB-days. These are separate from the compute estimates above. An 8 GB tag
costs about $0.038 per day at rest beyond the allowance. A roughly 14 GB attached
snapshot costs about $0.00047 per minute. Cache cost matters most for long,
2-core runs; the idle-window and core cap remain the main spend controls.


## Runtime pilots

These are full-suite pilots on the same prebuilt image. Script time excludes
local capacity waits, provisioning and report download. Core-minutes are allocated
cores multiplied by script time, rather than CPU-busy time. The desktop baseline
preceded the main merge, which added tests; this is not a repeated, matched-source
benchmark. CPU busy is the existing two-second Linux sampler.

| Work | Shape | Script time | CPU busy | Script core-minutes |
| --- | --- | ---: | ---: | ---: |
| Unit baseline | 4x8 | 156 s | 43% | 10.4 |
| Unit final | 2x4 | 262 s | 67% | 8.7 |
| Desktop baseline | 8x16, four workers | 277 s | 56% | 36.9 |
| Desktop final | two 4x8, three workers each | 272 / 210 s | 42% / 72% | 32.1 combined |

The two-core unit run passed the full suite, including the unchanged agent timing
checks in a separate final phase. It saves about 16% of script compute but misses
the requested two-minute ceiling. A serial-package experiment took 309 seconds
and was rejected. Four Vitest workers with two packages at a time took 262 seconds.
The baseline was 246 seconds end to end; the final unit run was 303 seconds,
including a fresh cached machine with an 18.4-second startup.

The final desktop shards passed 238 tests with 32 skipped and merged both blob
reports into one HTML report. The baseline passed 233 with 32 skipped before
five tests arrived on main. Final script compute was about 13% lower. The longest
shard took 272 seconds versus the baseline's 277; these pilots do not establish
a repeatable speedup. The baseline total wall time was 738 seconds; the final
pair took about 2,734 seconds including merge, because admission waits staggered
the shards. Parallel end-to-end wall time was not established under this load.
Including provisioning and reports, the final desktop machines held 48.0
core-minutes versus 41.3 for the warm baseline. Both final machines missed the
image cache and took 95.2 and 98.8 seconds to become ready; the warm baseline
was ready in 3.7 seconds after admission. Total measured desktop cost did not
improve in this pilot, despite the lower script compute. The final unit machine
held 9.6 core-minutes; the older unit baseline has no machine-held summary.

The initial desktop split with two workers per shard passed but took 321 and
278 seconds, costing 39.9 core-minutes. It did not meet the wall-time or compute
goals, so the final configuration uses three workers per shard. A later
validation on the two-worker setting also exposed two navigation assertion
failures; they were not counted as successful performance samples.

To reproduce fresh-start measurements, alternate the following commands five
times, using the same image tag. Record failures as well as successful timings.
The JSON summary's startupSeconds starts at actual provisioning, excluding the
local pool queue. The wallSeconds value includes that queue.

```sh
JUNO_REMOTE_IDLE_MINUTES=0 JUNO_REMOTE_IMAGE_CACHE=off pnpm remote --fresh --machine linux/amd64:2x4 test:agent-contracts
JUNO_REMOTE_IDLE_MINUTES=0 JUNO_REMOTE_IMAGE_CACHE=on pnpm remote --fresh --machine linux/amd64:2x4 test:agent-contracts
```


Five alternating fresh-machine pairs gave these create-to-ready results,
excluding the local queue but including SSH retries:

| Setting | Successful / attempted | Median | Range | Pull seconds |
| --- | ---: | ---: | ---: | --- |
| Cache off | 5 / 5 | 54.7 s | 50.2–99.4 s | 43–59 |
| Cache on | 3 / 5 | 54.5 s | 7.3–73.2 s | 0, 47, 57 |

The cache arm had one create timeout and one inventory API Unavailable failure.
They have no startup timing and remain failures, rather than zero-second samples.
The final pair used the 8 GB request; earlier requests used 16 GB. A separate
three-machine pilot also had one hit at 11.2 seconds and two misses at 60.2 and
118.0 seconds. Hits can reach the ten-second target, but the measured hit rate did
not establish a reliable saving. Keep this cache opt-in to avoid adding storage
charges by default. The one-minute idle setting remains the default.
