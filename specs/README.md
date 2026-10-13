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

Network acceptance, response, event delivery and fetch completion are separate transitions in both models. Engine tests disable the periodic sweep timer and trigger reconnects explicitly. `syncIdle()` waits for scan completion, including a due follow pass, and `commandIdle()` waits for command recovery to finish applying its answer. These observation hooks do not change the protocol actions or their ordering rules.

## Maintain the protocol

Read the sync README's follow and read rule tables and architecture section 5 before changing a rule. Keep the event and observation clocks separate. Add a directed schedule for a new race, show the broken rule fails, run `pnpm specs:check`, and document bounds and any expected implementation violations. Product rules remain in the public specs.

## Juno Agent memory (WP2)

`agent-memory.qnt` describes [plan v3](../docs/juno-agent/plan-v3.md), sections 3–5 and 15. It is a protocol contract for the future implementation, not a claim about existing application code. `memoryProtocol` supplies every transition; `agent_memory` supplies the simulator and directed schedules, and `agent_memory_bounded` supplies the small Apalache instance in the same file.

### Records, transactions and abstractions

- A durable inbox count precedes ordered projection into a dense archive. A source ID denotes an immutable opaque byte string. Redaction replaces its payload with a tombstone without reusing the ID. Each ID represents one chunk, up to 16,000 bytes; attachment storage and byte-page iteration are abstracted by that exact payload. Archive incarnations and two-journal power loss belong to WP4.
- Tree keys are aligned `(start, width)` intervals. Immutable node versions record source IDs, exact child and context node versions, and exact pin versions. `deps` caches the transitive source closure of those recorded reads. The separate `read` field records what the job actually saw, so a missing dependency is detectable. Model output may omit every fact, copy a read source, invent a fact, exceed 512 bytes, or fail. Provenance is conservative even when the output omits a source. Nothing here proves recall, factual accuracy, or instruction authority.
- `start`, `complete`, and `publish` are separate transitions. New messages, pin edits, removal and crashes can intervene. Publication revalidates inputs, pin revision, redaction generation and the expected head revision in the same transaction as node insertion and head advancement. Stale results leave durable work queued. A crash loses jobs and request preparation but preserves the archive, queue, deadlines, pins and exact committed head.
- The persisted head names exact node versions, ordered lines, a coverage watermark and a generation. Masked lines retain their intervals and render a fixed placeholder. The tail is everything after the published prefix. Out-of-order completed leaves wait until the prefix reaches them. Only sibling lines with a clean built parent can merge. Priorities use integer cross multiplication, age from the pair's inclusive last message, and oldest-start tie breaking.
- A compaction reads the nearest clean lines before its interval, newest first, stopping when another line would exceed 16,384 bytes. It also reads active pins. Both are recorded. Direct compaction input is at most 32,768 bytes; all compaction calls also pass an admission bound. The model keeps the shortest of at most five output attempts. Each shortening call reuses the bounded original input and fixed template, revalidates freshness, and passes the same provider bound; it does not accumulate previous attempts into a transcript. Deadlines use two abstract clock ticks instead of the production backoff ladder; the clock and worker advance without new messages.
- Pins are trusted copies of an owner source span (at most 280 bytes) or explicit owner edits. Edits preserve source lineage and supersede the previous version. Admission enforces 4,096 active bytes atomically. A removal deactivates matching pins immediately, including owner-edited descendants; delayed edits recheck lineage. The span's integer payload abstracts exact byte slicing, not its implementation or UTF-8 validation.
- Removal increments the generation, masks precisely the affected published lines, queues affected node keys, removes pins, invalidates prepared requests and clears affected live report/retrieval handles in one transaction. Clean versions outside the dependency closure remain usable. Rebuilds get new identities; purge removes obsolete text-bearing node records. Local journal/Codex files, grant and action invalidation, backups and the 24-hour purge deadline belong to WP3/4/16. Already sent provider copies and independently stored later replies are outside this memory guarantee.
- Requests capture pins, head, generation and cutoffs in one snapshot. Historical coverage, tail and active source IDs partition the selected prefix. A large tail has **one** bounded range placeholder. Uncollapsed tail items keep their exact source payload. Active tool-result paging preserves IDs and metadata; a modeled call/result pair must stay ordered and paired. Request cost includes fixed system/tools/framing, a 16,384 output reserve, pins, view, tail and active input. The final result is admitted or locally blocked. The provider guard rechecks the generation and pin revision, a trusted stamp over the complete request, and the budget. Spend reservations belong to WP3.

### Properties

Relational properties compare `s` with the ghost pre-state `before`, captured by `tick`. `safety` includes all 26 WP2 names and `pinsSurviveCompaction`; `invariants` also includes the finite drain bound.

| Property | Plain meaning |
| --- | --- |
| `sourceIdentityStable`, `retainedSourceExact` | The archive grows in order; retained source payloads stay exact. Removal does not reassign an ID. |
| `redactionMonotone` | Tombstones and the redaction generation never roll back within this archive history. |
| `nodeIdentityStable` | An existing node identity never changes payload or inputs; rebuilds use another version. |
| `nodeInputsCurrent` | A newly published node records everything it read and validates those inputs and pin versions at commit. |
| `treeClosed` | A readable parent has compatible, committed, clean children. |
| `viewPartition` | Ordered aligned intervals cover exactly the published prefix, without gaps or overlap. |
| `viewReferencesValid` | Every readable line names a clean committed version; other lines are explicitly masked. |
| `viewCAS` | A publication changing the head uses its actual expected revision and generation. |
| `restartPreservesHead` | Restart reloads the exact committed partition, versions and coverage. |
| `mergePreservesCoverage` | A merge replaces two siblings by their parent and removes exactly one line without moving coverage. |
| `mergeDueOrder` | The selected pair has greatest due priority measured from its last message, with the oldest tie winner. |
| `prefixBetweenBatches` | Outside merges, removal and masked-line replacement, the old rendered lines remain a prefix. |
| `pinAuthorityExact` | A new span comes from an owner message in the current run; active text is that exact span or an owner edit. |
| `pinBudget` | Active pins fit the total and per-pin byte limits. |
| `pinsSurviveCompaction` | Building, publishing, merging and ordinary crashes do not change pins. |
| `redactionExcludesReads` | Live views, pins, retrievals, reports and newly dispatched requests expose no removed source or tracked derivative, immediately after removal. |
| `retrievalSound` | Zoom returns exact permitted source payloads, exact clean children covering the requested interval, or an explicit unavailable result. |
| `requestSnapshotConsistent` | Preparation uses one snapshot; admission uses the current redaction generation. |
| `requestCoverageDeclared` | View, tail and active suffix have no overlap or gaps; omitted tail content is explicitly declared. |
| `requestProtocolValid` | Dispatch preserves modeled tool pairing, IDs, order and metadata. |
| `requestBounded` | Chat and compaction dispatch costs fit their window including output reserve. Blocked turns make no call. |
| `mandatoryPinsIncluded` | A dispatched chat request contains every current active pin exactly. |
| `compactorLimits` | Worker count, earlier-leaf admission, context/input bounds and output-attempt limits hold. |
| `pendingWorkRecoverable` | The queue names exactly the missing or dirty current intervals. Crashes retain it; obsolete versions awaiting purge cannot strand an extra retry row. |
| `taintClosureExact` | Redaction masks exactly the published lines reached through recorded dependencies; unrelated lines stay clean. |
| `guardStampRequired` | Every dispatched payload has its builder's authentic stamp, including its revision, generation and content. |
| `drainBound`, `reachedAgreement` | After sealing, normal worker transitions complete projection, summaries, publication, purge and feasible batches within the drain budget. A finished trace is a coverage witness. |

The five temporal formulas are **typechecked only**: `eventuallyProjected`, `eventuallySummarized`, `retryEventuallyRuns`, `redactionEventuallySettles`, and `batchEventuallyFinishes`. Their antecedents require permanent quiet, fair recovery, storage and compaction allowance, and eventually successful model calls. `batchEventuallyFinishes` also requires a feasible low-mark partition; its explicit witness is four sources with a built root no larger than the low mark. No hard 512-byte node limit, always-achievable low watermark, unbounded liveness proof or semantic forgetting is claimed.

### Directed broken/corrected pairs

Each row names `<schedule>Step` and `<schedule>BugStep`. The corrected schedule checks all invariants and must finish its real drain; the broken schedule must produce an invariant counterexample. A disabled action, parser error, checker error or timeout does not count. Script counters are ghost state; the same protocol actions implement every scheduled operation.

| Schedule | Failure switched on in bug mode |
| --- | --- |
| `redactionRace` (plan #6) | Redaction lands after a job reads/checks inputs but before publication; commit skips revalidation. |
| `contextRace` (#7) | Redaction follows tree ancestry only and misses another interval that read the removed source as context. |
| `unrecordedContext` (#7) | A job reads context but omits it from its recorded read set. |
| `lateReport`, `latePin`, `lateRequest` (#8) | Respectively, a delayed report, owner pin edit or active-run request bypasses redaction validation. |
| `overflow` (#9) | Five oversized outputs leave pins plus view above a small model window; the final fallback dispatches anyway. |
| `overlap`, `fastCompactor` (#10) | Projection or compaction puts the current input in historical memory as well as the active suffix. |
| `siblings` (#17) | Adjacent non-siblings merge into an invalid interval. |
| `dueOrder` (#18) | The `T=10` partition `0+4, 4+4, 8+1, 9+1` measures age from the first message and chooses the wrong pair. |
| `editedJob` (#19) | An owner edits a pin after a worker reads it; stale output commits without a current-input check. |
| `casRace` | Two workers capture the same head; the second bypasses the expected-revision check. |
| `atomicPublish` | A readable view line is published before its node is committed. |
| `restart` | Restart reconstructs a different head instead of reloading the persisted one. |
| `crashTail` | A new source arrives while compaction runs; a crash after projection drops the queue for both uncovered sources. |
| `retryQuiet` | A final failed job retries only on new input, so the quiet drain expires. |
| `rawRequest`, `alteredRequest` | A hook fallback has no builder stamp, or the stamped payload changes before dispatch. |
| `mixedSnapshot` | Pins and the view are read from different snapshots. |
| `pinText`, `pinBudget` | Arbitrary text is attributed to an owner source, or a fifteenth 280-byte pin exceeds 4 KB. |
| `toolPair` | A malformed tool result is admitted with another call ID. |
| `compactionPins` | A view merge silently drops mandatory pins. |
| `queueCurrent` | A second removal before purge queues a clean rebuilt key because its obsolete version is still tainted. |

The due-order, non-sibling and pin-preservation schedules start from explicit valid persisted fixtures; the choices under test still use shared transitions. Other schedules start empty. Plan #20 (approval reuse), all action races and all ownership/backup races belong to WP3/4, not this file.

### Memory bounds and plan clarifications

The simulator instance has ten possible source IDs and aligned widths 1, 2, 4 and 8. Random admission stops at four sources (seven possible built intervals); the ten-source fixture exists for the exact due-order witness. Worker capacity remains eight. View watermarks are reduced to 2,048/1,024 bytes so short histories exercise batching; pin, context, input, tail, active and output-reserve limits keep their production byte values. Random model outputs are 512, 2,048 or 8,192 bytes, with arbitrary provenance subsets and an invented marker. This includes soft-target failures without asserting that all production outputs fit a parent request.

The runner takes 1,000 samples of up to 140 transitions with seed `20261013` and two simulator threads. Directed schedules take at most 80 transitions. The 25 corrected schedules share one 512-sample run; the runner requires a completed witness for every case, so a missing sample is a failure. Each broken schedule runs separately and writes its own counterexample. This avoids paying checker startup twice for every pair. A 64-transition drain covers up to seven pending intervals, outstanding/stale jobs, retry deadlines, projection, ordered publication, removal rebuilds, purge and feasible merges. It assumes no new inputs, edits, crashes or failures after `seal`; successful draining outputs are 512 bytes. Quiet recovery is exercised through the actual worker actions. A positive directed trace must end with `label = finished`.

Apalache uses two sources, two workers and the same actions. It checks archive projection, removal, queue durability and restart (`boundedSafety`) for four transitions. Separate broken/corrected `boundedRace` schedules check the six-transition `redactionRace` through the same worker actions. The symbolic schedules omit the general string-command decoder. Quint otherwise sends type metadata for unused declarations and exceeds Apalache’s 20 MB JSON-string limit. The runner uses the pinned Quint compiler in a timed child, retaining only analysis metadata whose IDs occur in the compiled main module. It leaves the compiled module, expressions and types of all live IDs unchanged before calling the normal Apalache backend. No transaction is replaced by a proof-only action. These are shallow bounded checks, not exhaustive verification of every invariant. The simulator covers requests, pins, context closure, batches and longer recovery schedules. `pnpm specs:check --memory` selects these checks during development; the ordinary `pnpm specs:check` includes them with the existing sync checks. `pnpm specs:check --memory --bounded` reruns only the memory symbolic checks. All modes use the machine-wide lock and existing nine-minute execution/60-second process deadlines. `--traces` reduces memory sampling to 100 and skips Apalache. The complete `pnpm specs:check` run on 2026-10-14 passed in **326.3 seconds (5m 26s)**, excluding the machine-lock wait. This includes both existing sync protocols, all 1,000 random memory traces, all 512 corrected-schedule traces (every case witnessed), all 25 memory counterexamples and the bounded Apalache checks. The sync-only timing above is the earlier baseline.

The model makes these plan ambiguities explicit:

1. **R4 does not bound transitive rebuild size.** A 16 KB direct window can form a dependency chain through every later summary. Rebuilding exactly the recorded closure is sound; claiming that closure is always small is not. Pin inputs also need recorded versions and source lineage, not only context-node versions.
2. **A live head can pass the run-start cutoff `H`.** The model then renders an empty historical view and uses the ordinary tail/range placeholder up to `H`, while retaining the actual snapshot revision. This conservative bounded fallback avoids splitting a straddling summary or duplicating active inputs. A production implementation may instead retain a historical head or expand nodes at `H`, but it must choose a rule.
3. **Pin edits race jobs and requests without changing redaction generation.** The model validates a pin revision as part of both digests. Validating only `gen` is insufficient for current mandatory pins and stale pin-dependent jobs. Owner-edited pins retain removal lineage.
4. **Oversized immutable children can exceed the 32 KB parent-input limit.** Keeping the shortest of five outputs does not guarantee that a future pair fits. The bounded model's sampled outputs avoid that separate input-feasibility obstruction. Production needs a bounded input representation, another shortening policy, or an explicit unavailable/blocked state; unconditional compaction progress cannot be inferred from the plan as written.

Token arithmetic is an abstract conservative cost contract. This spec does not validate a provider tokenizer, real serialized framing, spend accounting, SQLite durability, Unicode slicing, attachment pagination, pi resumption or storage erasure. Those need implementation tests and the planned spikes.
