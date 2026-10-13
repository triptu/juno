# Juno sync protocols

These specs describe the intended protocol. They do not certify the current application code. Only the model checks are tests here.

`follow.qnt` models three threads, local Subscribe and Unsubscribe, the outbox, Slack, replies, the official client, socket delivery, HTTP pages, and reconnect recovery. `readstate.qnt` models Main, one followed thread, and one local-only thread. It includes local read and unread marks, the official client's marks, stealth, and reconnect recovery.

Both import `mirror.qnt`. That file holds the shared delivery rules so the two protocols cannot drift apart. A transaction updates the record `s`. Network acceptance, acknowledgement, event delivery, and fetch completion are separate actions. Different topics can have pending commands at the same time.

## Assumptions and limits

These assumptions are part of the protocol, not findings about Slack:

- A change stamp orders server writes, acknowledgement, and fetch start times. `clock` supplies that order in the model. A message's `ts` or a read pointer is not a change stamp. The researched socket shapes do not establish that every relevant event carries a usable `event_ts`. For an undated event, fetch authoritative state instead of inventing its order from arrival time. A local generation alone cannot order two remote events.
- Each topic has at most one pending command. Further commands for that topic wait. Other topics stay independent. This follows the current command seam. Outbox coalescing, overlapping calls on the same target, crash recovery, and persistence are outside this model.
- A fetch can return its snapshot from request start. Every command increments that topic's `epoch`. A response applies only when its generation still matches and its start time is newer than the last accepted observation. A missing follow field makes no change.
- Pending commands keep their local view. The newest server observation is retained separately in `seen` and `seenAt`. Acknowledgement uses it if it is newer than Slack's acceptance. An implementation can instead refresh after acknowledgement. Discarding pending events without a refresh can lose a newer official-client write.
- A timeout can happen after Slack accepts a call. `retry` clears the outstanding acceptance response, keeps the intent, and permits a new call. Final rejection starts a fresh root lookup. Restoring the value from before the command can restore stale state. If the server changes during that lookup, a later event or recovery fetch completes convergence.
- `getView` lists only follows. Recovery pages to the end, then queries roots of cached follows missing from the completed list. An absent row in a partial page never means unfollowed. A complete, guaranteed consistent server snapshot would be another possible protocol.
- Three fixed page slots with at most one listed thread each represent a list spanning multiple capped pages. Real Slack caps a page at ten threads. The model abstracts the cursor, latest-reply sorting, and threads outside the finite set. A moving real cursor needs another full pass once quiet. Stopping at a quiet window alone does not establish global agreement.
- The model holds at most eight socket events and two HTTP responses. Socket events can be delayed and reordered. Disconnect drops queued events. HTTP responses can survive a disconnect. Reconnect starts recovery. Once input stops, connectivity and delivery recover, and calls stop failing. Permanent outages and endless retry failures do not promise convergence.
- A successful reply follows its thread on Slack. Its response or own-message observation supplies the follow observation. The model does not require a separate `thread_subscribed` echo. Message sending and echo deduplication remain outside this model.
- Read pointers are `0`, `1`, or `2`, with `2` the latest message and `0` before the first unread message. `unread` models the local `marked_unread` flag. A later server mark clears that flag. Slack agreement compares pointers. Thread 3 is local only and deliberately excluded from agreement. Channel groups, changing watermarks, and boot seeding are outside this model.

The accepted architecture still describes a first-page reconnect and a window-limited cold boot. The complete recovery here is an explicit stronger requirement. Application and architecture changes belong to the concurrent implementation work.

## Properties

| Quint name | Plain meaning |
| --- | --- |
| `pendingIntentWins` | A pending command keeps its local value until success or final failure recovery. |
| `acceptedUnfollow` | When Slack's latest change is an accepted Unsubscribe, an old page or event cannot restore the follow. A genuinely newer server change can. |
| `localUnreadProtected` | A pending local Mark unread keeps its pointer and unread flag. |
| `acceptedUnreadProtected` | After Mark unread succeeds, an older event or page cannot erase its pointer or unread flag. |
| `failedCallReverted` | A final failure restores the fresh server value, if the server has not changed since the lookup began. |
| `quietAgreement` | With no pending work or recovery, every mirrored topic equals Slack. This catches silent losses of unfollows and follows. |
| `stealthNeverMarks` | A stealth open changes neither the read pointer, pending marks, nor mark traffic counters. Existing outbox work can still complete independently. |
| `drainBound` | After `seal` stops new input and failures, recovery reaches quiet agreement within forty transitions. |
| `eventualAgreement` | Under fair recovery, permanent quiet eventually leads to permanent agreement. This temporal formula is typechecked, but these scripts do not claim an unbounded liveness proof. |
| `reachedAgreement` | A coverage witness that a trace actually reached the quiet agreement state. |
| `invariants` | The conjunction checked for that protocol. |

The simulator checks `drainBound` as a finite safety property. The timer falls on each recovery transition before agreement. It does not assert equality by definition, and the recovery actions still use queued observations and real fetch snapshots. Forty covers the bounded queues, three pending calls, three pages, and absent-root lookups. Increasing those limits requires revisiting the budget.

## Run the checks

From the worktree root, run:

```sh
pnpm install --frozen-lockfile
pnpm specs:check
pnpm specs:traces
```

Quint is pinned to `@informalsystems/quint@0.33.0` in the root dev dependencies. The check script typechecks every `.qnt` file, samples each correct protocol 10,000 times with up to 160 transitions, and runs fixed regression schedules with and without guards. The seed is `20261013`. Completed simulation runs stop after quiet agreement, so the step limit is a maximum.

`specs:traces` samples each protocol 100 times and writes the same examples and counterexamples to `specs/traces/` without running Apalache. Generated JSON is ignored by git. Use `QUINT_SIMULATOR=typescript pnpm specs:check` if the default Rust evaluator cannot run. Quint obtains its Rust evaluator on the first run.

If Java and Quint's cached Apalache 0.62.1 are available, `specs:check` also runs `verify` for the correct protocols to a bound of twelve transitions and checks the regression counterexamples to thirty transitions. A bounded check is not an exhaustive proof over all trace lengths. The script prints the mode it used. A checker or runtime error fails the check. An expected bug must produce an actual invariant violation.

To obtain Apalache after installing Java, run:

```sh
pnpm exec quint verify specs/follow.qnt --invariant invariants --max-steps 12
```

Quint downloads its default distribution. Then run `pnpm specs:check` again. Without Java or Apalache, the randomized simulator and all directed bug checks still run. The temporal formula is not executed by the simulator. See the [Quint CLI reference](https://quint.sh/docs/quint) and [model checker guide](https://quint.sh/docs/model-checkers).

## Read a counterexample

Each JSON file uses Informal Trace Format. `states[0]` is the initial state. Each later state is the result of one action. Find the variable ending in `::s`, then read `label`, `target`, `local`, and `server`. `#bigint` holds an integer as text, `#map` holds key/value pairs, and `#set` holds a set. `--mbt` also records the selected action and nondeterministic arguments.

`stale-follow-page-bug.itf.json` has this sequence:

1. `startFetch` captures thread 1 as followed.
2. `localChange` writes Unsubscribe locally.
3. `accept` writes Unsubscribe on Slack.
4. `acknowledge` ends the pending command.
5. `finishFetch` restores the older follow. The final state violates `acceptedUnfollow`.

The guarded file `stale-follow-page.itf.json` rejects that page. Other bug files show an offline unfollow omitted by recovery, a new follow beyond the first page, a late read event, a late read page, a newer official mark discarded while a local mark is pending, and a stealth open that queues a mark. The matching guarded schedules pass.

For example, print a compact trace with:

```sh
jq '.states[] | to_entries[] | select(.key | endswith("::s")) | .value | {label, target, local, server}' specs/traces/stale-follow-page-bug.itf.json
```

## Map a trace to engine events

This is the contract for a later engine test adapter. No adapter or application test is changed here. Use invented ids and timestamps only. Map each logical stamp to a distinct change time. Hold HTTP responses until the corresponding completion action.

| Spec action | Slack event or Juno command |
| --- | --- |
| `subscribe`, `unsubscribe` | `topics.subscribe`, `topics.unsubscribe`; local transaction before `subscriptions.thread.add/remove`. |
| `markRead`, `markUnread` | Juno read commands; Main sends `conversations.mark`, followed threads send `subscriptions.thread.mark` with `read: 1` or `read: 0`. |
| `stealth` | Open the topic in stealth. Expect no additional mark or outbox item. |
| `accept` | Fake Slack accepts the pending add, remove, or mark. Hold its HTTP response. |
| `acknowledge` | Release that success response with its acceptance stamp. |
| `retry` | Lose a response or return a transient error. Preserve the local intent and retry. |
| `reject`, `finishFetch` with `kind: "failure"` | Final call failure, authoritative root/read lookup, then local recovery and `command.failed`. |
| `officialFollow` | Official-client add/remove; create a `thread_subscribed` or `thread_unsubscribed` event. |
| `threadMarked` | A Slack thread mark carrying the current `subscription.active` follow flag. |
| `reply` | Accept an own reply, which follows on Slack; deliver its response or own `message` observation. |
| `officialMark` | Official-client mark; create `channel_marked` or `thread_marked` with an independent change stamp. |
| `deliver` | Release the selected socket event. Subscription records include their follow flag. `thread_marked` can carry `subscription.active`; preserve ordering when it changes follow state. |
| `startFetch`, `finishFetch` with `kind: "view"` | Begin and release a `getView` page. Unfollowed threads are absent. |
| `startFetch`, `finishFetch` with `kind: "root"` | A root lookup carrying an explicit `subscribed` field, including false. |
| `startFetch`, `finishFetch` with `kind: "background"` | Read state from `client.counts` or a thread view after reconnect. |
| `startScan`, `requestPage`, `advancePage`, `finishScan` | Catch-up request loop. Map slots to real pages with `has_more` and `current_ts`. |
| `disconnect`, `reconnect` | Drop and restore the socket, then start catch-up. |
| `seal` | Stop new commands and official-client changes. Release remaining work and check convergence. |

Read-state scan pages represent `counts` and all required thread-view pages together. A follow view's empty slot makes no write. A root with a missing follow field also makes no write and must be retried or obtained from another authoritative source before recovery is declared complete.

## Maintain the protocol

Read the [architecture](../docs/architecture.md), [merge decision](../docs/decisions/0011-merge-rules-and-echo-reconciliation.md), [M3 review](../docs/reviews/m3/code-perf-review.md), and [Slack research](../docs/research/slack-data-access.md) before changing a rule.

Change shared delivery rules in `mirror.qnt`. Keep product actions and domain properties in the public specs. Add a directed schedule for each new race, show that the broken rule fails, then run `pnpm specs:check`. Update the assumptions and trace mapping when the protocol changes.
