# Engine test harness

The tests run the real engine and state client over a MessageChannel against the fake Slack server. Run them through the root machine lock:

```sh
node scripts/heavy.mjs pnpm --filter @juno/engine exec vitest run test/sync.test.ts
```

`startTestEngine()` disables periodic sweeps (`sweepIntervalMillis: 0`). Boot, reconnect and `force_reload` still run normally. The harness also sets `followPassMillis: 0`, so each catch-up checks follows; the app keeps its production cadence against both real and fake Slack.

A fresh test engine copies an empty migrated store from a template built once per file's isolated module context (`migratedWorkspace.ts`). The template is closed before copying and removed after the file. Each engine has its own database files, fake Slack server on an allocated port, scope and atom registry. It still performs a cold sign-in and sync. Warm restarts reuse their existing files without copying; store migration and recovery tests continue to start from scratch.

Related assertions can share one engine inside a named `step` flow. Separate tests never share a mutable engine. Cold-boot scenarios, different seeds and independent failure cases stay separate. The large-workspace and socket-liveness repair tests live in separate files so remote workers can overlap them without shortening their waits.

The engine runs the fake AI, but its background AI jobs (titles, topic art, Home's AI items and title rewrites, Juno's Automated check) are off unless a test passes `aiJobs: true` to `startTestEngine()` or `bootedEngine()`. Without them a thread keeps its fallback title, no art is drawn, and the Automated job places only what its rules can, asking on Home about the rest as with AI assist off. A test that waits for a job's output opts in; `restart()` does not carry the option.

- `phase('live')` waits for the interactive catch-up. The background follow pass can still be running.
- `syncIdle()` waits for started sync cycles, including the follow pass, to finish. Call it after observing the phase for the operation you triggered. It does not wait for future cycles, socket events or command retries.
- `handle.commandIdle()` waits for background command recovery fibers, including the lookup's local transaction. Await the command first so its recovery has been scheduled.
- `rowsUntil(predicate)` waits for the actual sidebar outcome after a command or socket event.
- `waitFor(predicate, timeout, label)` accepts synchronous or async predicates. Only a resolved value other than `undefined` completes the wait; errors reject it.
- `openWindow()` gives a second atom registry on a new port to the same engine, as a second renderer would be: a live query mounted there is a new subscription at once, with no wait for the 30 s idle time. `stop()` disposes it; `restart()` does not, so do not combine them.
- `quiet()` drains sync cycles and then polls for a quiet API window. Use the explicit completion helpers for budgets and command recovery.

`bootedEngine()` and `restart()` wait for `live` and `syncIdle()`. Stop and restart dispose the old atom registry so its ports and subscriptions do not reconnect after shutdown. Before resetting the fake's call log or dropping the socket for a new operation, finish the preceding cycle. A fake call record says the server handled a request; it does not prove the engine applied its answer.

## Loaded repetitions

`stress-flakes.mjs` starts eight CPU-burning Node processes, runs the command serially, saves each run under `.juno-status/flake-check/<label>/`, and stops the load processes even when tests fail. Retries stay off.

```sh
node scripts/heavy.mjs node scripts/stress-flakes.mjs engine 20 pnpm --filter @juno/engine exec vitest run test/sync.test.ts test/reconnect.test.ts -t 'warm boot reads every page|reads followed threads past the first getView page|Unsubscribe|rejected unsubscribe'
```

Build before repeating desktop tests:

```sh
pnpm build
node scripts/heavy.mjs node scripts/stress-flakes.mjs desktop 20 pnpm --filter @juno/desktop exec playwright test e2e/sidebar.spec.ts e2e/session.spec.ts --grep 'hovering a row shows|signs out:|comes back signed in' --retries=0
```

## Conformance

`test/conformance` replays Quint traces of `specs/outbox.qnt` against the engine and the fake Slack, and compares the two after every round (`specs/README.md`, "Conformance"). Run it with the root script, which generates the traces first:

```sh
pnpm specs:conformance                                  # here, behind the machine lock
pnpm remote specs:conformance                           # on a machine of its own
CONFORMANCE_ONLY=copy-7 pnpm specs:conformance          # only the traces whose file name contains this
```

- `itf.ts` reads ITF. `replay.ts` is the loop for any spec: it cuts a trace into rounds (a step the harness drives, then the steps Juno takes on its own), drives the first step, waits until the projections agree, and reports the first round where they do not, with the fields that differ, the gated calls and the outbox.
- `outbox.ts` is the outbox mapping: how each step is driven through the fake (`gate`, `decide`, `holdFramesWhere`, `releaseFramesWhere`) and the commands, and the projection both sides are compared on. A new spec adds a file like it and a `*.conformance.ts` entry. The outbox suite is in `outbox-suite.ts`; `outbox.conformance.ts` and `outbox-2` to `outbox-4` each take a share of the traces, slowest first, so vitest runs them in four workers.
- The files are not `*.test.ts`, so `pnpm test` does not run them: they need the generated traces. `vitest.conformance.config.ts` runs up to `JUNO_CONFORMANCE_CONCURRENCY` traces at once (default 6); each boots its own engine and fake.
- A divergence is a finding. Fix the code or the spec, or record why the trace cannot be replayed. Do not loosen the projection to make a trace pass.
