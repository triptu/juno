# Engine test harness

The tests run the real engine and state client over a MessageChannel against the fake Slack server. Run them through the root machine lock:

```sh
node scripts/heavy.mjs pnpm --filter @juno/engine exec vitest run test/sync.test.ts
```

`startTestEngine()` disables periodic sweeps (`sweepIntervalMillis: 0`). Boot, reconnect and `force_reload` still run normally. The fake configuration makes the follow pass due with every catch-up.

- `phase('live')` waits for the interactive catch-up. The background follow pass can still be running.
- `syncIdle()` waits for started sync cycles, including the follow pass, to finish. Call it after observing the phase for the operation you triggered. It does not wait for future cycles, socket events or command retries.
- `handle.commandIdle()` waits for background command recovery fibers, including the lookup's local transaction. Await the command first so its recovery has been scheduled.
- `rowsUntil(predicate)` waits for the actual sidebar outcome after a command or socket event.
- `waitFor(predicate, timeout, label)` accepts synchronous or async predicates. Only a resolved value other than `undefined` completes the wait; errors reject it.
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
