# Correctness review, batch-3 (2026-10-17)

Scope: the local branch `batch-3`, which merges about 20 branches built on 2026-10-16, diffed per merge against `origin/main`. This review went deepest on send-once, meta-fence and the connection auto-review. Every test below ran against the fake Slack server only.

Failing tests added on `code-review-1017`:

| Commit | Test | Proves |
| --- | --- | --- |
| `de54c4fb` | `packages/engine/test/send.test.ts`, "send: a copy whose delete waits" (2 tests) | S1, S2 |
| `4fe8d1de` | `packages/agent/test/auto-review-gaps.test.ts` (3 tests) | A1, A2, A4 |
| `c2df40e1` | `packages/engine/test/window-coverage.test.ts` | T1 |

Ranking puts data loss and unsafe sends first.

## High

### S1. Send-once deletes the user's only message when the kept copy was deleted elsewhere

- **Where:** `packages/sync/src/sent.ts:51` and `packages/sync/src/actions.ts:262` queue the copy's delete once, when the copy is stored. The `ActionWorker` (`packages/engine/src/send/actionWorker.ts:89`, `run`) sends `chat.delete` for that ts later, without checking whether the kept message still exists.
- **Scenario:**
  1. A post goes out on a flaky connection. Chromium resends it, so Slack holds ts1 and ts2.
  2. Juno stores ts1 (kept) and then ts2, and queues the delete for ts2.
  3. The delete cannot go out yet, because the socket is down, Slack answered `internal_error`, or it was rate limited. These are the same conditions that cause the resend.
  4. On the phone the user sees two messages and deletes one of them, ts1.
  5. Juno reconnects and deletes ts2. Slack now holds none of the user's message.
- **Test:** "keeps the copy when the user deletes the kept message from another device while the delete waits". It fails: Slack holds 0 copies, and 1 was expected.
- **Fix direction:** before sending a copy's delete, check that the kept message is stored and not deleted. Otherwise, drop the delete row and make the copy the kept message (`sent_posts.ts = copy`).

### S2. Send-once deletes a copy that got replies after its delete was queued

- **Where:** the `reply_count > 0` guard in `sent.ts:50` runs only when the copy is first stored. A reply that arrives later is applied through `merge.ts` (`message_replied`), which does not run `reconcileSent` again. The worker does not check either.
- **Scenario:** other people's clients show both copies until the delete lands. Maya replies to the copy during that window, which lasts seconds normally, and longer under backoff or with the socket down. The delete then turns the copy into a tombstone. Maya's thread now hangs off "This message was deleted.", and Juno hides the copy. This breaks ADR 0014's own rule: "A copy that has replies is left alone".
- **Test:** "keeps a copy that another person replied to while its delete waited". It fails: the copy became a tombstone.
- **Fix direction:** have the worker read the copy's stored `reply_count` just before it sends. Also drop the copy delete when a reply is applied to it.

### A1. A server's `readOnlyHint` makes a new tool a read, which skips Always ask and the review

- **Where:** `packages/agent/src/mcp/catalogue.ts:25` (`isRead`) and `:51` (`read_hint` from the server at first sight). `packages/agent/src/mcp/tools.ts:65` runs Tier 0 before any rule or review is looked at.
- **Scenario:** the owner sets a connection to Always ask. The server later adds `post_comment` with `readOnlyHint: true` and sends `tools/list_changed`. That is the first time Juno sees the tool, so it counts as a read. An injected run calls it with no card, even when the run is tainted. The Configure sheet shows "Read", with no rule to change (`ConnectionToolsSheet.tsx:121`).
- **History:** this is a regression from `ed131475`. Before it, reads came only from the code's read list or from the owner's choice. `mcp/types.ts:43` still says reads are "reviewed by the owner, never guessed".
- **Spec:** SPEC 13.9 ("Reads") currently allows this behaviour, so the fix needs a SPEC decision.
- **Test:** "a read-only tool the server adds later does not skip the owner's Always ask". It fails: 1 post reached the server.

### A2. A changed or new tool inherits a connection-wide Never ask

- **Where:** `catalogue.ts:54` resets a changed tool to `'auto'`. In `manager.ts:258` (`rule`), a tool's `'auto'` means "use the connection's rule". So when the connection is set to Never ask, the reset does nothing, and any tool the server adds later also runs under Never ask.
- **Scenario:** the owner sets Notion to Never ask. The server then changes `notion-update-page`'s schema. In a clean run the changed tool runs with no review (`reviewed.ts:38`, `policy.ts:120`). In a tainted run it runs on an "implied" answer.
- **Test:** "a tool whose schema changed goes back to Auto, even under a connection-wide Never ask". It fails: the write ran and the reviewer was never called.

## Medium

### A3. Merge, purchase, force-push and delete tools are offered again, and run under Never ask

- **Where:** `ed131475` removed the `denied(name)` filter from `definitions` in `manager.ts`. `denied` now only raises the risk answer (`floorRisk`), which has an effect only under Auto, and only when a review answered.
- **Scenario:** a GitHub connection set to Never ask can call `merge_pull_request` with no check in a clean run.
- **Spec:** this conflicts with SPEC.md:457 ("not offered at all") and 13.4 ("Juno never merges or pushes"). Decide which is intended. No test was written.

### T1. A message window can stay hidden after a page that only adds coverage

- **Where:** `addSyncedRange` (`packages/sync/src/write.ts:756`) writes `synced_ranges` with no invalidation. `messages.list` re-runs on that key (`packages/engine/src/messages/handlers.ts:116`), but nothing ever fires it. The `landFresh` refresh in `4d61ad68` hides this only for the tab that ran the first fetch, and its comment describes a race that cannot happen: `liveQuery` subscribes before its first run.
- **Scenario:** a history page adds a range but no new message, for example a first send to someone the user has never messaged. `windowCovered` stays false, and `TopicView` keeps the rows hidden.
- **Test:** `window-coverage.test.ts` fails on `batch-3`. The fix, `2fea9f57`, is on `origin/main` but not in `batch-3`, so landing `batch-3` brings it in. Rerun the test after the merge.
- **Threads:** they still have the same gap after `2fea9f57`. `markRepliesComplete` (`write.ts:~405`) fires nothing, and the window does not listen on `thread_cursors`. Keep the `landFresh` refresh, or add that invalidation, and correct the comments.

### P1. Pacing has no total cap, and the interactive lane is outside the budget

- **Where:** buckets are per method (`packages/slack/src/client/queue.ts:50`). The old total cap on background calls is gone. The interactive lane takes no bucket (`queue.ts:99`).
- **Rate:** the 40 per minute the code comment calls "measured safe" was measured across all methods (298 calls in 424 s). It was never measured per method. Background history and replies can now each send 40 per minute.
- **Burst:** after each reconnect, `refreshOpen` (`packages/sync/src/sync.ts:160`) fetches every shown topic on the interactive lane. "Shown" includes every tab's header (`tabs.ts:~495`, `messages/handlers.ts:138`). With 30 tabs, that burst comes on top of the background rate. The official client shares the token, so a 429 slows it too.
- **Interactive lane:** a background flood cannot starve it. Permits are separate, and waits happen outside them (`queue.ts:104`).

## Low

### S3. Other send-once gaps, read from code

- **The Quint model cannot see S1 or S2.** In `specs/outbox.qnt`, `deleteCopy` has no guard on the kept message or on replies. The model also has no action for a delete from another device or for a reply to the copy. Its abstraction is counts (`held = server + dup - deletes`), so it does not track which message is kept. `keepsRealSends` holds there, but the code does not uphold it. Add these two actions when fixing S1 and S2.
- **A refused copy delete shows the duplicate again.** A refusal such as `cant_delete_message`, in workspaces that bar deleting, drops the row and the copy shows again. The result is truthful, but it is not mentioned in ADR 0014.
- **A slow copy delete holds up the user's own changes.** A copy delete in backoff, up to 5 minutes, holds the channel's later rows: the user's own edits, deletes and reactions in that channel wait behind it (`actionWorker.ts` `pass`, `held`).
- **Files are unknown.** It is not known whether real Slack's `chat.delete` on a `files.share` copy removes the file that the kept copy shares. The fake does not model it. Check this in the test channel before relying on deleting file copies.
- **Checked and fine:**
  - Two sends with the same text have different ids.
  - The agent never retries an unknown attempt, so it never reuses an id on purpose (`executor.ts:55`).
  - Edits made while a post is pending resolve to the kept copy.
  - Storing a message and queueing the copy's delete happen in one transaction, so a restart cannot split them.
  - If `storedMe` is missing, `user_id` is `''` and nothing is reconciled. That fails safe.
  - A DM opened by the send, where the channel id changes, is not reconciled. That also fails safe.
  - A clock jump can only expire `sent_posts` early. Copies then stay visible, and nothing is deleted.

### M1. Meta-fence: both intents survived the merge, with two small gaps

- **Merge checked:**
  - Reconnect still refreshes the workspace and full membership on the background lane (`boot.ts:504-508`).
  - real-data-1's `fillUsers(ctx, 'interactive')` still runs after counts (`boot.ts:510`).
  - The DM `wantUsers` still runs in `im_open`/`im_created` (`events.ts:180`).
  - The fence is released on failure (`acquireUseRelease`).
- **Gap: Juno's own new DM is not fenced.** `applySent` and `applyOpened` (`events.ts:225`, `:237`) use `upsertConversations` and `patchConversation` directly, not `patchMetadata`. Suppose the full `client.counts` snapshot from a reconnect predates a DM that Juno opened during its flight. Then `storeMembership` clears `is_member` on it, and only the socket's `im_created` puts it back.
- **Gap: partial events override the snapshot.** `observeMetadata` records every field of the event's row. A partial channel object, such as `channel_created`, carries null `topic` and `purpose`, and the fence then lets those nulls win over the snapshot.
- **Also:** observations are kept in memory, so a rolled-back event transaction still counts as observed.

### A4. The owner's rule is read before the review and not checked again

`reviewed.ts:34` reads the rule, and `runReviewed` (`:60-95`) does not read it again before authorizing. The spec checks the rule at authorization (`agent-actions.qnt:409`). A switch to Always ask during the review, which can take up to 3 s, does not stop the call. Test: "a rule the owner changes to Always ask while the review runs is the rule that applies". It fails: 1 write ran.

### A5. Smaller auto-review notes

- **Schema hash:** it covers only `inputSchema` and `outputSchema` (`catalogue.ts:47`). A change to a tool's description or annotations does not count as a change. A later `destructiveHint` never applies to a tool that was first seen as read-only.
- **Reviewer input:** the reviewer judges from the tool name, which the server chooses, and from arguments the main model wrote, possibly after reading injected text. The Quint model treats the reviewer as perfect (`agent-actions.qnt:107`), so `untrustedNeverAuthorizes` holds by assumption.
- **Replay message:** if a replayed call was run quietly on its first pass, the replay can tell the model "Nothing runs until the owner clicks" (`tools.ts:73`).
- **Checked and fine:**
  - No fail-open path. No model, no budget, a provider error, a timeout or an answer outside the choices all lead to a card.
  - The reviewer sees only the owner's own words.
  - Each call runs once.
  - The schema and account are checked again before the call.
  - Tools are keyed per connection, so names from different connections cannot collide.
  - A tool cannot become a read after Juno first sees it.

### P2. One 429 burst can slow a method for the whole session

`pause()` doubles the bucket interval on every 429 response, including concurrent ones and retries (`queue.ts:81`), and the interval never comes back down. Five concurrent 429s take a method from 1.5 s to 48 s for the session. Double the interval at most once per pause window, and let it decay.

### P3. Pacing doc and spec drift, and send-lane head-of-line

- `docs/architecture.md:307` says history and replies start 1.2 s apart. The code uses 1.5 s for every method.
- `specs/requestqueue.qnt` still models two tiers.
- `presence.set` shares the one-at-a-time send lane (`notificationRuntime.ts:133`). If it is slow, with up to a 60 s timeout, user sends wait behind it.
- A new sign-in builds a new queue and forgets any pause.

### T2. Tabs: nothing proven

- **Checked and fine:**
  - Drafts are per topic and flushed when a tab hides or closes.
  - The composer is keyed by topic and takes its target from `detail`, so a send cannot go to the wrong tab.
  - New chat's check result is dropped when the destination or text changes.
  - Reused tab ids get fresh per-tab state.
- **Already on main, low:**
  - An `updateTabs` call before the saved tabs load overwrites them.
  - Up to 400 ms of typing is lost on quit.
  - Two fresh opens of one topic at the same time share a window spec (not verified).

### F1. Integration fixes do not hide bugs

- `batch-1-fix` and `batch-2-fix` tighten tests:
  - `9561a146` waits for live before checking calls.
  - `40e8f714` stops the harness resending aborted requests.
  - The other changes make position and word checks exact.
- Loosened checks (`fe7812c5`, `1e8f13cd`) are justified by the SPEC.
- No tests are skipped and no timeouts were widened.
- The one workaround is the `landFresh` refresh (T1). Its real fix, `2fea9f57`, is on main.
