# 0003. SQLite is the source of truth for the UI; writes are local first with an outbox

Status: accepted, 2026-10-12. Revised in v2: undo is engine-computed (ADR 0010); merge and echo rules are in ADR 0011; the database layout is in ADR 0008.

## Context

The draft proposed optimistic updates in the renderer for resolve, pin and send: React applies the change, waits for the engine, and rolls back on failure. That keeps two copies of state and puts rollback logic in the layer that is supposed to be dumb. It also makes offline behaviour and restarts awkward.

Slack's own client keeps a persisted list of calls to retry on reconnect (`conversations.mark`, `subscriptions.thread.*`, `reactions.*`) and sends messages through a queue with one in flight, matching the echo by `client_msg_id`.

## Decision

Every screen reads from SQLite through a live query. A command runs one local transaction in the engine (overlay row, read state, pending message), which invalidates keys inside `Reactivity.withBatch` and pushes a delta to the renderer within a few milliseconds. Slack writes are rows in an `outbox` table drained in order per target with retry and backoff; they survive restarts. On a final failure the engine reverts the local row in the same code path that applied it and emits `command.failed`, shown as a toast with Retry.

The renderer keeps no optimistic copies of store data. Its only transients are the composer text and attachments (local by necessity), a per-topic "sending" flag, and the undo stack of engine-returned inverse commands.

## Consequences

- The UI behaves the same online and offline; actions never wait on Slack.
- All consistency logic (revert, echo matching, reconnect reconciliation) is in one place and is testable with the engine under Node, including with a randomised convergence test.
- Sync must merge rather than overwrite, because socket events, history pages and echoes arrive in any order (ADR 0011).
- Read state is Juno's own (`topic_reads`) with an explicit conflict rule against the official client's writes, mirrored to Slack where a matching call exists.
- Live queries ship deltas with row revisions, not whole lists, so a busy channel does not re-render everything.
