# 0011. Sync merges field by field with guards; sends reconcile on response, echo or page, whichever comes first

Status: accepted, 2026-10-12. Refines ADR 0003.

## Context

v1 said rows are "upserted, not duplicated" and that sync is idempotent, without saying which write wins. The review listed the failures: a history page requested before an edit or delete event reverts it when it lands later; socket events moving the history cursor past a reconnect gap; edits, deletes and reactions on older messages lost during a disconnect; replies for roots not in the store; and for sends, a missing echo while the socket is down (duplicate rows), a retry after an ambiguous failure (duplicate posts), and edits of still-pending messages with no `ts`.

## Decision

Merge rules, applied by one function in `@juno/sync`:

- A tombstone always wins.
- `reply_count` and `latest_reply` take the maximum.
- An edit applies only if its `edited_ts` is newer.
- Reaction state from a page applies only if the message's `last_event_ts` is older than the page's request start.
- Socket events never move `synced_ranges`; ranges are explicit and only pages extend them.
- Warm boot and reconnect send `cached_latest_updates` for cached ranges selected by counts mutation markers and apply `latest_updates`, `unchanged_messages` and `deleted`. The 10-18 live probe confirmed timestamp versions and unchanged-body suppression; the 10-19 implementation retains a bounded ten-topic fallback for unproved marker coverage (`docs/research/slack-catchup.md`).
- A reply for an unknown root creates a stub root and the thread topic, and queues a fetch of the root.
- Known event types with unexpected shapes are logged (redacted ring buffer) and skipped.

Send reconciliation: pending messages are keyed by `client_msg_id`. The pending row is replaced by whichever arrives first: the `chat.postMessage` response, the socket echo, or a history or replies page containing the id. After a timeout or 5xx the outbox worker checks recent history for the id before retrying. Outbox items that need a real `ts` carry `depends_on` and resolve it when they run. Marks on one target coalesce to the last; add/remove reaction pairs cancel; edits of pending messages rewrite the pending row.

A seeded, randomised engine test interleaves events, pages, drops and sends and asserts the store equals the fake's state.

## Consequences

- Correctness does not depend on arrival order, which the socket, the queue and the user's actions cannot guarantee.
- Messages need `last_event_ts` and `version` columns, and the store needs `synced_ranges` instead of a single cursor.
- The convergence test is the main sync test; the 24-hour soak becomes an occasional check.
- Server versions are stored separately from local row versions; observed counts markers and durable pending ranges commit atomically; bounded background pages drain the queue after `live`.
