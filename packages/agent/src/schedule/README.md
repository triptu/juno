# Scheduler (WP19)

`SCHEDULE_MIGRATIONS` owns replicated `schedules` and `schedule_occurrences`.
`schedule_commands` keeps owner command results so transport retries apply once.
An occurrence's primary key is `(schedule_id, revision, due_at)`. Queuing is
idempotent. Admission checks the current revision, owner mode and live grant,
and commits the inbox wake and admission together. Start repeats those checks.
Cancellation increments the revision, revokes the grant and interrupts an
accepted inbox wake. Quiet hours affect `notification()` only.

`createScheduler({ store, replies, changed })` exposes the synchronous ledger
and an asynchronous `tick()`. `ScheduleService.layer` exposes the Effect service. The router owns the serialized
polling driver and waits for it during shutdown. `store.now` is the test clock.
`replies` must refresh the complete conversation and return its messages and
the owner's user id. A failed refresh must reject; it must not return an empty
page. `observe(message, owner)` handles each host conversation event without a
model call. Both paths settle a matching watch through cancellation.

The menu deadline is the same local minute on the next enabled notification
day, or that day's notification-hours start when outside hours. It uses the
owner's saved timezone, weekdays and hours. The menu command verifies that the
message belongs to the owner, persists a completed owner click in the inbox,
mints the menu grant and posts a Schedule card without a model run.

Pause revokes grants. Global Resume does not restore them. The Scheduled page
shows a schedule without a live grant as paused. Explicit schedule Resume or
Edit supplies a new owner click and creates a new revision and grant.

## Runtime

`openTurns` applies the schedule migrations, registers the tools and card
executors, and starts one scheduler driver. `Turns.checkSchedules()` runs the
same serialized pass used by the timer and host message events. Shutdown
stops the driver and waits for any host read before closing SQLite.

The router calls `scheduler.start(opId, persistRun)` in both its new-run and
steering paths. Recording the run or steered input and consuming the occurrence
is one transaction. A refused wake is interrupted without delivery. Recovery
resumes the recorded run without starting the occurrence again.

`startAgent` binds `host.schedule.check`, `hours` and `changes`. Ordinary checks
read cached message metadata; the deadline check paginates Slack until the
conversation is complete. Errors, incomplete pages and limited history never
count as proof that nobody replied. Each RPC checks the signed-in account,
and a watch retains the account it was created for. AI assist off prevents
scheduler admission. Notification hours do not prevent a wake from running.

A Send card proposed by a run that consumed a reply-watch occurrence is bound
to that watch when its destination matches. The binding commits with the
proposal. Replies are retained even if they arrive while the wake is drafting.
A reply sets the card's persisted expiry before any new authorization; cards
that already authorized a send keep their outcome. Checks and expiry make no
model calls. `startAgent` also supplies the Scheduled page and menu RPC with
its scheduler, author check and saved notification hours.

## WP14

Call `agent.schedule.watchReply` with a stable `opId`, `channelId`, `ts` and
optional `threadTs` from the owner's message menu. The response is `{ opId, id,
at }`. Format `at` in the owner's timezone for the toast. Undo calls
`agent.scheduled.action` with `action: 'delete'` and the current revision from
`agent.scheduled.page`. Disable the menu item while the owner cannot authorize.
The page and revision stream use the existing Scheduled view shapes.

## Verification

`test/schedule.test.ts` covers one firing, cancellation before admission and
start, grant revocation and explicit Resume, restart, SIGKILL at queued and
admitted boundaries, a reply ending a watch, coalescing, the menu deadline,
property checks, and Proposed schedule Start through the real action
dispatcher and the agent-testing provider. All fixtures are invented.

`test/schedule-flow.test.ts` exercises the renderer RPC, real router and action
ledger with the agent-testing provider and an injected clock: deadline to Send
card, reply cancellation without a run, expiry during drafting, and a wake
steering an owner run. The engine's `test/agent-host.test.ts` verifies the host
port, message changes and refreshed replies beyond a single Slack page.

The Slack message menu wires the watch RPC directly, with an Undo toast.
The chat summary publishes whether the owner may authorize so the menu is
disabled during Pause, AI off, recovery and ownership on another Mac. Wake
groups use the persisted occurrence to show Scheduled and its schedule name.
