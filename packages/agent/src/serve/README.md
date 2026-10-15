# Chat projection cache

`createChatCache(store, changed)` belongs to one chat server. `close()` unregisters
it. The renderer still receives exactly the requested `ChatWindow` slice, at most
200 rows. Grouping, day boundaries, unread counts and quotes use the complete
server-side history; an anchor at the edge of a window therefore keeps the same
row and group position. The existing `around.before` supplies context. Adding
extra wire rows would change the window contract.

The cache keeps parsed bubbles by run and view rows by item. A run's archive text,
source handles and timestamps determine its bubbles. Retry aliases and owner text
determine quotes. Reactions, read marks, job titles and places, card contents and
outcomes, and waiting state can change old rows. A source change invalidates only
the affected run's parsed bubbles. A changed read mark recomputes the divider and
group boundaries while retaining rows whose visible values did not change.

Connection-local SQLite triggers count writes to the input tables. Their counters
commit and roll back with the writer. Queries reuse their snapshots until their
inputs change. Archive deletion, replacement, chunk changes and redaction therefore
invalidate without relying on a router event. These counters contain no message
content, are not migrations, and disappear with the connection.

Reactions, status text and existing card outcomes do not change layout. Those
updates replace the indexed rows directly and retain every other row. Structural
changes walk the ordered history and recompute grouping, but reuse unchanged
finished rows and parsed runs. This work still grows with history length; the
cache is not a persistent ordered index.

## Redaction hook

WP16 should import `invalidateChatCaches` from `serve/chat`, then call
`invalidateChatCaches(store)` after committing redaction and clearing affected
live-run state. It clears every cache attached to that database, including cached
quotes, raw text, row indexes and prior snapshots, and wakes their subscribers.
Call it even if the redaction produces no turn event. Database change tracking is
also a fallback on the next page read. All writes use the agent's single writer;
another connection's writes require this hook.

## Verification and measurement

`pnpm remote test:agent test/serve` runs the cache tests, benchmark and existing
chat RPC tests. The randomized test compares every complete projection and five
window kinds with the frozen WP13b implementation in
`test/serve/full-rebuild.ts` (commit `b94ec99bd3`). It covers archive edits and
removal, redaction, read marks, source changes, live bubbles, card changes, retry
aliases, replies and rolled-back transactions. That reference is deliberately
independent of the cache implementation.

The benchmark seeds 5,000 synthetic messages in the real SQLite schema and keeps
a live run and a task card. Five alternating pairs of fresh Node processes measure
the original and cached projection. Each process warms up for ten events, then
measures 100 alternating reaction writes, status changes, card updates, live bubble appends
and read marks through
the encoded 40-row window. It checks the changed value on every iteration. No
provider, renderer, port or durable disk fsync is included; this measures the
agent's page preparation, not write-to-pixels latency.

The check fails above 5 ms p95 for queries after an in-place update, 50 ms p95 from
any event through
encoding, or 200 KB for the snapshot (`docs/performance.md`). It also caps retained
cache heap at 32 MiB. Memory is measured after explicit GC, relative to the seeded
process before creating its projection; RSS and peak RSS are reported separately.
Set `JUNO_CHAT_BENCH_REPORT` to save the JSON results. Set `JUNO_CHAT_PROFILE` to an
existing directory to capture one profiling pair instead of five timing pairs;
profiled timings are not comparison results.

## Results, 2026-10-15

Namespace Linux, 4 vCPU / 8 GB, Node 26.11.1, after merging main through
`404856c6`. Five alternating process pairs, 100 measured events per process.
Numbers below are medians of the five runs, with the run-to-run range in brackets.

- Event through encoded window, p95: **50.42 ms → 14.80 ms**
  ([45.18, 57.54] → [13.90, 19.57] ms). Median event time: 40.10 → 0.157 ms.
- In-place update query, p95: 49.76 → 0.129 ms
  ([46.55, 57.48] → [0.119, 0.181] ms).
- Append/read-mark event, p95: 51.19 → 15.42 ms
  ([43.07, 57.64] → [14.82, 23.02] ms).
- Retained projection heap after GC: 0.38 → 13.64 MiB. Median peak process RSS:
  351.00 → 291.12 MiB. RSS includes Node and SQLite; it is not Electron private
  memory. Retaining the history costs heap but avoids repeated large allocations.
- Encoded window: 7,026 bytes on both sides. All five cached runs passed the
  timing, payload and retained-heap checks; every event's visible result passed.

Separate CPU profiles on the M2 put most original-path samples in SQLite
statement preparation and reads. The remaining cached cost is the history walk
and memo lookups when an append or read mark changes layout. Profiled timings
were excluded from the numbers above.

Verification: the merged branch passed `pnpm affected` (typechecks, lint, affected
unit tests and desktop e2e) and `pnpm remote test:agent` (184 tests). The benchmark's
runner is a type dependency of its test, so `affected` follows changes to the
child script, fixture and full-rebuild reference as well as the cache.
