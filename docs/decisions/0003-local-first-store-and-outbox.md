# 0003. SQLite is the source of truth for the UI; writes are local first with an outbox

Status: proposed, 2026-10-12

## Context

The draft proposed optimistic updates in the renderer for resolve, pin and send: React applies the change, waits for the engine, and rolls back on failure. That keeps two copies of state (store and React) and puts rollback logic in the layer that is supposed to be dumb. It also makes offline behaviour and restarts awkward, because pending changes live in the renderer.

Slack's own client keeps a persisted list of calls to retry on reconnect (`conversations.mark`, `subscriptions.thread.*`, `reactions.*`) and sends messages through a queue with one in flight, matching the echo by `client_msg_id`.

## Decision

Every screen reads from SQLite through a live query. A command runs one local transaction in the engine (overlay row, read state, pending message), which invalidates keys and pushes a new snapshot to the renderer within a few milliseconds. Slack writes are rows in an `outbox` table drained in order per channel with retry and backoff; they survive restarts. A `postMessage` inserts a `pending` message that the socket echo replaces. On a final failure the engine reverts the local row in the same code path that applied it and emits `command.failed`, which the renderer shows as a toast with Retry.

The renderer keeps no optimistic copies. Its only transient is a per-topic "sending" flag. The undo stack in the renderer holds inverse commands, not state snapshots.

## Consequences

- The UI is identical online and offline; actions never wait on Slack.
- All consistency logic (revert, echo matching, reconnect reconciliation) is in one place and is testable with the engine under Node.
- A command's result over a local MessagePort costs one round trip of a millisecond or two; the UI reads the new snapshot rather than guessing it.
- The store schema must carry "pending" and "reverted" semantics explicitly, and sync must be idempotent (upserts) because socket events, history pages and echoes can arrive in any order.
- Read state is Juno's own (`topic_reads`) and is mirrored to Slack where Slack has a matching concept, which also makes stealth trivial.
