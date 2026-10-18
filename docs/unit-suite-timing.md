# Unit suite timing

Measured on 2026-10-19 from main at `9f3c80b04`. The SSH laptop was unreachable, so all reported suite runs used Namespace Linux 8x16, eight Vitest workers, and two package jobs. Each suite comparison is one uninstrumented run per side. Profiling is separate. No DOM environment or per-file DOM directive is configured; Vitest uses Node.

## Measurements

The full command fell from 155 s to 135 s. Engine elapsed time fell from 116.85 s to 97.98 s. These are single runs, not a distribution. Splitting the repair file removed the largest serial path. Schedule windows fell by 11.62 s per file. Art and title flows fell by 5.05 s and 1.87 s. Other file differences are small or mixed, so they do not establish a speedup.

| File | Before, s | After, s | Tests before → after | Boots before → after |
| --- | ---: | ---: | ---: | ---: |
| `mutation-repair` | 114.87 | 18.96 | 15 → 11 | 23 → 18 |
| `mutation-activity` | 50.50 | 51.74 | 1 → 1 | 1 → 1 |
| `sync` | 45.83 | 47.22 | 52 → 45 | 58 → 51 |
| `send` | 33.27 | 31.32 | 18 → 16 | 20 → 18 |
| `slack-schedule` | 28.33 | 16.71 | 6 → 6 | 8 → 8 |
| `reads` | 26.20 | 25.89 | 14 → 11 | 17 → 14 |
| `actions` | 22.42 | 20.91 | 15 → 12 | 16 → 13 |
| `art` | 20.52 | 15.47 | 4 → 2 | 4 → 2 |
| `outbox-failures` | 19.43 | 19.51 | 6 → 6 | 8 → 8 |
| `ai-titles` | 18.57 | 16.70 | 4 → 3 | 4 → 3 |
| `mutation-repair-large` (moved) | included above | 59.98 | moved → 1 | moved → 2 |
| `mutation-repair-socket` (moved) | included above | 44.33 | moved → 3 | moved → 3 |
| Whole `pnpm remote test`, script time | 155 | 135 | 1,812 → 1,795 | |

The repair row is split, not deleted. Its 15 tests and 23 boots remain across the three files. Eight skipped unit tests are unchanged. The original eight selected files fell from 119 to 101 tests and from 135 to 117 boots. The new isolation check adds one test and two boots elsewhere. The focused command itself was 50 s before and 54 s after; the after-run also includes the two harness tests. There is no measured improvement in that command's elapsed time.

### Boot breakdown

These are medians of five alternating paired samples per mode in one remote process, after one warmup per mode. All samples create a fresh fake and perform a cold sync. Store construction includes its migrations. Ready, live, socket, and sync waits overlap other rows and must not be added together. `client.userBoot` below measures the HTTP response; first-sync time also includes decoding, SQLite writes, discovery, and the follow pass.

| Boot component | Fresh migrations, ms | Schema copy, ms |
| --- | ---: | ---: |
| Fake Slack start | 14.29 | 14.30 |
| Schema copy/setup | 0.23 | 0.71 |
| SQLite open and Store construction | 18.08 | 4.00 |
| Migrations, included in Store | 12.72 | 0.38 |
| Effect app layers | 1.23 | 1.33 |
| Registry and RPC port acquisition | 0.56 | 0.60 |
| Wait for ready, including Store | 27.69 | 13.15 |
| auth.test HTTP response | 2.31 | 2.60 |
| client.userBoot HTTP response | 4.59 | 4.16 |
| First sync cycle, including userBoot | 106.48 | 111.02 |
| Socket online after sync starts | 16.08 | 14.92 |
| Wait for live after ready | 97.67 | 103.71 |
| Wait for syncIdle after live | 9.92 | 5.54 |
| Total fresh start to syncIdle | 152.26 | 140.85 |
| Shutdown and directory removal | 6.63 | 6.27 |

Total start-to-idle ranges were 135–161 ms before and 140–160 ms after. Store construction consistently fell from about 18 ms to 4 ms, but the total ranges overlap. Template initialization is paid once per file and is included in suite times. Imports and transforms precede these boot timers.

### Conformance

| File | Before, s | After, s | Tests, unchanged |
| --- | ---: | ---: | --- |
| `outbox-2.conformance.ts` | 24.08 | 21.99 | 25 tests, 6 skipped |
| `outbox-3.conformance.ts` | 24.66 | 24.97 | 21 tests |
| `outbox-4.conformance.ts` | 23.57 | 23.61 | 21 tests |
| `outbox.conformance.ts` | 24.41 | 24.07 | 25 tests, 6 skipped |

All 80 tests passed with the same 12 pre-existing skips. Each replay still boots its own engine and repeats the same crash restarts. No conformance body or projection changed. The replay configuration already runs files and traces concurrently. Total script time was 27 s before and 28 s after.

### Run evidence

All raw runs are in this worktree's ignored `.remote/` directory:

- Focused baseline: `20261018T213724-11552-60c22274/run.log`.
- Full baseline: `20261018T214253-17018-d843074a/run.log`.
- Full after: `20261018T215616-31270-a2f06467/run.log`.
- Paired boot profile and failing hard-link mutation: `20261018T215324-29044-f775dc51/run.log`.
- The complete script commands and backend metadata are at the start and end of each log. The temporary profiling instrumentation, benchmark test, mutation, and historical-cadence reversal are not in the commits.


## What takes time

A separate instrumented full run recorded fake startup, store opening and migration time, Effect construction, RPC acquisition, sync cycles, socket readiness, shutdown, and process CPU. Ordinary default boots take about 0.15–0.25 s after imports. The large seed is a different workload: fake construction alone took 6.2 s in the repair profile.

The original slow-file report does not describe this checkout exactly. Store has six files and took 3.7 s in the profiling run. Agent has 47 files and took 25 s. Remote engine file parallelism was already enabled; the local serial default did not cause the measured remote time. `scripts/unit.mjs` runs packages in dependency order, with two package jobs on Namespace.

The longest current file was `mutation-repair.test.ts`: about 56 s for the large-seed journey, 32 s for the half-open socket, 11 s for the failed-frame pong, and the remaining repair scenarios. The first three now run in separate large-seed and socket files. Their bodies, seeds, timeouts, and assertions are unchanged.

| Requested file | Main waits and work |
| --- | --- |
| `sync` | 58 measured boots, about 20.5 s summed through each first cycle, including larger seeds and restarts; 5 ms condition polling, 300 ms quiet windows, reconnect backoff, and a few negative-observation sleeps |
| `send` | 20 boots, about 4.1 s summed; retry and reconciliation backoff, quiet windows, and two 1 s offline checks |
| `reads` | 17 boots, about 3.4 s summed; the 3 s coalescing test, 400 ms marks, reconnects, quiet windows, and negative checks |
| `actions` | Fresh engines and 300 ms quiet windows around sends and edits; retry backoff and a 1 s idle check |
| `slack-schedule` | Repeated 200 ms test debounces followed by 900 ms sleeps and quiet windows; now 25 ms and 150 ms, with the production 1 s debounce retained in the coalescing test |
| `art` | Four boots, about 1.0 s summed; 1.5 s job debounces, waiting for titles and drawings, and a 2.5 s AI-off check |
| `ai-titles` | 1.5 s title debounce, three negative observation windows totalling 9.5 s, and polling for calls and stored results |
| `outbox-failures` | Five exchanges exhaust 1 + 2 + 4 + 8 s of production retry backoff; most other waits are conditions |
| Four conformance files | Concurrent trace boots, 25 ms projection polling, real retry backoff, and up to 8 s to reject an intentionally broken trace |

Vitest reported only 6% of engine suite duration in imports and transforms in the full profile. Migrations are repeated work, but neither imports nor migrations explain multi-second ordinary tests. The eight-file baseline used 14% of eight cores on average.

## Cadence comparison

At the same main revision, restoring the policy before `0e08aea5c` took 53 s for the focused command, versus 50 s with current policy. `sync` was 45.12 versus 43.81 s. There is no material slowdown attributable to that commit: both policies pass `followPassMillis: 0` to the unit engine and disable periodic sweeps. The comparison restores the old binding and configuration, without reverting unrelated later changes. An earlier incomplete reversal could not boot and was cancelled; none of its times are used.

## Isolation and alternatives

- The template contains only empty migrated `user.db` and `cache.db`. The real Store closes and checkpoints before copying. Each test receives regular copies in its own directory. Restarts retain their existing files. The store migration and recovery suites still migrate from scratch.
- The isolation test writes a pin, closes the engine, then boots another engine and verifies that the pin is absent and cold history calls still run. Replacing copies with hard links made this assertion fail; restoring copies passed.
- A booted snapshot was not adopted. It would change cold sync into warm sync, and fake state includes timestamps, server-specific avatar URLs, sessions, held calls, and socket state. The migration copy avoids those changes.
- A shared fake server was not adopted. Startup is about 14 ms and there is no complete reset of all mutable server state. Private ephemeral ports already allow parallel files.
- Pure-rule candidates already exist: `observeServerRead`, `acknowledgeLocalWrite`, `markReadLocally`, `markUnreadLocally`, `mergeMessage`, `mergeTombstone`, and `mergeRootCounters`. Their packages already test these rules. The remaining engine checks also verify persistence, socket ordering, command results, and visible rows, so they stay integration tests.
- Retry, socket-liveness, and negative AI checks retain their real windows. No sync protocol or production behaviour changed. No mutable engine is shared between tests.

## Assertion inventory

No assertion or behaviour was deleted. The old test titles below are named steps in the stated new flow. A comparison of all original assertion lines found none missing. Distinct starting states, cold-start cases, and failure scenarios remain separate.

### `sync.test.ts`

Flow: discovers the fixture workspace with exact rows, membership, titles, previews, counts, tags and order.

- discovers the fixture workspace: titles, previews, counts, tags and order
- shows exactly the rows of spec section 5: active Main rows and followed threads, no unfollowed thread at first sign-in
- comes from client.counts: channels the user is not in never reach the sidebar and cost no history call

Flow: boots within the call budget and filters rows and counts.

- spends an exact call budget: one history call per active conversation, every getView page, no call per row
- filters by kind, unread and scope, and counts for the dots

Flow: applies read, resolve, edit and delete events, then reconnects.

- a read mark from another client clears the unread count by the conflict rule
- a message after a resolve brings the topic back with the Reopened tag
- an edit and a delete reach the row through the merge guards
- goes offline while the socket is down and comes back live after a reconnect

Flow: rejects follow commands for Main and unknown topics without calling Slack.

- a Main has no follow: subscribing or unsubscribing it is NotFound and keeps its row
- an unknown topic is NotFound and nothing is called

### `reads.test.ts`

Flow: marks Main and threads read and unread, and clears new-thread counts.

- Main: the row is read at once and one conversations.mark carries the latest message
- a followed thread gets subscriptions.thread.mark read=1; an unfollowed one stays local
- a thread marked unread from a reply sends read=0 from that reply
- counts the threads others started since Main was last read; reading Main clears it

### `send.test.ts`

Flow: reconciles sends once with either the answer or echo first.

- shows the pending row at once, then the answer before the echo replaces it with one message
- lets the echo reconcile before the answer, and the late answer changes nothing

Flow: routes a reply to its thread and opens a new DM before sending.

- posts in a thread
- opens a DM with conversations.open for a person never messaged, then posts

### `actions.test.ts`

Flow: reconciles edits in both echo orders and preserves a newer local edit.

- shows the new text at once; the answer and then the echo leave it as it is
- keeps the edit when the echo comes before the answer
- holds the user’s edit over another client’s edit that lands while it is out

Flow: deletes a message locally and reconciles deletion by another client.

- removes the message at once; the answer and the echo in either order leave it gone
- treats a message already deleted elsewhere as deleted

### `art.test.ts`

Flow: draws sidebar and header art, redraws and undoes it, then hides and restores it with AI assist.

- draws every thread and channel Main in the sidebar, keeps the photo on a DM Main, and stores each drawing once
- Redraw replaces a drawing with a different one, and Undo after a Redraw puts the previous one back
- shows the placeholder everywhere while AI assist is off, draws nothing new, and brings the drawings back when it is on again

### `ai-titles.test.ts`

Flow: keeps existing titles after a key change, then respects the daily budget for new threads.

- leaves a stored AI title as it is, sharp in privacy mode, with no second call
- titles recent sidebar threads after sync without opening them and respects the daily budget after a key change

## Validation

The full after-run passed 1,795 tests with eight existing skips. Conformance passed 80 tests with 12 existing skips. `pnpm affected` was run once: Bun typechecking and its selected remote tests passed. Lint initially identified three oversized callbacks introduced by the merged flows; named assertion helpers removed those regressions, and the engine typecheck passed again. Lint now fails only because `scripts/remote.mjs` is 401 lines, over the 400-line limit. That file is byte-identical to the base revision and is outside this change. A final remote run of `sync`, `reads`, and `art` passed after extracting the helpers (`20261018T220421-35544-b2f9e0c7/run.log`).
