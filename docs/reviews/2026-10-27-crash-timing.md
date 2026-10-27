# Crash and backup test timing, 2026-10-27

The engine journey does not wait through five crashes or exponential retries to reach “gave up”. It kills the engine once and the agent once, then calls the real `EngineSupervisor.giveUp()` through the test hook twice. Restart starts a new engine immediately. Each actual crash did pay a one-second main-process backoff. Playwright’s default growing poll intervals added up to another second after readiness. The renderer also retries its RPC port every second (`effect/rpc`’s `makeProtocolWorker`), which accounts for the delayed failed-state display and reconnection after Restart. No heartbeat detects the killed processes: Electron’s exit event does. There is no long fixed sleep for recovery. The engine journey includes the driver’s 60 ms mouse press (63 ms observed), which is not a material part of its duration.

## Measurements

Two physical laptop cores (four threads), one Electron worker, default browser workers in the overlapping plan. Each test keeps its own app, fake and profile. Durations below are the structured reporter’s test times, excluding a worker’s shared synced-snapshot warmup. All reported passing runs exited 0. Build and allocation are outside the test times. Raw logs and the temporary instrumentation sources are in `/Volumes/AgentWork/scratch/crash-timing/`.

Before: `before-alone.log` and `before-traced-alone.log`, two runs each. The latter adds content-free main and engine log events. The step reporter records each Playwright operation’s epoch timestamp and duration; process log entries use UTC timestamps from the same machine. `before-beside.log` and `after-beside.log` run the whole browser lane alongside these four Electron tests in one `test:plan` job.

| Test | Before, alone (two runs) | Before, beside browser | After, beside browser |
| --- | --- | --- | --- |
| Engine restart and give-up | 12.30, 12.01 s | 15.92 s | 19.44 s |
| Durable message and relaunch | 2.21, 2.20 s | 4.26 s | 8.02 s |
| Uncertain write and clean relaunch | 6.61, 6.68 s | 10.42 s | 11.57 s |
| Backup, move and restore crash | 7.55, 7.43 s | 10.77 s | 12.99 s |

With the diagnostic patch removed, three isolated after runs all passed under the normal 15 s limit:

| Test | After, alone (three runs) |
| --- | --- |
| Engine restart and give-up | 10.41, 10.70, 10.12 s |
| Durable message and relaunch | 2.35, 2.59, 2.51 s |
| Uncertain write and clean relaunch | 5.90, 5.79, 5.82 s |
| Backup, move and restore crash | 6.48, 6.63, 6.74 s |

The three isolated after samples preceded the final assertion-order tightening; the two-worker checks below use that final ordering. These are test-duration observations, not a product performance benchmark. The durable-message test has no backoff to shorten and its small increase is consistent with launch variation.

The overlapping runs are single observations under different shared load, not an end-to-end speedup estimate. Their job CPU busy shares were 63% and 74%; the latter also spent more time launching and syncing. The engine journey’s launch grew from 0.60 to 0.93 s and its sync waits from 0.51 to 2.01 s. In the after trace, both crash backoffs are 50–52 ms; slower total time does not come from those timers. The historical 26.6 s full-run observation was not reproduced with one Electron worker.

## Engine journey timeline

The traced isolated baseline starts at **08:56:04.685 UTC**. Times below are seconds since that start.

| Time | Observation |
| --- | --- |
| 0.085 | Playwright begins Electron launch. Main is ready at 0.196, forks the engine at 0.205. |
| 0.339–0.345 | Main receives engine ready; the engine receives its key state and window port. |
| 1.626–2.252 | No-key assertions, saving the key, AI title/art and initial agent readiness. |
| 2.252–3.038 | Chat reads Slack; open #eng, retain a draft and clear the badge. |
| 3.038–3.045 | Kill sent; main receives the engine exit about 7 ms later. |
| 4.045 | Main forks again after exactly 1,000 ms. |
| 4.149–4.155 | New engine ready; key, window and agent ports arrive within 6 ms. |
| 5.013 | Test observes ready: roughly 864 ms after main, due to the growing poll interval. |
| 5.013–5.398 | Window/draft/sidebar checks 17 ms; sync/dock check 30 ms; live send 124 ms; new AI title 212 ms. |
| 5.398–5.616 | About status and ping. |
| 5.616–7.933 | Agent relinking journey: agent exit at 5.792, fork at 6.792, ready at 6.961. Test’s ready poll finishes at 7.758. |
| 7.933–8.268 | Wake restores badge, key removal stops AI, renderer scheme/traversal checks. |
| 8.273 | Main gives up directly. Engine exits 8 ms later. |
| 9.645 | Test clicks Restart after seeing the failed sidebar and preserved rows. Main forks immediately. |
| 9.749–10.291 | Engine ready and key handed over; window port comes on the renderer’s next retry. |
| 10.582 | Restart assertions complete. |
| 10.698–12.002 | Main gives up again; About shows failed, no PID and no restart. |
| 12.042 | Teardown begins; app close takes about 40 ms. |

The corresponding overlapping baseline’s kill detection is about 16 ms, backoff 1,005 ms, engine startup 140 ms, and key/port handoff within 8 ms. The dock checks take 29 ms after restart and 169 ms after wake. There is no multi-second dock poll or quit timeout on the passing paths.

## Change and coverage

Main’s engine and agent supervisors share `restartBackoff`. It keeps the production 1 s base and 30 s cap, divided by 20 only when `JUNO_E2E=1`, `JUNO_E2E_FAST_TIMING=1` and a fake Slack URL are all present. The crash limit, two-minute window, reset-on-ready and requested restore restart are unchanged. A production-timing test opts out through the existing launch timing option. Readiness and death polls check every 50 ms while retaining their deadlines. Both file-wide 60 s exceptions are removed: all four tests use the lane’s 15 s limit, or 30 s when Electron runs at lower priority beside the browser lane.

The uncertain-write test pays one agent backoff, and backup pays two (arming the restore crash and recovering from it). Backup also requests an orderly agent restart to install the restore; that has no backoff. Durable-message recovery quits after the kill and relaunches, so it does not wait for a supervisor restart. Its two launches prove durable recovery; the uncertain-write relaunch also proves persistence and starts codemode with its required options. Backup’s two profiles represent separate Macs. These launches and every assertion are retained. The incoming message now proves that the renderer has reconnected before checking the retained tab and draft; the send presses Enter on that draft without refilling it. Faster main readiness must not let those assertions run against the old window state.

The renderer’s one-second RPC retry remains. It is inside the dependency, not a configurable supervisor wait; replacing its protocol to save these few test seconds would be a much wider change. Engine topic-fetch scheduling is untouched.

## Reproduce

```sh
bun run remote --cores 2 --env JUNO_E2E_TIMINGS=1 test:electron e2e/juno-agent/crash.spec.ts e2e/juno-agent/backup.spec.ts --workers=1 --repeat-each=3
bun run remote --cores 2 --env JUNO_E2E_TIMINGS=1 test:plan test:browser + test:electron e2e/juno-agent/crash.spec.ts e2e/juno-agent/backup.spec.ts --workers=1
```

`instrumentation.patch` in the scratch folder adds the temporary process-log events and full operation timeline. It records only event labels, timestamps and durations, never key values or message content in process logs. It is removed from the shipped change. The first two commands use the existing timing reporter without that patch.

## Regression checks

Each temporary mutation ran only the engine journey on the laptop, one worker. All three built successfully, reached the relevant assertion, and exited 1. The source was restored after each run.

- Disable automatic restart after an exit: the first recovery check sees `restarting` instead of `ready` (`mutation-auto-restart.log`).
- Disable the user's Restart when the engine is failed: the check after clicking Restart sees `failed` instead of `ready` (`mutation-restart.log`).
- Suppress give-up listeners: the dock check sees `•` instead of an empty badge (`mutation-giveup.log`).

A direct check of the backoff configuration also passed: any missing e2e/fast/fake gate keeps the production 1,000 ms base and 30,000 ms cap; all three gates give 50 ms and 1,500 ms. No crash-count or crash-window code changed.

## Combined desktop worker count

The first `bun run affected` passed typecheck, lint and 20 DOM tests, but its combined desktop step and both changed-spec repetitions timed out the engine journey at 15 s. It launched eight Electron workers on eight allocated threads (four physical cores), alongside browser workers. The focused repeats also had eight apps competing at once. This is different from the full run’s two Electron workers with a 30 s lower-priority limit.

A controlled worker-setting check used the same four-core job, tag selection, desktop step and two repetitions, with `JUNO_E2E_WORKERS=2`. Every test passed. The complete desktop step went from 82 s (one failure) to 79 s (57 passes); the engine journey took 12.20 s, durable-message recovery 2.77 s, uncertain-write recovery 5.63 s and backup 6.84 s. The repeated engine journeys took 10.50 and 10.88 s. This is one run per setting, so the wall times show no observed throughput penalty for that step, not a statistical speedup. The repeated-spec step queues more tests with two workers and takes longer, while passing its per-test limits.

`scripts/remote/workers.sh` now defaults to one Electron worker per four allocated threads for jobs with at least eight threads. Smaller allocations, explicit `JUNO_E2E_WORKERS` overrides and the full plan’s own lane allocation are unchanged. The old large-allocation override to one worker per thread was incompatible with the new 15 s test limit. Logs: `affected.log` and `two-workers.log` in the scratch folder.

The four recovery tests passed ten stress repetitions each (40 test executions plus two setup checks). After tightening the draft assertion order, the engine journey passed ten further stress repetitions (plus two setup checks), with no retries or failures. `bun run verify:main --ref HEAD --smoke` passed after the runner change; its smoke record does not approve a release. Logs: `stress-wait.log`, `stress-final.log`, `smoke.log`.

Final validation after rebasing onto main (including the separate topic-fetch scheduling change): `bun run affected` exited 0. Typecheck, lint, health, runner tests, DOM tests, every selected desktop spec, the changed-spec repeats and repository-tool tests all passed. The desktop steps reported 58 and 10 passing checks including setup. The final engine journey took 11.91 s in the combined step and 11.80/10.72 s in its repeats, within the normal 15 s limit. Source changes do not alter topic-fetch scheduling. Log: `affected-final.log`; remote plan: `juno-1793093254949-23855-d1545ca4`.
