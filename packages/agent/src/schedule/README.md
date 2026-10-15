# Scheduler (WP19)

`SCHEDULE_MIGRATIONS` owns replicated `schedules` and `schedule_occurrences`.
`schedule_commands` keeps owner command results so transport retries apply once.
An occurrence's primary key is `(schedule_id, revision, due_at)`. Queuing is
idempotent. Admission checks the current revision, owner mode and live grant,
and commits the inbox wake and admission together. Start repeats those checks.
Cancellation increments the revision, revokes the grant and interrupts an
accepted inbox wake. Quiet hours affect `notification()` only.

`createScheduler({ store, replies, changed })` exposes the synchronous ledger
and an asynchronous `tick()`. `ScheduleService.layer` and `runScheduler` expose
the Effect service and scoped polling loop. `store.now` is the test clock.
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

## Integration contract

The router and renderer have separate owners. This change adds the service and
renderer-server contract; it does not modify `router/**` or desktop startup.
The following wiring is required before enabling schedules in the app:

- Add `SCHEDULE_MIGRATIONS` to the turn engine's migration sets, then construct
  the scheduler on that engine's store. Register `scheduleExecutors` with the
  actions service. Add `scheduleCreateTool` and `ownScheduleTool` to its tools.
- Run `runScheduler` in the engine's scope. `changed` must signal the router
  that persisted inbox work exists and invalidate the Scheduled page.
- In **both** the router's new-run and steering paths, call
  `scheduler.start(opId, persistRun)` for an accepted wake. `persistRun` writes
  the run/run-input record synchronously in the same transaction. Do this
  after asynchronous catch-up and immediately before delivery. Refuse delivery
  when start returns false and settle that inbox op as interrupted. Restoring an already persisted run does not call
  start again. This closes the crash gap between consuming a wake and recording
  the run. Do not call `Turns.accept` to deliver an unvalidated occurrence.
- WP13 supplies complete refreshed reply reads, owner identity, message events,
  saved notification hours, and verification of the menu message's author.
  Existing bounded `HostReads` alone cannot prove that no reply exists.
- Pass `{ scheduler, host: { ownMessage, hours } }` as `ChatHost.schedule`.
  The server serves Scheduled's page, Edit, Pause, Resume, Delete and
  `agent.schedule.watchReply` through this object. Without it, writes return
  unavailable; no guessed notification schedule is used.
- The wake's prompt includes the watched conversation and reply condition.
  The router must retain wake origin/taint. Its ordinary `send_message` tool
  produces the nudge's Send card, which still requires a click. The action
  source must bind that card to the watched conversation so a later reply
  expires it. WP15's current generic Send tool does not yet bind that source;
  the scheduler cannot expire an unrelated card by its text.

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
