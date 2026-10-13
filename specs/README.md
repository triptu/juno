# Juno sync protocols

These specs describe the protocols and their limits. They do not certify the application code. Only the model checks are tests here.

`follow.qnt` models the current follow command seam, two threads inside the quiet window, and one older thread. It includes Slack writes, socket delivery, HTTP pages, boot and hourly window passes, shorter reconnect reads, and activity lookups. Its `followProtocol` module takes constants; `follow` supplies the full simulator instance. `readstate.qnt` models Main, one followed thread, and one local-only thread. It retains its existing rules through `mirror.qnt`. Follow no longer imports that shared model: follow events and pages use different clocks, and follow commands have no retry worker.

## Follow rules and assumptions

- Values are `1` (followed), `0` (unfollowed), and `-1` (Unknown: no row). Unknown remains distinct from false. A root with `subscribed: false` does not create a row for an unknown thread; a root without the field changes nothing. A failed first Subscribe that finds false forgets its temporary row. Socket events with an explicit flag can create a row.
- `eventClock` supplies Slack event stamps and server-write order. `clock` supplies Juno request and observation times. No rule compares the two. Events apply when their stamp is at least `updatedEvent`; pages apply only when requested strictly after `observedAt`. A command stamps `observedAt`, but does not advance `updatedEvent`. An undated event queues a root lookup instead of writing a flag.
- Each thread has at most one pending command. Its intent stays visible. Eligible events and pages while pending only set `noted`; they do not advance either watermark. A success removes the pending row and, if noted, queues a fresh root lookup. The lookup can finish after other observations. Overlapping commands during that refresh, crashes and persistence are outside the model.
- There is no automatic command retry. An error, including a lost response after Slack accepted, ends the pending row and queues a fresh root lookup. Only when that lookup fails too can the previous row be restored, and only if the current value and observation stamp still equal the command's own write. This fallback does not promise server agreement.
- Boot and hourly passes page back to the quiet window. After those pages, they look up stored follows in range that were not listed and were not observed since the pass began. An omitted view row never means false by itself. Reconnect reads only the recent range and never probes its omissions. Thread 3 starts outside the window; another user's reply makes it active and queues a lookup if its stored follow is stale. An inactive old follow may remain stale indefinitely. A user's own reply follows on Slack and supplies an observation unless the local row already says followed, matching `followOnReply`.
- Fixed one-thread page slots represent a capped list spanning multiple pages. They abstract cursor movement, membership and request lanes. A thread that moves ahead of a real cursor can be missed until a later quiet pass. The model assumes all three conversations are members. It does not claim that a reconnect or an arbitrary moving pass establishes global agreement.
- `age` abstracts an observation becoming older than the quiet window; a fresh command, event or applied page clears that condition. The full instance holds at most eight socket events and two HTTP responses. Events can be delayed and reordered; disconnect drops queued events. HTTP responses can survive disconnect. A command acceptance need not have a socket echo. Fetches can return their request-start snapshot.
- `seal` stops new input and failures. An unfinished pass cursor is set aside; its queued responses still complete. Delivery settles before the next due window pass. That pass uses real snapshots and absent-root lookups; it does not assign agreement by definition. Roots then supply explicit flags. Connectivity recovers, and the hourly pass eventually runs. These are convergence assumptions, not evidence that Slack always behaves this way. A permanently missing field or failed lookup has no convergence promise.

The four reported differences are intentional protocol changes: separate clocks, failure lookup instead of retry, Unknown, and window-limited recovery. Three schedules still violate the useful strong safety property below; they are reported rather than hidden.

## Properties

| Quint name | Plain meaning |
| --- | --- |
| `pendingIntentWins` | Pending commands keep their local intent. |
| `acceptedUnfollow` | When Slack's latest write is an accepted Unsubscribe, an old observation or failed lookup cannot restore the follow. A genuinely newer server write can. **The implemented follow rules violate this.** |
| `fallbackKeepsLatestEvent` | A failed lookup cannot replace a newer applied event with the previous row. |
| `missingChangesNothing`, `unknownStaysUnknown` | A missing root field leaves the flag unchanged; false from a root leaves an unknown thread unknown. |
| `failedCallReverted` | An applied failure lookup restores Slack's snapshot when Slack has not changed since the request. It permits Unknown for the failed first Subscribe. It says nothing about a failed lookup's fallback. |
| follow `quietAgreement` | After permanent quiet, delivery, and a due window pass, threads in the window or with activity agree with Slack's storage representation. Unknown is permitted for an unfollowed root that never had a row. This comparison does not define how UI reads Unknown. |
| read `quietAgreement` | With no pending work or recovery, every mirrored read topic equals Slack. |
| `localUnreadProtected`, `acceptedUnreadProtected` | Pending and accepted Mark unread survive older observations under the read protocol's guards. |
| `stealthNeverMarks` | A stealth open changes neither pointers, pending marks, nor mark traffic counters. |
| `drainBound` | After input and failures stop, follow reaches scoped agreement within 64 transitions; read state within 40. |
| `eventualAgreement` | Under fair recovery and permanent quiet, permanent scoped agreement follows. Typechecked only; no unbounded liveness proof is claimed. |
| `reachedAgreement` | A coverage witness that a trace actually reached quiet agreement. |
| `invariants` | Passing safety and drain properties for that protocol. Follow deliberately excludes the violated `acceptedUnfollow`, which is checked separately as an expected implementation counterexample. |

The follow drain covers three pending calls and their refreshes, eight events, two responses, reconnect, three window pages and three absent-root pages. Read keeps its existing forty-transition budget. Raising queue or topic limits requires revisiting the budgets. Read pointers remain `0`, `1`, or `2` (latest); thread 3 is local only, and stealth does not mark. Read still uses comparable change stamps, generations, retained pending observations and retry. Those rules are not changed to match the follow seam.

## Real implementation counterexamples

`accepted-unsubscribe-late-event.itf.json` uses the enabled guards:

1. `officialFollow(1, 1)` creates a followed event at Slack stamp 1; delay delivery.
2. `unsubscribe(1)` writes local 0 and stamps Juno's observation clock.
3. `accept(1)` writes Slack 0 at Slack stamp 2.
4. `acknowledge(1)` ends pending. No observation was noted, so no refresh is queued.
5. `deliver` applies the delayed followed event: stamp 1 is newer than `updatedEvent = 0`. Local becomes 1 while Slack remains 0. `acceptedUnfollow` fails.

This can occur even with an ordered socket: there need not be a command echo before the delayed pre-command frame. The next window pass repairs the value (`accepted-unsubscribe-recovery.itf.json`), but that does not make the safety property true.

`accepted-unsubscribe-failed-lookup.itf.json` shows the other violation:

1. `unsubscribe(1)` writes local 0, preserving previous 1.
2. `accept(1)` writes Slack 0.
3. `reject(1)` represents the lost success response and queues a root lookup.
4. `failLookup(1)` represents that lookup failing too. The compare-and-swap passes and restores local 1, although Slack remains 0.

All three schedules are real problems if accepted Unsubscribe must never be undone by old information. Application changes are outside this task. The spec preserves that requirement and reproduces the violations explicitly; passing the check acknowledges them, rather than proving their absence.

`accepted-unsubscribe-pending-page.itf.json` shows another stale-observation race: Unsubscribe writes local 0; a page starts while Slack still says 1; Slack accepts and acknowledges Unsubscribe; the page completes with 1. Its request started after the command's observation stamp, and success did not advance that stamp, so the enabled page guard applies it and violates `acceptedUnfollow`.

## Run the checks and bounds

From the worktree root, run `pnpm specs:check`. This is the only verification entry point used here; it queues behind `scripts/heavy.mjs`. Quint is pinned to `@informalsystems/quint@0.33.0`. The script typechecks every `.qnt`, samples both full protocols 10,000 times with at most 160 transitions and two simulator threads, and uses seed `20261013`. Completed simulations stop at agreement. Directed schedules run once for at most 80 transitions, with guarded and bug modes for stale follow pages, missing stored follows, a follow beyond the first window page, reordered follow events, rollback after a newer event, stale read observations, lost pending read observations, and stealth. Additional schedules cover Unknown, observations retained through pending commands, ambiguous command failure, fallback, and old threads with and without activity. Generated ITF JSON and Apalache output in `specs/traces/` are ignored by git.

With Java, the bounded Apalache 0.62.1 checks use these small instances:

| Instance | Constants | Bound and properties |
| --- | --- | --- |
| `follow-bounded.qnt` | One known window thread and one unknown older thread; one recent thread; two queued events; one HTTP response | 4 transitions, `boundedSafety`: pending intent, applied failure lookup, missing fields and Unknown |
| `readstate-bounded.qnt` | One live mirrored Main topic; one queued event; one HTTP response | 4 transitions, `boundedSafety`: pending intent and pending/accepted unread |
| Follow stale-page bug and real late-event violation | Same small follow instance | 5 transitions each, `acceptedUnfollow`; both must produce an actual counterexample |

The small instances import the same protocol actions; they do not replace them with proof-only transitions. Read imports `mirror.qnt` directly and selects live Main marks, command responses, events and background fetches. Apalache 0.62.1 fails on the broader read step (`key not found: $C$7`), so scan recovery, stealth and the local-only thread remain covered by the full simulator. This is a documented symbolic-check limit, not a protocol change. The four-transition check is a shallow safety check, not a convergence or exhaustive protocol proof. Long recovery and read bug traces are checked by simulation, not thirty-step symbolic exploration. The whole script has a nine-minute execution budget, excluding the machine-lock wait. Each Quint process has a 60-second deadline, including each of the four Apalache runs; a timeout is a failure and its process group is killed. The script reports total execution time excluding the machine-lock wait. The completed check on this worktree took 131.8 seconds, including both full simulations, every regression and all four Apalache runs, excluding the machine-lock wait. This bounds normal verification to well below ten minutes; it avoids the previous twelve-step full-state and thirty-step regression checks. Without Java the script clearly reports simulator-only mode. A checker, runtime or syntax error never counts as an expected violation.

`QUINT_SIMULATOR=typescript pnpm specs:check` selects the TypeScript evaluator when Rust is unavailable. The temporal formula is typechecked but not executed. See the [Quint CLI reference](https://quint.sh/docs/quint) and [model checker guide](https://quint.sh/docs/model-checkers).

## Read and map a trace

ITF `states[0]` is initial. In each state find the variable ending in `::s`, then read `label`, `target`, `local`, `server`, `observedAt` and `updatedEvent`. `#bigint`, `#map` and `#set` encode integers, maps and sets. `--mbt` records selected actions and arguments. All identifiers and stamps are invented.

| Follow action | Engine or fake Slack event |
| --- | --- |
| `subscribe`, `unsubscribe` / `localChange` | Local transaction, pending `follow` row, then add/remove call |
| `accept`, `acknowledge` | Fake Slack accepts the call; later release its success response |
| `reject` | Return any command error, possibly after acceptance; remove pending and ask for the root |
| `startFetch`, `finishFetch` kind `failure` or `success` | Failure refresh, or refresh after a noted observation on success |
| `failLookup` | Fail the root lookup too; guarded restoration of the previous row |
| `officialFollow`, `threadMarked`, `reply` | Official add/remove, explicit `subscription.active`, or own-reply follow observation |
| `deliver`, `undatedEvent` | Deliver an event with its independent Slack stamp, or queue a lookup for a missing stamp |
| `missingRoot` | Root without `subscribed`; it makes no flag write |
| `startFetch`, `finishFetch` kind `view` or `root` | Hold/release a getView page or explicit root observation |
| `startScan`, `requestPage`, `advancePage`, `finishScan` | Boot/hourly window pass or shorter reconnect list; only the window pass probes absences |
| `otherReply` | Another user's reply activates an old thread and checks a stale stored follow |
| `age` | Passage of the quiet window makes an old observation stale |
| `hourlyPass` | Make the next window pass due |
| `disconnect`, `reconnect`, `seal` | Drop/restore the socket; stop input and allow quiet recovery |

Read actions and `mirror.qnt` retain their previous meanings: mark read/unread, local-only thread, stealth, retry, retained pending observations, and reconnect refresh of all mirrored topics. Network acceptance, response, event delivery and fetch completion are separate transitions in both models.

## Maintain the protocol

Read the sync README's follow rule table and architecture section 5 before changing a follow rule. Keep the event and observation clocks separate. Add a directed schedule for a new race, show the broken rule fails, run `pnpm specs:check`, and document bounds and any expected implementation violations. Shared read delivery rules remain in `mirror.qnt`; product rules remain in the public specs.
