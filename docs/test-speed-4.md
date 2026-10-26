# Test speed round 4

Measured on 2026-10-19 from `1d203bf3c`, on the Linux laptop's dense cores at 3.3 GHz.
Each full or sample job reserved two whole physical cores (four threads), with three desktop workers.
The small idle validation reserved one physical core, two threads and 3 GB. This branch ran one remote
command at a time. Other owners may use the other cores. These are single observations, not a
speedup distribution. No production application code changed.

## Measurements

| Run | Before | After | Result |
| --- | ---: | ---: | --- |
| Full desktop, remote wall time | 1,139 s | 716 s | Before: 433 passed + two retried, 42 skipped; after: 400 passed, 45 skipped, no retries |
| Full desktop, script time | 1,136 s | 712 s | Includes builds |
| Electron launches, observed | 491 | 454 | Before includes two retry launches |
| Electron launches, excluding retries | 489 | 454 | 33 saved by flows, two by the idle change |
| Full unit, script time | 158 s | 150 s | 1,803 then 1,801 passed; 197 then 195 files |
| Three-spec sample, script time | 70 s | 34 s | 29 then 19 passed; no retries |
| Three-spec sample, summed test time | 107.8 s | 68.8 s | Same assertions |
| Portable idle test body | 14.0 min | 52.9 s | Full two-core runs; focused one-core run: 52.4 s |

The protected desktop baseline started at 16:13 IST and completed in 1,136 s of script time
(1,139 s including remote setup). Its build restored in 0.03 s. It retained two retries;
see the failure audit below. The after-run started at 16:32 IST and built in 24.05 s.
The after-run completed in 712 s of script time (716 s including remote setup). Both full
measurements include their build cost; the after-run had a cold build, not a cache advantage.
Both reserved physical cores 4 and 5 (logical CPUs 4, 16, 5 and 17). Average container CPU
rose from 56% to 88% of four threads (medians 74% and 95%): the long idle tail is gone, so
ordinary test work now sets the elapsed time. The full elapsed reduction is 423 s, not the
entire idle-test reduction, because the original idle walk overlapped other tests. Peak
container memory was 2.84 then 2.73 GB, including file cache. The complete logs are
`.remote/20261019T104317-70434-e7e50875/run.log` and
`.remote/20261019T110250-79783-0245a5af/run.log`.

The unit commands started at 14:11 and 14:20 IST (160 and 154 s including remote setup).
The sample commands started at 14:13 and 14:22 IST. Its baseline built the app in 25.51 s;
the after-run restored the build in 0.02 s. Do not attribute that build difference to the flows.
Summed per-test time was attachments 41.3 → 30.7 s, Home writing 41.2 → 26.6 s, and mentions
25.3 → 11.5 s. Tests overlap across workers, so their sum is not command wall time.

Three interrupted desktop attempts are excluded from test results. The 13:53 baseline container
`juno-20261019T082350-17519-0ca26f6d` was killed after 1,041 s by another runner script's bug,
confirmed by the owner. The 14:23 after-run lost SSH with “Connection reset by peer” / “Broken pipe”
after 1,297 s. Neither produced a complete test report. The runner was reachable and had no
containers at 15:30 before the baseline replay started. The replay snapshots the original commit,
then restores the candidate files locally after transfer; it does not change branch history.
That 15:30 replay also lost SSH after 1,004 s, at 15:47 IST. The owner confirmed both SSH losses
were Mac idle sleep (Deep Idle / DarkWake in pmset), followed by the runner’s normal cleanup.
Replacement measurements use `caffeinate -i`; no runner code was changed. Interrupted attempts
are excluded from test results.

## Flows and coverage

Fifty tests become seventeen flows, saving 33 initial Electron launches. The idle change replaces
three portable launches with one. Ordinary executable test cases therefore go from 435 to 400;
explicit restart launches remain. The final runs also log actual `launchApp` calls with
`JUNO_E2E_TIMINGS=1`. The baseline logged 491 launches, including two retry launches: 489
without retries. The after-run logged 454 launches with no retries. The 54 launches beyond one per ordinary case, including restarts, remain; the 35-launch
reduction comes from shared flows and the portable idle change.

| Spec | Related tests → flow |
| --- | ---: |
| `mentions.spec.ts` | 5 → 1 |
| `links.spec.ts` | 3 → 1 |
| `all-topics.spec.ts` | 3 → 1 |
| `home-topic.spec.ts` | 2 → 1 |
| `quick-reactions.spec.ts` | 2 → 1 |
| `art.spec.ts` | 2 → 1 |
| `stick-bottom.spec.ts` | 3 → 1 |
| `actions.spec.ts` | 2 → 1 |
| `palette.spec.ts` | 2 → 1 |
| `home-write.spec.ts` | 5 → 1 |
| `message-actions.spec.ts` | 4 → 1 |
| `send-checks.spec.ts` | 3 → 1 |
| `attachments.spec.ts` | 3 → 1 |
| `topic.spec.ts` | 2 → 1 |
| `sidebar.spec.ts` | 3 → 1 |
| `privacy-sharing.spec.ts` | 2 → 1 |
| `juno-agent/chat.spec.ts` | 4 → 1 |

Every original test title is retained as a `test.step` label. An AST comparison of these 17 files
counted 2,021 assertion/driver-expect calls before and 2,022 after. Two expression changes are
intentional: the link flow checks links opened by its own step using a saved array offset, and the
250 ms topic-open assertion moves unchanged to `topic.perf.spec.ts`, with readiness checked normally.
The extra call verifies the composer has returned to the bottom before the scrolled-up step.
No exact duplicate test was deleted; there is no removed-duplicate mapping.

Cold caches and starts, restart recovery, different seeded state, AI-off/provider setups, failed
uploads, retry/timeout cases and independent thread/Juno scrolling paths stay separate. The panel
flow changes width and visibility only after each preceding state has been asserted. Fixture
request logs are reset between send steps where an exact request count belongs to that step;
application and fake workspace state are not reset.

Focused local checks passed the merged flows, including 68 tests in the second batch and all nine
Juno chat tests after the panel merge. The final full remote run passed all 400 ordinary cases
without retries. Its three additional skips are the relocated desktop perf cases, which passed
separately on the Mac.

## Timing checks

`pnpm perf` holds the Mac's exclusive heavy lock and runs package budgets followed by desktop perf.
`pnpm perf --unit` runs only package budgets; a `-g` filter keeps the desktop-only workflow.

- Agent Activity moves to `activity.perf.ts`; cached chat windows move to `serve/chat-cache.perf.ts`.
  The latter retains the 50 ms event p95, 5 ms query p95 and retained-heap limits. A normal
  `chat-cache-budget.test.ts` keeps the 100-event correctness scenario and payload ceiling; the
  existing property test still compares cached pages with full rebuilds.
- Turn timing remains a normal correctness scenario in `turn-timing.test.ts`; its two 100 ms p95
  assertions run only under the perf configuration. The separate normal timing project is gone.
- Engine `idle.perf.ts` holds the pure idle CPU test. CPU assertions in `actions.test.ts` and
  `outbox-idle.test.ts` run only under perf. AI `pi.test.ts` runs its task timeout on the test
  clock and has no elapsed-time assertion (10-24).
  Queue state, deadline outcomes and query-count assertions remain in normal runs.
- Desktop cached topic opening keeps its 250 ms bound in `topic.perf.spec.ts`. First-sync 30 s and
  preview 10 s ceilings move intact to `quick-start.perf.spec.ts`; normal checks wait for readiness.
- Existing opt-in `test/bench` budgets now run from `pnpm perf` with strict budgets enabled.

All three relocated desktop timing checks passed on the Mac. The final package perf run passed
Agent, Engine idle/action and AI checks. The large-seed sidebar query measured 7.2 ms p95
against 5 ms then, with other work on the Mac; six runs on 10-19 gave 4.0 to 8.6 ms (median 2.8 ms), so its
budget is now 10 ms. All topics' first window gave 4.8 to 5.5 ms, so its budget is now 8 ms. An earlier
observation also failed turn resume at 106.4 ms, while lint overlapped part of the run; the final
Agent check passed. The old Frequent fixture expected six destinations although the domain now
returns five people and five channels; correcting it to ten passed a focused run and the final
perf run. This was a row-count expectation, not a request-count budget.

## Idle smoke check

The old large-seed walk waits for first sync and then ten real 60 s windows with 10 s settling;
a discovery sweep may add another window. A test clock cannot prove real process CPU or memory.
The new portable test keeps production scheduling but uses 200 topics, 2,000 messages, 80 users
and 28 conversations, so a fresh sync is short. It checks after sync, an open topic, the Juno panel
after a reply, and a hidden window. Each state settles for 2 s and samples for 10 s. It stays
`@heavy @heavy-idle`: full/release runs include it, ordinary unrelated `affected` plans do not.

The one-core clean run at 14:15 IST took 52.4 s in the test and 89 s including a 33.41 s cold build
(92 s including transfer). CPU peaked at 2% in its sampled states. The largest memory rise between
sampled states was 6 MB; most processes fell after GC. Memory must stay within 96 MB of its initial
reading at both peak and end, and must not rise by more than 2 MB in every interval with more than
32 MB total growth. These coarse margins tolerate page/model caches and GC; they do not claim to
find small or slow leaks. Every baseline process must survive the walk. The full after-run passed this check in 52.9 s
on the usual two-core app job, with no retry.

Temporary fault injections were removed after their remote snapshots:

| Injection on one core / 3 GB | Observation | Result |
| --- | --- | --- |
| Main busy loop, 80 ms per 100 ms timer, 14:17 IST | 46.3%, 47.0%, 47.1%, 45.7% | All four 25% CPU checks failed |
| Retain a touched 4 MiB buffer every 250 ms, 14:19 IST | Main 258 → 441 → 637 → 834 → 1,026 MB; CPU below 3% | Peak, end-growth and steady-growth checks failed |

The fine Mac `@mac` walk retains its 60 s windows, large seed and per-process budgets for runs by hand
measurements. App diagnostics, especially sustained-CPU logging and Settings › About, remain the
primary evidence for idle spins in the field. The synthetic walk did not catch the 10-18 outbox
spin; it cannot substitute for inspecting the actual persisted queues and process stacks.

## Failure audit

The audit read recent run logs under both worktree roots and the shared release waiver file.

- Fixed: normal runs applied timing budgets to a shared runner. Perf routing removes that source
  of unrelated-change failures while keeping the assertions on the Mac.
- Fixed: a root manifest change made `affected` forget directly changed desktop specs and private
  helpers when it selected ten sample specs. The new regression check failed before the fix and
  passed after it; all ten selection tests pass. Root changes now keep those specs mandatory.
- Fixed: the baseline reply-card test expected “sending” while holding only the HTTP answer.
  The fake handler had already posted the message and emitted its socket echo, so the card
  legitimately became “sent” before that assertion (the failure trace shows pending → sent).
  Holding before the handler runs keeps the sending state observable until explicit release.
  Both delivery and exact post-count assertions stay intact; the corrected test passed on its
  first attempt in the full after-run.
- Suspected: the baseline spelling-menu check saw only standard editing entries for 60 s, then
  passed on retry. Its Linux spellchecker may not have loaded a dictionary. Confirm by recording
  Electron’s dictionary download/initialization events and the misspelled word in the context-menu
  event; the log alone cannot distinguish dictionary readiness from hit testing. The unchanged
  test passed first try in the full after-run.
- Suspected: the waived selection-chip Backspace flake (`juno-agent/selection.spec.ts:85`). A queued
  `useFocusRequest` animation frame may refocus the composer between chip focus and key delivery.
  Confirm with focus-event and focus-request timestamps around that step. The chip handler itself
  removes the selection; no speculative product fix or waiver change was made.
- Suspected: cold-sync All topics layout movement, retried successfully in
  `first-sync-speed/.remote/20261019T031812-23260-a0c11802/run.log`. That incomplete log has no final
  assertion payload. Confirm by retaining anchor coordinates and row identities on the first
  failed attempt while releasing the held `subscriptions.thread.getView` response.
- The huddle branch's exact query-count failures add a `huddles.info` call; those logs belong to
  different feature code. This branch leaves the normal exact query budgets intact.

Final `pnpm affected` started at 16:05 IST. Typecheck, repository tools, full unit selection,
protocol checks, conformance, 297 gallery checks and 108 desktop checks passed, with no desktop
retries. Its initial lint check failed because the planner exceeded the 400-line file limit by
one line. Removing two redundant header lines fixed it; a separate full lint run passed all
11 checks. The original affected invocation therefore retains exit 1, despite its test gates
passing. It was not rerun. The later reply-card hold correction is covered by the full after-run
and a fresh Bun typecheck and all 11 lint checks, both passing.

## Where desktop time goes

One full run with per-test timings, `pnpm remote --env JUNO_E2E_TIMINGS=1 test:desktop`, from
`52dbdbb50` (main plus the timing reporter) at 23:00 IST on 10-19: two physical cores, three workers.
`node scripts/e2e-timings.mjs <run.log>` sums the `e2e-timing:` lines `apps/desktop/e2e/timings.ts`
prints. 400 passed, one failed (`topic.spec.ts` header order: the huddle button is new on main), one
passed on retry (`layout-shift.spec.ts` cold sync), 45 skipped.

| Where | Time | Share | Note |
| --- | ---: | ---: | --- |
| Remote wall time | 813 s | | |
| Remote setup: snapshot, transfer, container, install | about 8 s | 1% of wall | Install 0 s from the store |
| App build | 31.7 s | 4% of wall | Cold: a new file under `scripts/` changed the build key |
| Playwright suite | 769 s | 95% of wall | First test at 0.8 s |
| Worker idle at the end | 4, 9, 19 s | 1–2% | Busy 765, 760, 750 s of 769 s |
| Summed test time | 2,276 s | 100% | 404 test runs including two retries |
| Electron launch to first window | 376 s | 17% | 404 attempts containing launches; per-attempt median 0.89 s, p90 1.34 s |
| Sign-in: button to signed-in window | 393 s | 17% | 388 attempts containing sign-in; per-attempt median 1.00 s |
| Sync wait after sign-in | 486 s | 21% | Median 1.19 s; engine busy until idle is 194 s of it (median 0.42 s) |
| Close | 64 s | 3% | Median 0.15 s |
| Fake Slack start | 15 s | 1% | Median 37 ms |
| Test steps after setup | 942 s | 41% | Remainder |
| Fixed waits (`waitForTimeout`) | 72 s | 3% | `mark-unread` 12 s, `presence` 8 s, `send-checks`, `ai-errors`, `break-pass-1017` 6 s each |
| `expect.poll` and `toPass` | 135 s | 6% | `juno-agent/crash` 29 s, `send-checks` 10 s, `juno-agent/transfer` 9 s, `quick-start` 9 s |

Phase times are summed within each test attempt, so a restart test includes multiple launches in one
value. Phase counts count attempts containing that phase, not individual calls. Fixed waits and
polls are part of the setup or test-step rows; they are not added again. Launch,
sign-in and sync together are 55% of summed test time. A warm relaunch on the same user data
(local Mac, one worker) was ready 0.21–0.30 s after its window opened, against 0.93 s for sign-in
plus sync on a fresh one, so most of the sign-in and sync cost is first sync, not boot.

The 15 slowest specs, summed test time (and the part spent launching, signing in and syncing):
`juno-agent/crash` 129 s (46 s), `realtime` 107 s (31 s), `send-checks` 74 s (38 s),
`break-pass-1017` 74 s (42 s), `layout-shift` 65 s (49 s), `tabs` 57 s (30 s), `idle-cpu`
54 s (4 s), `juno-agent/states` 54 s (41 s), `topic` 50 s (32 s), `juno-agent/chat` 49 s (31 s),
`juno-agent/transfer` 47 s (18 s), `attachments` 44 s (30 s), `juno-agent/t3` 42 s (26 s),
`palette` 41 s (28 s), `reaction-delivery` 40 s (15 s). The slowest single tests are the idle
walk (54 s), the 429 storm (34 s) and the title-lines relaunch (24 s).

Other cheap wins seen, with estimated savings (estimates, not measured):

- The build key now excludes package/app test directories and script test files. Seed definitions,
  migrations and other source helpers still invalidate it. Build-cache checks verified both
  behaviours; the avoided 30 s build cost is an estimate from the baseline cold build, not a
  separate timed before/after pair.
- Fixed waits sum to 72 s; replacing the five largest with waits on a condition would save
  perhaps 30 s summed, about 10 s of wall time.
- `juno-agent/crash` spends 29 s in polls; a signal for the agent's restart could save perhaps
  10 s summed.
- The sync wait spends about 0.7 s (median) after rows show beyond the engine going idle, in rows,
  Home's greeting and parking the pointer. Not broken down further; worth a look.
- Worker imbalance is small (19 s at most), so reordering specs would gain little.

## Synced desktop starts

Default-seed flows now boot a fresh Electron process from a private copy of a worker's synced
workspace. The fake is rebuilt with the original seed time, port and accepted sessions. The
snapshot key includes the verified build fingerprint and effective sync options. Copies expire
within the worker and are never kept between runs. The fixture checks fake workspace state
before and after boot, and checks that a fresh socket connects. Details and exceptions live in
[Desktop e2e](../apps/desktop/e2e/README.md#synced-start).

The inherited full snapshot run finished after the previous worker exited. Its report is complete
but failed for the same header-order expectation and first-sync retry as the baseline.

| Run | Remote wall | Build | Playwright | Summed attempts | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Before, `52dbdbb50` | 812.5 s | 31.69 s | 769.3 s | 2,275.8 s | 400 passed, 1 failed, 1 flaky, 45 skipped |
| First snapshot, `9ca20e022` | 697.4 s | 0.02 s restored | 688.9 s | 2,036.9 s | 400 passed, 1 failed, 1 flaky, 45 skipped |
| Snapshot validation 1 | 695.5 s | 29.74 s | 652.9 s | 1,932.7 s | 402 passed, 45 skipped; no retries |
| Snapshot validation 2 | 665.1 s | 0.02 s restored | 657.3 s | 1,946.7 s | 402 passed, 45 skipped; no retries |

The first snapshot pair saves 80.4 s in Playwright while retaining the same failures. Its wall-time
saving also includes a warm build. Validation 1 has a cold build like the baseline: 117.0 s less
wall time, or 14.4%. It also contains the header and preview-hold fixes, so that whole reduction
cannot be attributed to snapshots alone. Among 150 matching successful first attempts that
switch to snapshots, summed test time is 772.9 s before, 556.1 s in the inherited snapshot run,
and 557.5 / 560.2 s in the two validation runs. That excludes the failed header test, retains snapshot-building cost,
and does not sum overlapping tests into a wall-time claim. The two complete validation suites take
652.9–657.3 s, 14.6–15.1% less than the baseline. Validation 2 restores the build, which accounts
for about 30 s of its extra wall-time reduction. [Every spec's before/after
totals](test-speed-4-specs.md) are recorded, including unchanged and slower specs.

All runs use two physical cores and three workers. Validation 1 averaged 87% CPU busy, with a
94% median, and peaked at 2.66 GB container memory including file cache; the baseline was 89%,
96% and 2.68 GB. It built eight snapshots, costing 23.2 s summed within test setup. The suite is
still CPU busy; agent lifecycle flows, real sync and the test bodies remain most of the work.
Validation 2 averaged 89% CPU busy, with a 95% median, and peaked at 2.85 GB. Its eight snapshot
builds cost 24.5 s summed. These are individual full-suite observations, not an interleaved
distribution of baseline runs. Both retain the same 45 platform/perf skips as the baseline. Cold
sync and agent lifecycle flows remain in the suite; ordinary snapshot starts still connect and catch
up for real.

Failure fixes keep their assertions:

- The topic header's focus order includes the new huddle button, still missing in `origin/main`
  when checked. The check now visits all five buttons.
- The first-sync Home probe held reply previews too late. Previews run alongside history, so
  the hold is installed before sign-in. Its existing held-request and stable-position checks remain.
- A focused run exposed a different cold-page flake: unfocused sidebar rows reordered while
  Home was being checked. SPEC 5 allows this while cold history and Automated membership arrive.
  The page probes exclude only the sidebar's topic-list region, as the adjacent probe already
  does. Home/All topics anchors and all movement outside that region remain checked; sidebar
  flows cover its order. This scope correction follows validation 1 and is included in validation 2.

A temporary negative control cleared the fake's read pointers after the snapshot was selected.
Fixture setup failed with "The fake no longer matches the synced workspace" before the test body
ran, in `.remote/juno-1792435873225-66019-d48d4790/run.log`. The injected spec was removed.
Build-cache checks also change seed, migration and sync source files and verify that they rebuild,
while edits confined to tests reuse the build. Running that regression check against the old
cache-key code failed on the first test-only edit; the new code passes. Lint and Bun typechecking
pass.

`pnpm affected` passed every step: Bun typechecking, all 11 lint checks, 100 repository-tool
checks, and the selected unit and desktop tests. The unit lane passed 391 tests with 8 existing
skips. Its report is `.remote/juno-1792436660827-69795-8b407637/run.log`; the desktop report is
`.remote/juno-1792436660827-69796-85af0eaa/run.log`, and the coordinator is
`.remote/juno-1792436659690-69658-aa4b9ea9/plan.log`. No production app code remains changed,
and no branch was pushed or merged during this work.

## Worker app reuse experiment

A temporary prototype kept Electron main alive, stopped the engine, destroyed its windows,
restored the snapshot workspace and launch preferences, restarted the fake on its original port,
and opened a new engine and renderer. Each measurement ended only after rows, engine readiness
and Home were ready. It then opened the seeded thread and asserted its title; every reset also
checked for exactly one fake socket. Five pairs alternated which mode ran first.

| Load | Samples per mode | Fresh launch median, range | Minimal reset median, range | Median paired saving |
| --- | ---: | ---: | ---: | ---: |
| One worker | 5 | 879 ms, 830–894 | 672 ms, 642–684 | 207 ms |
| Three workers | 15 | 2,106 ms, 1,873–2,597 | 1,653 ms, 1,150–2,002 | 436 ms |

Both remote jobs reserved two physical cores. The three-worker job averaged 94% CPU busy and
99% at the median over four threads. Three repeats ran concurrently, each with its own fake,
user-data directory and five alternating pairs; all passed without retries. The engine and
renderer still have to start and sync, which limits the benefit of keeping main alive.

This is a lower-cost prototype, not a safe reusable fixture. It did not reset provider/keychain
state, notification deduplication, all main-process test counters, Chromium storage or every
background service. Both modes kept warm Chromium caches. Complete isolation would add work.
The earlier full snapshot run had 151 snapshot starts; 151 × 0.436 / 3 projects to about 22 s
of suite time, about 3% of the 813 s baseline. That projection is a guess, not a full-suite
reuse measurement, and does not include the extra cleanup. The prototype was removed rather
than adding a second application lifecycle for that expected saving. All specs retain fresh
Electron launches, including launch, quit, restart, recovery, update and multi-window scenarios.
No full suite was run with the incomplete reset.

Logs: `.remote/juno-1792435048736-62095-f2bc30da/run.log` and
`.remote/juno-1792435106251-62448-a7bd5db3/run.log`. The first experiment invocation is excluded:
it closed a fixture-owned server twice, failed teardown, and did not retain individual samples.
The corrected experiment owns its fake independently. Its source and main-process patch are
kept locally in `.remote/reuse-experiment.ts` and `.remote/reuse-experiment.patch` for review.
