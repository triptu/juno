# Juno sync protocols

These specs describe the protocols and their limits. They do not certify the application code. Only the model checks are tests here.

`follow.qnt` models the current follow command seam, two threads inside the quiet window, and one older thread. It includes Slack writes, socket delivery, HTTP pages, boot and hourly window passes, shorter reconnect reads, and activity lookups. Its `followProtocol` module takes constants; `follow` supplies the full simulator instance. `readstate.qnt` models read state as implemented in M4: Main and one followed thread that mirror, and one unfollowed thread that stays local. Its `readProtocol` module takes constants; `readstate` supplies the full simulator instance and `readstate-bounded.qnt` a small one. Like follow, it keeps Slack's event clock and Juno's observation clock apart.

## Follow rules and assumptions

- Values are `1` (followed), `0` (unfollowed), and `-1` (Unknown: no row). Unknown remains distinct from false. A root with `subscribed: false` does not create a row for an unknown thread; a root without the field changes nothing. A failed first Subscribe that finds false forgets its temporary row. Socket events with an explicit flag can create a row.
- `eventClock` supplies Slack event stamps and server-write order. `clock` supplies Juno request and observation times. No rule compares the two. Events apply when their stamp is at least `updatedEvent`; pages apply only when requested strictly after `observedAt`. A command stamps `observedAt` when it starts and again when its call ends (`acknowledge` or `reject`), but does not advance `updatedEvent`. An undated event queues a root lookup instead of writing a flag. A row a command wrote is `commanded`: an event stamp cannot be ordered against the command, so an event that contradicts such a row queues a root lookup instead of applying.
- Each thread has at most one pending command. Its intent stays visible. Eligible events and pages while pending only set `noted`; they do not advance either watermark. A success removes the pending row and, if noted, queues a fresh root lookup. The lookup can finish after other observations. Overlapping commands during that refresh, crashes and persistence are outside the model.
- There is no automatic command retry. An error, including a lost response after Slack accepted, ends the pending row and queues a fresh root lookup. When that lookup fails too (`failLookup`), the row keeps the command's state and the lookup stays queued, so it is tried again; the previous row is never restored without Slack's answer. The old fallbacks that restored it remain as bug modes (`restore`, `blind`).
- Boot and hourly passes page back to the quiet window. After those pages, they look up stored follows in range that were not listed and were not observed since the pass began. An omitted view row never means false by itself. Reconnect reads only the recent range and never probes its omissions. Thread 3 starts outside the window; another user's reply makes it active and queues a lookup if its stored follow is stale. An inactive old follow may remain stale indefinitely. A user's own reply follows on Slack and supplies an observation unless the local row already says followed, matching `followOnReply`.
- Fixed one-thread page slots represent a capped list spanning multiple pages. They abstract cursor movement, membership and request lanes. A thread that moves ahead of a real cursor can be missed until a later quiet pass. The model assumes all three conversations are members. It does not claim that a reconnect or an arbitrary moving pass establishes global agreement.
- `age` abstracts an observation becoming older than the quiet window; a fresh command, event or applied page clears that condition. The full instance holds at most eight socket events and two HTTP responses. Events can be delayed and reordered; disconnect drops queued events. HTTP responses can survive disconnect. A command acceptance need not have a socket echo. Fetches can return their request-start snapshot.
- `seal` stops new input and failures. An unfinished pass cursor is set aside; its queued responses still complete. Delivery settles before the next due window pass. That pass uses real snapshots and absent-root lookups; it does not assign agreement by definition. Roots then supply explicit flags. Connectivity recovers, and the hourly pass eventually runs. These are convergence assumptions, not evidence that Slack always behaves this way. A permanently missing field or failed lookup has no convergence promise.

The four reported differences are intentional protocol changes: separate clocks, failure lookup instead of retry, Unknown, and window-limited recovery. The three guards that keep an accepted Unsubscribe (stamp at the command's end, look up a contradicting event on a commanded row, keep the state when the lookup fails) are part of the protocol; each has a bug schedule that switches it off.

## Properties

| Quint name | Plain meaning |
| --- | --- |
| `pendingIntentWins` | Pending commands keep their local intent. |
| `acceptedUnfollow` | When Slack's latest write is an accepted Unsubscribe, an old event, an old page or a failed lookup cannot restore the follow. A genuinely newer server write can, and so can the user's next command on the thread. |
| `fallbackKeepsLatestEvent` | A failed lookup that changes the row cannot replace a newer applied event with the previous row. The protocol's failed lookup never changes the row; the `blind` bug mode does. |
| `missingChangesNothing`, `unknownStaysUnknown` | A missing root field leaves the flag unchanged; false from a root leaves an unknown thread unknown. |
| `failedCallReverted` | An applied failure lookup restores Slack's snapshot when Slack has not changed since the request. It permits Unknown for the failed first Subscribe. A failed lookup changes nothing, so it is not covered. |
| follow `quietAgreement` | After permanent quiet, delivery, and a due window pass, threads in the window or with activity agree with Slack's storage representation. Unknown is permitted for an unfollowed root that never had a row. This comparison does not define how UI reads Unknown. |
| read `quietAgreement` | With no pending work, lookups or reconnect refresh, every mirrored topic's pointer equals Slack's. |
| `pendingIntentWins` (read) | A pending mark keeps its pointer and flag visible. `localUnreadProtected` is its Mark unread case. |
| `acceptedMarkKept`, `acceptedUnreadProtected` | While Slack's latest write is Juno's accepted mark and the user has not marked since, Juno shows that mark (with the unread flag for Mark unread). Older events and pages cannot undo it. |
| `stealthNeverMarks` | A stealth open changes neither pointers, pending marks, nor mark traffic counters. |
| `coalesced` | Five marks before the worker sends, and one more while it is in flight, make at most two calls (`coalesceStep`). |
| `drainBound` | After input and failures stop, follow reaches scoped agreement within 64 transitions; read state within 48. |
| `eventualAgreement` | Under fair recovery and permanent quiet, permanent scoped agreement follows. Typechecked only; no unbounded liveness proof is claimed. |
| `reachedAgreement` | A coverage witness that a trace actually reached quiet agreement. |
| `invariants` | Passing safety and drain properties for that protocol. Follow includes `acceptedUnfollow`. |

The follow drain covers three pending calls and their refreshes, eight events, two responses, reconnect, three window pages and three absent-root pages. The read drain covers two pending marks with coalesced resends, eight events, two responses, lookups and the reconnect refresh within 48 transitions. Raising queue or topic limits requires revisiting the budgets.

## Read rules and assumptions

- Pointers are `0`, `1` and `2` (latest); `unread` is the Mark as unread flag. Main (1) and a followed thread (2) mirror; thread 3 is not followed and its marks stay local. Mirroring off is not a separate instance: it makes every topic's marks local like thread 3's, while Slack's changes still arrive under the same rules.
- `eventClock` stamps Slack's writes and events and orders events only (`updatedEvent`). `clock` stamps Juno's marks, their ends, event arrivals and fetch requests, and orders fetches only (`observedAt`).
- A mark (`localChange`) changes the pointer at once. A mirrored topic gets one pending row whose intent the next mark replaces (`gen`); `accept` sends the current intent and Slack may or may not echo it; `respond` ends the row unless the intent changed, records Slack's pointer (`slackSeen`) and stamps `observedAt`. `retry` is a lost answer or transient error after acceptance; `reject` is a refusal, which forgets `slackSeen` and asks Slack.
- While a mark is pending, an event or fetch that disagrees with it is only `noted`; Slack is asked when the row ends. After a topic's first mark (`commanded`), an event that contradicts the pointer asks Slack instead of applying.
- A fetch (`page`, `scan`, `lookup`) applies only when requested after `observedAt` and when its value differs from `slackSeen`. A fetch too old to apply that disagrees with the pointer asks Slack again.
- `disconnect` drops queued events; `reconnect` refreshes every mirrored topic (`scan`). Thread marks made elsewhere during a drop on a thread with no new reply wait for the next window pass in the code; the model assumes the reconnect refresh covers them.
- `seal` stops input and failures. Queued work completes.

## Accepted Unsubscribe: three races and their guards

Each race is a directed schedule with a fixed mode (`<name>Step`, must satisfy `invariants`) and a bug mode (`<name>BugStep`, must violate `acceptedUnfollow`). The bug modes are the rules Juno had before the guards.

`lateEvent` (`accepted-unsubscribe-late-event`): `officialFollow(1, 1)` creates a followed event at Slack stamp 1 and its delivery is delayed; `unsubscribe(1)`, `accept(1)` and `acknowledge(1)` follow, with no echo. The delayed event passes the event watermark (`1 >= updatedEvent = 0`). In bug mode it applies and local becomes 1 while Slack says 0. The guard: the row is `commanded` and the event contradicts it, so it queues a root lookup, which reads 0. This can happen on an ordered socket too, since a command need not have an echo.

`pendingPage` (`accepted-unsubscribe-pending-page`): `unsubscribe(1)` writes local 0; a page starts while Slack still says 1; Slack accepts and Juno acknowledges; the page completes with 1. Its request started after the command's first stamp. In bug mode it applies. The guard: `acknowledge` stamps `observedAt` again, so the page is older than the row.

`failedLookup` (`accepted-unsubscribe-failed-lookup`): `unsubscribe(1)`, `accept(1)`, then `reject(1)` for the lost response, then `failLookup(1)`. In bug mode the compare-and-swap fallback restores the previous follow although Slack says 0. The guard: the row keeps the command's state and the lookup is retried; under `seal` it succeeds and reads 0.

The stale-page regression (`stale-follow-page`) is the older race: a page requested before the command. The command's first stamp stops it; its bug mode has no page guard at all.

## Run the checks and bounds

From the worktree root, run `pnpm specs:check`. This is the only verification entry point used here; it queues behind `scripts/heavy.mjs`. Quint is pinned to `@informalsystems/quint@0.33.0`. The script typechecks every `.qnt`, samples both full protocols 10,000 times with at most 160 transitions and two simulator threads, and uses seed `20261013`. Completed simulations stop at agreement. Directed schedules run once for at most 80 transitions, with guarded and bug modes for stale follow pages, the three accepted-Unsubscribe races, missing stored follows, a follow beyond the first window page, reordered follow events, rollback after a newer event, stale read observations, lost pending read observations, and stealth. Additional schedules cover Unknown, observations retained through pending commands, ambiguous command failure, fallback, and old threads with and without activity. Read has guarded and bug modes for a late official mark (`lateMark`), a page from before a mark (`latePage`), a page requested while a mark was pending (`pendingPage`), an official mark during a pending one (`pendingMark`) and stealth, plus `coalesceStep`, `retryAfterAcceptStep` and `stealthThenMarkStep`. Generated ITF JSON and Apalache output in `specs/traces/` are ignored by git.

With Java, the bounded Apalache 0.62.1 checks use these small instances:

| Instance | Constants | Bound and properties |
| --- | --- | --- |
| `follow-bounded.qnt` | One known window thread and one unknown older thread; one recent thread; two queued events; one HTTP response | 4 transitions, `boundedSafety`: pending intent, accepted Unsubscribe, applied failure lookup, missing fields and Unknown |
| `readstate-bounded.qnt` | One mirrored Main topic; one queued event; one HTTP response | 4 transitions (`boundedStep`), `boundedSafety`: pending intent, pending unread, accepted mark and accepted unread |
| Follow races: stale page, late event, pending page, failed lookup | Same small follow instance | 5 transitions each, `acceptedUnfollow`; each bug mode must produce an actual counterexample and each fixed mode must pass |

The small instances import the same protocol actions; they do not replace them with proof-only transitions. The read instance selects marks, acceptance, answers, retries, refusals, events, pages and lookups for one Main topic; the reconnect refresh, stealth and the local-only thread are covered by the full simulator. The four-transition check is a shallow safety check, not a convergence or exhaustive protocol proof. Long recovery and read bug traces are checked by simulation, not thirty-step symbolic exploration. The whole script has a nine-minute execution budget, excluding the machine-lock wait. Each Quint process has a 60-second deadline, including each of the eleven Apalache runs; a timeout is a failure and its process group is killed. The script reports total execution time excluding the machine-lock wait. The completed check took 215.9 seconds on a loaded machine, including both full simulations, every regression and all eleven Apalache runs, excluding the machine-lock wait. This bounds normal verification to well below ten minutes; it avoids the previous twelve-step full-state and thirty-step regression checks. Without Java the script clearly reports simulator-only mode. A checker, runtime or syntax error never counts as an expected violation.

`QUINT_SIMULATOR=typescript pnpm specs:check` selects the TypeScript evaluator when Rust is unavailable. The temporal formula is typechecked but not executed. See the [Quint CLI reference](https://quint.sh/docs/quint) and [model checker guide](https://quint.sh/docs/model-checkers).

## Read and map a trace

ITF `states[0]` is initial. In each state find the variable ending in `::s`, then read `label`, `target`, `local`, `server`, `observedAt` and `updatedEvent`. `#bigint`, `#map` and `#set` encode integers, maps and sets. `--mbt` records selected actions and arguments. All identifiers and stamps are invented.

| Follow action | Engine or fake Slack event |
| --- | --- |
| `subscribe`, `unsubscribe` / `localChange` | Local transaction, pending `follow` row, then add/remove call |
| `accept`, `acknowledge` | Fake Slack accepts the call (`holdNext` with `before` delays this); later release its success response, which stamps `observed_at` again |
| `reject` | Return any command error, possibly after acceptance (`loseResponse`); remove pending, stamp `observed_at` and ask for the root |
| `startFetch`, `finishFetch` kind `failure` or `success` | Failure refresh, or refresh after a noted observation on success |
| `failLookup` | Fail the root lookup too; the row keeps the command's state and the lookup is retried in the background |
| `officialFollow`, `threadMarked`, `reply` | Official add/remove, explicit `subscription.active`, or own-reply follow observation |
| `deliver`, `undatedEvent` | Deliver an event with its independent Slack stamp (`holdFrames` delays it), or queue a lookup for a missing stamp; a contradicting event on a commanded row also queues a lookup |
| `missingRoot` | Root without `subscribed`; it makes no flag write |
| `startFetch`, `finishFetch` kind `view` or `root` | Hold/release a getView page or explicit root observation |
| `startScan`, `requestPage`, `advancePage`, `finishScan` | Boot/hourly window pass or shorter reconnect list; only the window pass probes absences |
| `otherReply` | Another user's reply activates an old thread and checks a stale stored follow |
| `age` | Passage of the quiet window makes an old observation stale |
| `hourlyPass` | Make the next window pass due |
| `disconnect`, `reconnect`, `seal` | Drop/restore the socket; stop input and allow quiet recovery |

| Read action | Engine or fake Slack event |
| --- | --- |
| `markRead`, `markUnread` / `localChange` | `reads.markRead`, `reads.markUnread`: local transaction and the topic's `mark` row |
| `accept` | `MarkWorker` sends `conversations.mark` or `subscriptions.thread.mark`; the fake's handler runs (`holdNext` holds the answer) |
| `respond` | Release the answer; `endMark` |
| `retry`, `reject` | `loseResponse` or a transient error (`forceError internal_error`, `force429`); a refusal (`forceError` with another error) |
| `officialMark`, `deliver` | `markRead` / `markThreadRead` from another client, and its frame (`holdFrames` delays it) |
| `startFetch` kind `page`, `scan`, `lookup`, `finishFetch` | `client.counts` or a `getView` row; the reconnect's counts; `conversations.info` or a root lookup |
| `stealth` | A stealth tab: no command |

Network acceptance, response, event delivery and fetch completion are separate transitions in both models.

## Maintain the protocol

Read the sync README's follow and read rule tables and architecture section 5 before changing a rule. Keep the event and observation clocks separate. Add a directed schedule for a new race, show the broken rule fails, run `pnpm specs:check`, and document bounds and any expected implementation violations. Product rules remain in the public specs.
