# M3 code and performance review

Date: 2026-10-13. Scope: `main` at `86ee2ee`. Covers M3: `@juno/sync`, membership from `client.counts`, `topics.list` and `topics.counts`, `topics.subscribe` and `topics.unsubscribe` with the outbox seam, the sidebar (views, containers, state atoms, `ScrollArea`), the e2e driver and specs, and the perf scenario. Reviewed for correctness against real Slack, architecture, renderer state, performance against `docs/performance.md`, tests, and docs.

How I checked:
- Read the code, tests and docs.
- Wrote throwaway probes, kept outside the repo or deleted before this commit:
  - sync scenarios run against the fake;
  - an Effect 4.0.3 probe of the auth error path;
  - a `@juno/state` granularity test;
  - a `check-deps` bypass test on a copy of the repo;
  - an engine breakdown benchmark;
  - two Playwright scenarios for start-up, filter change and memory.
- Ran the engine benchmark (`JUNO_BENCH=1`), the perf scenario (`JUNO_PERF=1 e2e/perf.spec.ts`), `pnpm build` with the bundle check, `pnpm typecheck`, `pnpm lint`, and the unit tests of sync, store, domain, state, engine and fake-slack.
- Other agents shared the machine. The load average ranged from 3 to 37 and is given next to each number. Timings are medians, with the range or p95, from runs taken one at a time.

## Verdict

The structure holds. Views are dumb, Effect 4 is used idiomatically, every unstable module is declared, and most M1 review decisions landed. The per-row atom design works as intended: a one-row delta notifies exactly one row atom.

The problems sit in two places:

1. **Sync correctness against real Slack.** The fake is kinder than Slack. It pages `getView` 50 at a time, sorts search by time, and always sends `thread_ts`. Under those conditions three bugs stay hidden that would put wrong rows in the sidebar on the real workspace: stale follow state, one `getView` page on warm boot and reconnect, and search matches that erase stored files.
2. **The renderer's first render and its re-render scope.**
   - Mounting 300 rows is a single 240–350 ms long animation frame.
   - A filter change goes blank for 1–4 frames and takes 112–479 ms against a 50 ms budget.
   - The React Compiler, which performance.md says is on, is not enabled.
   - Every Slack write re-renders the whole sidebar container.

The engine numbers are close to budget:
- The query takes 4.6 ms in isolation and 9–14 ms p95 inside the engine.
- The snapshot is 346 KB.
- Encode, clone and decode each take under 2 ms. The time budget behind the byte budget holds with room to spare.

## Measured numbers against budgets

Large seed means the fake's `largeSeed()`: 300 channels, 2,000 users, 5,000 topics, 100,000 messages. The Playwright scenarios used the perf spec's 1,200-topic seed, which fills the 300-row window. Start-up times are taken from the main process's `creationTime` in `app.getAppMetrics()`, and the in-page marks are converted with `performance.timeOrigin`.

| Metric | Budget | Measured | Load | Status |
| --- | --- | --- | --- | --- |
| `topics.list` run, isolated (`listTopics` × 40, large seed) | 5 ms | median 4.6–4.9 ms, p95 5.4 ms; the SQL alone is 2.1–2.3 ms | 6–15 | At the limit. Half is JS shaping. |
| `topics.list` `meta.queryMs` inside the engine while events land (bench, 10 injects) | 5 ms p95 | median 8.9 and 10.9 ms, p95 13.0 and 14.2 ms (two runs); median 20.3 ms, p95 29.0 ms at load 22 | 5 / 22 | Over |
| Snapshot, 300 rows | 200 KB | 346 KB with the fake's 43-character photo URLs; 392 KB with 83-character Slack-style URLs | – | Over |
| One-row delta | 32 KB | 1.0 KB | – | OK |
| Encode 300 rows plus JSON, `structuredClone`, decode | 5 ms each side | 1.3–1.9 ms, 1.5 ms, 0.9–1.1 ms | 6–15 | OK |
| Inject to row, engine harness | part of 50 ms | median 20–21 ms; 30 ms at load 22 | 5 / 22 | OK |
| Live update, write to pixels (`juno.live-update`) | 50 ms | median 5.3 ms, p95 25.6 ms (n=9, default fake) | 4 | OK |
| Row hover to next presented frame | 1 frame | median 4.6 ms, p95 11.5 ms on a 60 Hz panel (n=9) | 4 | OK |
| Shell painted | 400 ms p50 | cold 454 ms, warm 431 ms (n=5 each) | 6 | About 40 ms over. Includes Playwright's inspector. |
| Cold start to sidebar rows (V8 code cache deleted, cache warm, 1,200 topics) | 800 ms p50 | 683 ms (635–726) | 6 | OK |
| Warm start to sidebar rows | 500 ms p50 | 675 ms (611–741) | 6 | Over |
| Engine sends first rows → rows painted | – | 186–201 ms. One long frame of 240–350 ms (170–270 ms blocking) ends at the rows paint. | 6 | The main cost |
| Renderer script start to rows | – | 238–376 ms (1,200 topics); 99 ms median on the default fake | 4–6 | – |
| Filter change (Channels, DMs, All) | 50 ms, old rows stay | 112–479 ms; 1–4 frames with zero rows when switching to Channels or DMs | 3–13 | Over, and blank |
| Sidebar scroll at about 2,000 px/s, 300 rows | p95 main-thread work ≤ 8.3 ms; no LoAF; < 1 % dropped | rAF interval p95 18.2 ms on a 60 Hz panel; 1–2 of 420 frames over 25 ms (0.2–0.5 %); no LoAF | 4 | OK. Main-thread work per frame was not measured. |
| Renderer memory after sync and two scroll passes | 250 MB private, heap 120 MB | footprint 134–136 MB, JS heap 17 MB, 12,423 DOM nodes | 4–6 | OK (not the full soak) |
| Engine memory | 300 MB | footprint 101–111 MB | 4–6 | OK |
| Main memory | 80 MB | footprint 87–88 MB under Playwright | 4–6 | Borderline. Recheck without the inspector. |
| Renderer bundle | JS ≤ 1.0 MB, CSS ≤ 150 KB | JS 594 KB (187 KB gzip), CSS 84.5 KB | – | OK. performance.md still says 426 KB and 69 KB. |
| Engine boot on the large seed | – | 5–6 s at load 5; 145 s at load 22; 379 API calls | 5 / 22 | – |

Not measured: one socket event transaction (5 ms), the longest synchronous block after boot (50 ms), topic open (M4), and the memory soak (needs M4).

Cold and warm start are the same within noise. The V8 code cache is written (`Code Cache/js` has 4 entries) but does not change anything measurable at this bundle size.

## Findings, ranked by impact

### 1. Follow state goes stale, and nothing corrects it

- **Where:**
  - `packages/sync/src/boot.ts:150` (`setThreadSub(..., root.subscribed ?? true, ...)`) and `packages/sync/src/events.ts:83` are the only sync writers of `thread_subs`.
  - The pages ignore the `subscribed` field that history and replies roots carry (research section 3; schema `slack-schema/src/message.ts:148`).
  - `getView` lists only followed threads, so sync never writes `subscribed = 0`.
- **Failure:**
  - Unfollow a thread in Slack while Juno is closed. After the warm boot, `thread_subs.subscribed` is still 1 and the row stays in the sidebar for good. Reproduced against the fake.
  - A second case: a `getView` page is in flight (the 10-minute sweep, or about 20 s of cold-boot paging). The user clicks Unsubscribe and the `thread_unsubscribed` echo lands. Then the older page applies `subscribed ?? true` and brings the follow back.
- **Fix (`sync/src/pages.ts`, `sync/src/write.ts`, `sync/src/boot.ts`, a store migration):**
  - Take `subscribed` from any root that carries it. `true` sets the flag. `false` clears a stored 1. A missing field leaves it alone.
  - Store `updated_event_ts` on `thread_subs`, and skip a `getView` row whose request started before the last event or command write to that thread. `getView` marks already use this guard.

### 2. Warm boot and reconnect fetch one `getView` page, and Slack caps a page at 10

- **Where:** `packages/sync/src/boot.ts:322` calls `loadThreadViews(ctx, start, false)`, which stops after the first page (`:178`). Real Slack returns 10 threads per page whatever `limit` says (backlog; 32 calls on the real workspace). The fake honours `limit: 50`, so the tests never see this.
- **Failure:**
  - The user reads 20 followed threads on their phone overnight. Juno refreshes the 10 most recent and shows the other 10 as unread until each gets new activity.
  - Threads followed on another device while Juno was offline do not appear.
  - Cold boot also stops at the window, so a followed thread older than 7 days has no `thread_subs` row. When it gets a live reply, `subscribed` is NULL and the row stays hidden.
- **Fix (`sync/src/boot.ts`, `sync/src/pages.ts`, `fake-slack`):**
  - Page `getView` until a page's oldest `latest_reply` is older than `previous.lastSyncAt` on reconnect, and older than the window on warm boot.
  - Apply `subscribed` and `last_read` from the root that the stub fetch returns (`sync.ts:132`), so an old followed thread shows as soon as it gets a reply.
  - Make the fake cap `getView` at 10 per page.

### 3. A search match overwrites stored message content

- **Where:** `packages/sync/src/merge.ts:131-135`. For an unedited stored row, `fresh` replaces it wholesale. Search matches carry no files or attachments, and live they may carry no blocks.
- **Failure:** reproduced against the fake. Post a reply with a file, force a reconnect, and the discovery sweep sets `files_json` to `null`. A unit probe shows the same for `blocks_json`. In M4 the file disappears from the thread until the topic is reopened.
- **Fix (`sync/src/merge.ts`, `sync/src/discovery.ts`):** add a `partial` merge source for search. It fills only missing fields: content when the stored row is a stub, counters, and `thread_ts`.

### 4. An expired session found by catch-up or the sweep is swallowed

- **Where:** `packages/sync/src/sync.ts:70-71` and `:102-103`. `Effect.catchTag('SlackAuthRequired', e => Effect.fail(e))` is followed by `Effect.catch(...)`, which catches the re-raised error too. Both effects also run under `Effect.forkScoped` (`:78`, `:83`), so a failure never reaches `runSync`.
- **Failure:** verified with a probe on effect 4.0.3, where the exit is `Success`. When a token expires, a catch-up or the 10-minute sweep logs a warning and the status stays `live` or `offline`. It never shows `session-expired`; only the socket's own auth failure ends the session. The sync README says it "fails only with `SlackAuthRequired`".
- **Fix (`sync/src/sync.ts`, `engine/src/session/SyncRunner.ts`):**
  - Use `Effect.catchIf(e => e._tag !== 'SlackAuthRequired', ...)`.
  - Run the forks in a `FiberSet<void, SlackAuthRequired>` that is joined in the `Effect.all` at `:145`.
  - Type the runner's fiber as `Fiber<never, SlackAuthRequired>` and drop the hand-written guard.
  - Add an engine test: expire the session at the fake, force a reconnect, and expect `session-expired`.

### 5. A filter change goes blank and takes 112–479 ms

- **Where:** `apps/desktop/src/renderer/containers/Sidebar.tsx:41-51`, `containers/TopicList.tsx:66-67`, `packages/state/src/sidebar.ts:62-74`.
  - `useAtomValue` is `useSyncExternalStore`, and React applies its updates synchronously even inside `startTransition`.
  - The new filter's atom starts as `Initial`, and `sidebarSectionsAtom` turns that into empty sections.
- **Measured** on the 1,200-topic seed:
  - Switching to Channels or DMs rendered 1–4 frames with zero rows.
  - `juno.filter` took 112–479 ms against the 50 ms budget.
  - The `juno.filter` measure stops at the ready list, so it cannot see the blank frames.
- **Fix:**
  - `state/src/sidebar.ts`: add a `sidebarListAtom` that keeps the previous window while the new one is `Initial`. Rows read `rowAtom(sidebarListAtom)`.
  - In the `Sidebar` container, after the first paint, keep the `Channels` and `DMs` subscriptions mounted on idle. Each costs one 5 ms query, and switching becomes a cache hit.
  - Add a filter scenario to `perf.spec.ts` that fails on any frame with zero rows.
  - Add a note to performance.md 5.3: atom state needs "hold the previous value"; a transition does not do it.

### 6. Mounting 300 rows is one 240–350 ms frame

- **Where:** `apps/desktop/src/renderer/containers/TopicList.tsx` renders the whole window in one commit.
- **Measured:**
  - Engine first snapshot to rows painted: 186–201 ms.
  - A LoAF observer on four relaunches shows one frame of 236–353 ms (172–266 ms blocking, 20–39 ms of style and layout) ending at the rows paint. That is 0.6–0.9 ms of main-thread work per row.
  - 41 DOM nodes per row, 12,423 nodes in total.
  - This frame is most of the warm start overrun (675 ms against 500 ms) and most of the filter time.
- **Fix:**
  - The container commits the first 40 ids, then the rest in a `startTransition` scheduled after the first paint. Rows stay in flow, so `content-visibility` and anchoring are unchanged.
  - Enable the compiler (finding 7).
  - Profile one `TopicRow` mount: performance.md 5.4 says a row over 1 ms is split. Likely candidates are the `AvatarStack` images and the Phosphor SVGs.
  - Target: rows painted under 60 ms after the snapshot arrives.

### 7. The React Compiler is not enabled, and every Slack write re-renders the whole sidebar

- **Where:**
  - `apps/desktop/electron.vite.config.ts:88` and `apps/gallery/vite.config.ts:39` are plain `react()`, and no package depends on `babel-plugin-react-compiler`. performance.md 5.4 says the compiler is on.
  - `topics.counts` re-runs on every `topics` invalidation, and `serveLiveValue` (`engine/src/protocol/live.ts:58-79`) sends equal values again.
  - The `Sidebar` container reads the whole counts value (`Sidebar.tsx:22,59-62`), so `SidebarView` re-renders and creates a new `<TopicList />`. That renders `TopicListView` again with 300 `Row` elements, 300 memo checks and two O(n) `includes` scans.
  - The selection does the same: `TopicList` reads `selectedTopicAtom` (`TopicList.tsx:68`) only to choose the tabbable row.
- **Cost:** each incoming message costs one row render plus a full container pass. Each pointerdown pays the same pass inside the 16 ms press budget.
- **Fix:**
  - Enable the compiler in both configs, then rerun the bundle check and the scroll and filter scenarios.
  - Read the counts through a selector that returns a primitive.
  - Wrap `TopicList` in `memo`.
  - Move "which row is tabbable" into a `currentRowAtom(list)` that each row reads with a boolean selector.
  - In `serveLiveValue`, skip a run whose value equals the last one.

### 8. The sidebar query is over budget inside the engine, and half of it is JavaScript

- **Where:** `packages/engine/src/topics/query.ts:226-327`. Every run re-parses `participants_json` and `preview_json`, builds a domain `Topic`, runs the rules, shapes 300 rows and hashes a long string for each `rev`, even when one row changed.
- **Measured:**
  - Isolated: 4.6 ms, of which SQL is 2.2 ms.
  - Inside the engine: p95 13–14 ms at load 5. `timed()` also counts time spent waiting on other fibers.
  - The per-subscription minute tick (`topics/handlers.ts:53-55`) calls a global `invalidate(['topics'])`. With N filter atoms alive under the 30 s TTL, that is N × (N + 1) topics query runs a minute, counts included.
- **Fix (`topics/query.ts`, `topics/handlers.ts`, `protocol/live.ts`):**
  - Keep a per-subscription `Map<topicId, { key, row }>`, where `key` is the joined inputs string that `rev` already hashes. Reuse the shaped row when the key is unchanged. Target ≤ 2.5 ms in isolation.
  - Replace the global tick with a `Stream.tick('1 minute')` merged into that subscription's runs only.
  - `serveLiveList`: skip a message with no upserts, no removals, the same order and no error.
  - The bench reports the isolated time next to `meta.queryMs`, so load and interleaving can be told apart.

### 9. The snapshot is 346 KB; the "people ids" idea alone does not reach 200 KB

Measured on the large seed (bytes of the encoded JSON):

| Shape | Rows | Side tables | Total | `structuredClone` |
| --- | --- | --- | --- | --- |
| Today | 346 KB | – | 346 KB (392 KB with Slack-length photo URLs) | 1.5 ms |
| Drop `preview.line` | 321 KB | – | 321 KB | – |
| People as ids plus a separate people value (backlog idea) | 234 KB | 70 KB (660 people) | 305 KB | – |
| People ids, no `preview.line` | 210 KB | 70 KB | 280 KB | – |
| Rows carry `channelId` and `participantIds`; channels and people as side tables | 176 KB | 22 KB channels (173), 85 KB people with Slack-length URLs | 283 KB | 1.1 ms |

What the bytes are made of:
- JSON keys: 132 KB, or 38 %.
- `participants`: 121 KB, an average of 3.7 people per row.
- `channel`: 41 KB.
- `preview`: 53 KB, of which `line` is 22.5 KB and only repeats `sender` and `text`.

Evaluation of "rows carry person ids plus a separate `people` live value":
- **It does not meet the budget by itself.** The rows still weigh 210–234 KB.
- **A second live value races the first.** A row can arrive before the person it names, so every row needs a fallback, and a person change has to be joined across two atoms.
- **The gain is real but small.** Clone time falls from 1.5 ms to 1.1 ms. One person's new photo would no longer change the `rev` of every row they are on (today `rev` hashes names and photo URLs, `query.ts:322-341`).
- **M4 needs the same thing anyway.** A 500-message window repeats the sender's name and photo on every message, so the topic view has the same problem with more rows.

Recommendation:
- Do not add a separate `people` live value in M3.
- In M4, add optional side tables to `ListDelta` itself (`refs: { people, channels }`, upserted with the rows in one message), so they arrive atomically with the rows. Use it for `topics.list` and the message window. Rows carry ids, and `@juno/state` keeps one `Map<id, Person>`.
- Now: drop `preview.line` (the view joins `sender` and `text`). Restate the size budget in performance.md section 1 as "rows ≤ 200 KB, side tables counted separately, encode and decode ≤ 5 ms measured in the bench". The time budget the size stands in for holds today with three times the headroom.

### 10. More sync bugs that show wrong data (medium)

Each was verified by reading the code end to end, unless marked plausible.

- **Coverage outlives a socket gap.**
  - **Where:** `reindex.ts:163` trusts `replies_complete = 1` after `reply_count` has grown, and `complete_from` (`write.ts:264`) is never reset on disconnect.
  - **Failure:** after a drop that the search sweep missed, a row shows "0, exact" while Slack has one unread.
  - **Fix:** use `complete = storedReplies >= replyCount`. Record a coverage epoch on `Disconnected`.
- **`client.counts` is stamped with the response time.**
  - **Where:** `boot.ts:104`.
  - **Failure:** a `channel_marked` event that arrives while counts is in flight is overwritten by the older pointer.
  - **Fix:** take the time before the call, as `getView` does (`boot.ts:165`).
- **The "start new threads as read" flag leaks.**
  - **Where:** `boot.ts:270-279`. `ctx.seedNewThreadsAsRead` is shared mutable state, and `fetchRoots` (`sync.ts:139`) applies pages concurrently. The flag also stays true through the 30 s retry when cold boot fails.
  - **Failure:** a mention that arrives during the roughly 7-minute live cold boot is seeded as read.
  - **Fix:** pass the flag as an argument to `applyPage` from the history loop only.
- **Subscribe can mark a thread read in Slack.**
  - **Where:** `engine/src/topics/commands.ts:84` sends `last_read = latest_reply` when Juno has no pointer.
  - **Fix:** send the root `ts`, or the `ts` before the first stored unread reply.
- **Revert restores a snapshot, not its own change.**
  - **Where:** `commands.ts:60`.
  - **Failure:** subscribe A is in flight, undo B snapshots `subscribed = 1`, A fails and clears the flag, then B fails and restores 1. The thread ends up followed in Juno but not in Slack. A timeout after Slack already applied the change has the same result.
  - **Fix:** compare and swap on revert, and serialise commands per thread.
- **Conversations joined during a drop stay hidden until restart.**
  - **Where:** on reconnect, counts call `setMembership` (`write.ts:156`), which ignores ids that have no `conversations` row.
  - **Fix:** fetch metadata for unknown counts ids before calling it.
- **Cold boot cannot resume.**
  - **Where:** any non-auth failure restarts all history calls (about 150 calls, 7 minutes live).
  - **Fix:** skip conversations whose `synced_ranges` already cover `[start, latest]`.
- **Main is missing for channels whose only activity is replies under an old, unfollowed root.**
  - **Where:** cold boot fetches only the window, and `discoverSince` does not run at cold boot.
  - **Fix:** run it at the end of cold boot.
- **Search discovery may sample by relevance (plausible).**
  - **Where:** `discovery.ts:59` sends no `sort`, so `reachedSince` and the 150-match cap act on an arbitrary sample.
  - **Fix:** send `sort: 'timestamp', sort_dir: 'desc'`. Take `thread_ts` from the permalink when it is missing, and drop matches that still have no thread information. Confirm in the live smoke.

### 11. A query error kills the sidebar subscription

- **Where:** `packages/engine/src/topics/handlers.ts:72,76` pipe the queries through `Effect.orDie`.
  - The store's `liveQuery` emits an expected error as a value but fails the stream on a defect (`store/src/invalidation.ts:166-176`).
  - The renderer retries only `RpcClientError` (`state/src/atoms.ts:66-72`).
- **Failure:** any `SqlError`, such as a migration mismatch or a busy reader, turns the sidebar atom into a permanent failure until the atom is remounted. This defeats the "re-emit the last value with `meta.error`" rule that `serveLiveList` implements.
- **Fix:**
  - Drop `orDie` and type the query as `Effect<A, SqlError, StoreServices>`. That also removes the `as Effect<..., never, never>` casts at `:73,77`, which hide the `StoreReader` requirement.
  - Add a `live.test.ts` case where one run fails and the next succeeds.

### 12. An engine restart re-renders every row and can show "It's quiet"

- **Where:**
  - `packages/state/src/list.ts:27-31`: on a `reset`, `applyListDelta` looks rows up in a new, empty `Map`, so every row gets a new object even when its `rev` is unchanged. This was shown with a state test: 300 notifications.
  - `engine/src/topics/handlers.ts:41-45`: the engine serves `{ rows: [] }` while no workspace is open. If the renderer's 1 s retry wins that race, `ready` becomes true with zero rows and the empty state plays before the rows come back.
- **Fix:**
  - On reset, keep the old object when `previous.rows.get(id)?.rev === row.rev`.
  - Emit nothing while no workspace is open.

### 13. `check-deps` misses the edges that matter, and one is already in the code

- **Where:** `scripts/check-deps.mjs`. On a copy of the repo, these imports all passed check-deps, and the package typecheck accepted them:
  - a relative import out of the package (`views` → `../../state/src/client`);
  - an engine feature importing `@juno/engine` by name;
  - `node:fs` in `ui`;
  - a value import of a contract Schema in `views`;
  - a template-literal dynamic import.
- `scripts/` is not scanned at all.
- **Already in the code:** `engine/src/topics/commands.ts:28` → `engine/src/outbox.ts:20` → `session/Session.ts`. The topics feature depends on the session feature through a top-level module, which architecture section 3 forbids.
- **Fix:**
  - Resolve relative specifiers, and fail when one leaves the package.
  - Fail on an engine self-import by package name.
  - Fail when a non-composition top-level engine module imports a feature folder.
  - Ban Node built-ins in `ui`, `domain` and `richtext`.
  - Allow only `import type` from `@juno/contract` in `views`.
  - Scan `scripts/`.
  - Move `Outbox` behind a small top-level `SessionClient` service, so `topics` stops reaching into `session`.

### 14. The mention branches of the sidebar rule are never tested against the real query

- **Where:**
  - The rule exists twice: as SQL (`engine/src/topics/query.ts:142`, also used by counts at `:200`) and in `domain/src/status.ts:108`. Only the domain copy has tests.
  - `apps/desktop/e2e/sidebar.spec.ts:1-6,38-87` checks only rows that both the old and the new rule show, and never checks that a row is absent.
- **Failure:** changing `s.subscribed IS NULL` to `COALESCE(s.subscribed, 0) = 0` would show explicitly unfollowed mention threads, and no test would fail. The `flags` fixture (`views/src/fixtures/topics.ts:202`) still says "Unsubscribed but shown because it mentions you", which contradicts the decision.
- **Fix:**
  - New `engine/test/sidebar-rule.test.ts` covering three cases:
    - a mention in a thread Slack said nothing about shows, and counts go up;
    - a mention after an explicit unfollow stays hidden;
    - `listTopics` and `countsStatement` agree with `sidebarPlacement` over the domain status table.
  - `sidebar.spec.ts` asserts that the two rows the new rule hides are absent (new verb `row.expectAbsent()`).
  - Fix the fixture text.

### 15. Engine tests and the benchmark time out under load

- **Where:**
  - `engine/vitest.config.ts:13` sets a 30 s test timeout, but `sync.test.ts:21` waits up to 30 s for `live` inside it.
  - Every sync test cold-boots its own engine, and test files run in parallel.
  - The harness waits 10 s for `session ready` (`engine/test/harness.ts:186-193`).
  - `fake-slack/test/large-seed.test.ts:33,42` builds the full seed twice under a 60 s limit, which still works as a wall-clock assertion after `86ee2ee` removed the explicit one.
- **Measured:**
  - At load about 22, engine tests failed 6 of 39 and fake-slack 1 of 37. All were timeouts, none were wrong values.
  - The benchmark failed 2 of 3 runs at load 33–37, waiting for `session ready`.
- **Fix:**
  - Engine config: `fileParallelism: false` and a `testTimeout` of 90 s.
  - Inner waits take at most half of the test budget.
  - Share one booted engine in `beforeAll` across the read-only boot tests.
  - The large-seed test checks determinism on a small seed.

### 16. Smaller correctness items

- **The sign-out test writes junk over a live database** (`engine/test/session.test.ts:196-198`). Since M3 the workspace store is open by then. Wait for `live`, sign out, then assert that `cache.db` is gone and `user.db` remains.
- **Archived channels stay in the sidebar** (`query.ts:163` does not filter `is_archived`). Add `AND c.is_archived = 0`.
- **`channel_rename` and `group_rename` carry partial objects.** The upsert (`events.ts:122`) turns private channels into public and clears the topic, the purpose and `is_archived`. Patch only `name`.
- **Unknown users (`B…` bots, Slack Connect users in `failed_ids`) are fetched again every 10 minutes forever** (`users.ts`). Keep a negative cache.
- **User-group mentions never count** (`sync.ts:46`; `ctx.me` has no user-group ids).
- **Grid:** the workspace directory is keyed by `enterprise_id` (`engine/src/session/Session.ts:137`), so two teams in one org would share `cache.db` and `sync_state`. Key it by `enterprise:team`. This is low priority because the owner is not on Grid.
- **`nowAtom` is `keepAlive`, ticks every 30 s and is read by every `Row`** (`state/src/sidebar.ts:24-36`, `TopicList.tsx:53`). All 300 row containers re-render every 30 s, and labels can lag by up to 30 s. Read it with a selector that returns the label (`useAtomValue(nowAtom, now => relativeTime(...))`), align the tick to the minute, and drop `keepAlive`.
- **`prefetch` does not cap warm subscriptions at 3** (`state/src/atoms.ts:172-195`). Evicted entries still sit under their 30 s TTL, so 10 hovers keep 10 queries alive. This matters in M4, when `warm()` is wired. Use one warm set with a cap of 3 and an exemption for the active tab.
- **One shared command atom per route.** `command(route)` is a single non-concurrent `runtime.fn`, so a second write interrupts the first (state test: of two writes only the second completes). Per-row actions in M5 must use `runCommand`; say so in the state README.
- **`performance.measure` entries grow without limit** (`state/src/atoms.ts:81-83`), one for every live message. Clear `juno.live-update` after recording unless the harness asks to keep them.
- **`ScrollArea` has no `scrollbar-gutter: stable`** (`ui/src/ScrollArea.tsx:42-56`). A filter that leaves less than a screen of rows moves every row's right edge by the 10 px gutter. The hover rule toggles an inherited custom property, so every descendant is restyled on enter. Put the rule on the scrollbar pseudo-element instead.
- **`activateHandlers` differs from performance.md 4.1** (`ui/src/internal/activate.ts:38,53-70`): there is no `isPrimary` check and no `[data-no-activate]`, and Enter auto-repeat is not ignored, so holding Enter in M4 navigates repeatedly.
- **The nested `rowAtom` family** (`state/src/atoms.ts:128-134`) is held only through the outer family's `WeakRef`, so after GC a row can get a new atom. Keep the inner families in a `WeakMap`.

## Tests

The unit runs (`sync` 7, `store` 19, `domain` 173 and `state` 2) pass. The engine and fake-slack failures are covered in finding 15.

Missing coverage, in order of risk:

1. The sidebar rule mention branches (finding 14).
2. Unsubscribe revert. Only the subscribe revert is tested, and it reads `thread_subs` directly (`sync.test.ts:397-400`) next to a behaviour check that already covers the same thing.
3. Reconnect catch-up.
   - `convergence.test.ts:72` takes the `!connected` branch before the edit, delete, reaction and read-mark branches (`:76-92`), so none of them happen during a drop.
   - Add a reconnect test: while offline, mark #eng read, reply in a followed thread, unfollow one thread and post in a Main. After `live`, assert the rows and a reconnect call budget.
4. Socket events interleaved with in-flight history pages. The fake cannot hold a response. Add `fake.holdNext({ method })`, then hold `conversations.history` during cold boot, inject an edit, a reaction and a reply, and release.
5. The call budget test is loose. `sync.test.ts:145` passes with zero calls, and `:152` allows 9 extra calls. Assert an exact per-method map.
6. Archive, unarchive, `channel_deleted`, a self `member_left_channel` and `im_close` (`sync/src/events.ts:105-163`) are untested. Use one table-driven test with `fake.emitFrame`.

Brittleness:

- **A timing budget inside a functional test.** `sidebar.spec.ts:163` asserts `juno.live-update < 80`. `juno.measure` (`driver/juno.ts:330`) reads the last entry of any route, so it may read the counts or engine-status entry. Move the check to `perf.spec.ts`, or filter by route and report the number only.
- **"Engine live" is awaited with the default 5 s** in `engine.spec.ts:8,14,41,65` and `session.spec.ts:32`, while `waitForSync` allows 30 s. Add `juno.expectEngineLive()`.
- **Other wall-clock asserts:** `slack/test/api.test.ts:82` (under 2 s) and `ai/test/pi.test.ts:68` (under 1 s).
- **Leaked temp directories:** `session.test.ts:112` and `sync.test.ts:261-263` leave theirs behind. `session.test.ts:23-110` copies the harness.

Driver and accessibility:

- The driver reaches into the DOM in several places:
  - `[id]` and `nth(1)` (`driver/juno.ts:62,67`);
  - `[title="N unread"]` and font-weight checks (`:76-98`);
  - `[data-topic-row]` and `aria-labelledby` lookups (`:116,130`);
  - `resolveButton.locator('..')` (`sidebar.spec.ts:173`);
  - `tabindex` attributes (`:255-256`);
  - computed styles of `::-webkit-scrollbar-thumb` (`:204`).
- `TopicRow.tsx:131-139` exposes the unread count and the mention only through `title`, so screen readers never hear them and the driver cannot use roles. Give the count accessible text.
- Add a `slack.as(name).replyIn(title, text)` side (architecture 13), and the verbs `sidebar.clearFilters()`, `row.expectAbsent()` and `sidebar.expectScrollbar(shown)`.
- `SidebarRow` queries the whole window (`juno.ts:24`). Scope it to the sidebar before M4 adds a topic view.
- The layout-shift guard covers hover and focus, but not a live update or a photo arriving. Photos cannot load in e2e because the CSP `img-src` (`electron.vite.config.ts:23`) excludes the fake's origin. Allow it under `JUNO_E2E`.

The perf scenario:

- **Warm start runs on the default fake**, where renderer start to rows is 99 ms, while the budget is for a large workspace (238–376 ms on 1,200 topics).
- **The scroll pass measures rAF intervals, not main-thread work per frame**, and does not check the 2 px thumb rule (performance.md 8).
- **No filter or start-up scenario.** Add a filter scenario that fails on a blank frame, and a start-up scenario that reports main creation → shell → rows plus the LoAF before the rows. Both are scripted in this review's probes.

## Docs and dead code

Docs that disagree with the code:

- **`docs/architecture.md`**
  - Line 7 still says the sidebar shows "every thread with recent activity".
  - The M3 paragraph (line 502) ends "Open for the UI track…". The UI shipped self-contained rows, and Browse and scope are not built (`containers/Sidebar.tsx:97` TODO; the scope chip hard-codes `kind: 'public'` at `:71`).
  - Section 7 and `state/README.md`:
    - They say `prefetch(atom)`; the code takes `prefetch(registry, atom)`.
    - They say the list subscribes to `orderAtom`; the code uses `sidebarSectionsAtom`.
    - They omit the `failed` connection state.
  - Section 8 says a view that needs the time takes `now`, and the performance skill says time is a leaf reading `nowAtom`. The code does a third thing. Pick one, then fix the other doc and the code (finding 16).
- **`docs/performance.md`**
  - Section 5.4 claims the compiler is on.
  - Section 1 gives 426 KB / 69 KB for the bundle.
  - Section 4.1 names `[data-no-activate]`.
  - Section 7.3 does not mention `perf.spec.ts` or `screens.spec.ts`.
  - The section 1 size budget needs the restatement from finding 9.
- **READMEs**
  - `contract/README.md` says "`EngineRoutes` today".
  - `views/README.md` says `hueFor` and `initials` are repeated from domain. They are not.
  - The sync README claims an auth failure always surfaces (finding 4).
- **`docs/backlog.md`** has five duplicate pairs: snapshot size, edits during a drop, search discovery, and the two AI items. Its query numbers are older than this review's.

Values declared twice:

- **`relativeTime`:** `views/src/time.ts` is a byte-for-byte copy of `domain/src/time.ts`. Give desktop a `domain` edge (domain is pure) and delete the copy.
- **`SIDEBAR_WINDOW`:** in `engine/src/topics/handlers.ts:25` and `state/src/topics.ts:22`. Move it to contract.
- **Vocabulary:** `contract/src/routes/topics.ts:18-35` redeclares `TopicKind`, `ConversationKind`, `ContextTint`, `TopicStatus` and `RowTag`, which domain owns. M1 made domain the one owner of `ConversationKind`. Re-export them.
- **The quiet window has three owners:**
  - `SyncConfig.quietDays` sets the boot window;
  - the `prefs` key sets the sidebar;
  - `TopicList`'s default prop is never passed.

  Once the pref exists, boot fetches 7 days while the sidebar shows 14. Have `SyncRunner` read the pref.
- **Icon names:** domain emits Lucide names (`domain/src/channel-style.ts:10`, contract comment `topics.ts:59`), and `views/src/look.ts:12-37` translates them to Phosphor. Unknown names silently become a letter. Have domain emit ui's keys, typed as `Schema.Literals`.

Dead code, checked by grepping packages, apps and scripts:

- **`@juno/state`:** `subscribeTopicCommand`, `unsubscribeTopicCommand`, `commandAtomFor` and `orderAtom`.
- **`@juno/engine`'s index:** `countTopics`, `serveLiveList`, `serveLiveValue` and `timed`.
- **`@juno/sync`'s index:** `bootState`, `BOOT_KEY`, `isTombstone` and `topicOfMessage`.
- **`SyncRunner.ts:49`** provides `syncConfigLayer()`, which is already the `Context.Reference` default.
- **`apps/desktop`** may not need its `@stylexjs/stylex` dependency. Check the plugin first.
- **`docs/design/channel-marks/`** (about 6 MB of PNGs) is referenced nowhere. Ask whether it should stay.

## Cleared

- **Views stay dumb.** `views` and `ui` import no state, Effect, Electron or `window.juno`.
- **Hover, focus and the Resolve slot are CSS only.** Rows set `contain: content` and `content-visibility: auto`, nothing uses `will-change`, and nothing uses `cursor: pointer`.
- **Effect 4 idioms.** There is no `catchAll`, `Context.Tag`, `Effect.Service`, `Layer.scoped` or `Effect.fork`. Services use `Context.Service`, and `SyncConfig` is a `Context.Reference`. Every unstable import is in the check-deps list and in the skill.
- **M1 decisions.** These landed:
  - `liveValueRoute` and `liveListRoute`;
  - `serveLiveValue` and `serveLiveList` over the store's `liveQuery(keys, timed(query))`;
  - memoized atoms;
  - typed errors, with retry only for `RpcClientError`;
  - `runCommand` and per-registry `prefetch`;
  - encode measuring in dev and e2e only;
  - Slack errors mapped at the edge.
- **The delta cache keeps row and order identity.** A one-row delta notifies one row atom and no section atoms. Only upserted rows are decoded.
- **The merge rules hold for the cases the fake can produce:**
  - tombstones win;
  - the edit and reaction guards hold;
  - duplicate events are idempotent;
  - `message_replied` arriving in either order is handled;
  - stubs fill from the next page;
  - broadcasts are indexed in both places;
  - `getView` and `thread_marked` go through the read conflict rule.
- **Membership.** Full counts replace membership, `im_close` keeps the DM, and topics of channels the user left are hidden everywhere.
- **Subscribe and unsubscribe.** A double click sends no second call. Reverting a first subscribe deletes the row.
- **Boot and work lanes.** Boot, catch-up and the sweep share one permit, and events never wait for it.
- **Isolation in tests.** Each test has its own fake on port 0 and its own user-data directory, and the fake has no module state.

## Work packages

Each package owns its files. Where one package depends on another, the order is stated.

### A. Sync correctness against real Slack

Owns:
- `packages/sync/**`
- `packages/store/**`, for the `thread_subs.updated_event_ts` migration
- `packages/fake-slack/**`
- `packages/engine/src/session/**`
- `packages/engine/src/topics/commands.ts`
- `packages/engine/src/outbox.ts`
- `packages/engine/test/sync.test.ts`
- `packages/engine/test/convergence.test.ts`
- a new `packages/engine/test/reconnect.test.ts`

Do, in order:
1. Make the fake behave like Slack: `getView` capped at 10 per page, search honouring `sort`, incremental counts honouring `counts_last_fetched`, a self-reply sending `thread_subscribed`, and `holdNext({ method })`. Some existing tests will start failing; that is the point.
2. Findings 1, 2, 3 and 4.
3. Finding 10: coverage, the counts stamp, the seeding flag, the subscribe `last_read`, compare-and-swap revert, unknown conversations, resumable cold boot, Main via `discoverSince`, and search `sort`.
4. Finding 16's sync items: renames, the unknown-user cache, user groups, the Grid key.
5. Move `Outbox` behind a top-level `SessionClient`.
6. `SyncRunner` reads the quiet-days pref.
7. Remove the dead sync exports.
8. Tests: unsubscribe revert, reconnect with a call budget, interleaving, an exact call budget, membership events, and making the large-seed test small.

### B. Engine query, protocol and renderer state

Owns:
- `packages/engine/src/topics/query.ts`, `topics/handlers.ts` and `protocol/**`
- `packages/engine/src/index.ts`
- `packages/engine/test/{harness.ts,live.test.ts,plan.test.ts,session.test.ts,bench/**}`
- `packages/engine/vitest.config.ts`
- a new `packages/engine/test/sidebar-rule.test.ts`
- `packages/contract/**`
- `packages/domain/**`
- `packages/state/**`

Do:
- Findings 8, 11 and 12.
- `serveLiveValue` equality, and skipping no-op list messages.
- Hold the previous window (`sidebarListAtom`), plus `currentRowAtom` and the counts selector shape that package C consumes.
- Finding 16's state items: the `nowAtom` tick, the prefetch warm set, clearing measures, the inner `rowAtom` families.
- Archived channels filtered in the query.
- `SIDEBAR_WINDOW` and the vocabulary moved to contract and domain; domain emits ui icon keys.
- Drop `preview.line` from `TopicRow`, together with package C's view change.
- Finding 14's engine test.
- The engine test timeouts (finding 15) and the sign-out test fix.
- The bench reports isolated query time and clone and decode times.
- Remove the dead engine and state exports.

### C. Renderer, views and the perf scenarios

Owns:
- `apps/desktop/**`, including e2e and the vite config
- `apps/gallery/vite.config.ts`
- `packages/views/**`
- `packages/ui/**`
- `packages/testing/**`

Do:
- Enable the React Compiler (finding 7).
- Mount the sidebar progressively (finding 6). Target: rows painted ≤ 60 ms after the snapshot.
- Memoize `TopicList`. Use B's `sidebarListAtom`, `currentRowAtom` and counts selector. Keep the Channels and DMs subscriptions warm after the first paint (finding 5).
- Row time through a selector.
- `scrollbar-gutter` and the pseudo-element hover rule in `ScrollArea`.
- The `activateHandlers` fixes.
- `relativeTime` from domain; delete `views/src/time.ts` and the `look.ts` tables once B has landed.
- Accessible text for the unread count.
- Test the view with `sender` and `text` only.
- Fix the `flags` fixture.
- Driver verbs and the `slack.as(...)` side. `expectEngineLive`. Move the timing assertion out of `sidebar.spec.ts`. Add the absent-row checks and the warm-start e2e. Allow photos under `JUNO_E2E` and guard them against layout shift.
- `perf.spec.ts` gains the filter and start-up scenarios, runs warm start on the 1,200-topic seed, and reads memory.

Depends on B for the new atoms; land B's state changes first.

### D. Guardrails and docs

Owns:
- `scripts/check-deps.mjs`
- `docs/**`, except this review
- every `README.md`
- `packages/slack/test/api.test.ts`
- `packages/ai/test/pi.test.ts`

Do:
- The check-deps rules from finding 13. Allow the `outbox.ts` edge until package A removes it, then delete the exception.
- Add `desktop → domain` to the graph.
- Every doc fix listed under "Docs and dead code". The compiler line in performance.md follows what package C ships.
- Restate the size budget (finding 9).
- Deduplicate the backlog and record these numbers.
- Ask about `docs/design/channel-marks/`.
- Replace the two wall-clock asserts.
