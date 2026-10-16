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

WP16 (built) imports `invalidateChatCaches` from `serve/chat` and calls it right after a removal commits, before the change signal. The chat reads `removed_ops` and `removed_bubbles` (redaction's tables) for the Removed note and removed quotes, so a store the chat serves needs `REDACTION_MIGRATIONS`. The contract for any other caller: import `invalidateChatCaches` from `serve/chat`, then call
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
a live run and a task card. Its Vitest project runs after the other agent tests,
with file parallelism off, so their child processes do not compete with its timer.
The 5 ms and 50 ms p95 limits still apply to every run. Five alternating pairs of fresh Node processes measure
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

## Results, 2026-10-17

Namespace Linux, 8 vCPU / 16 GB (the standard shape), cached runs only. On 10-17
the event p95 had risen to 30.2 to 46.7 ms per run on 8x16 (median 38.9 of 50,
append and read-mark p95 37 to 51 ms), and one run on batch-28 read 50.199 ms.
An A/B on 8x16 found no single commit: `db08b6d2` (before the rich text merge)
gave 19.8 to 30.1 ms, `3cf179f0` (after it) 20.3 to 23.3 ms and main `9c1744fc`
24.1 to 35.4 ms, on the same code that gave about 12 ms on 2x4 machines on 10-16.
The rich text merge already parsed a bubble once per spans array; joining its
text on every rebuild was about 4% of the profile.

The p95 is an append or read mark: 40 of the 100 events walk all 5,000 rows.
That walk built a key string per row for each memo, the reaction lookup, the
group position and the row index; spread each run's archive rows into a memo
input; stringified each row's reactions; and read the day of every entry. It
now keys rows by their own ids, keeps unchanged runs' rows and reactions as the
same arrays so memos compare them by identity, records a memo key's last pass
instead of adding it to a set, checks each entry against the current day's
range, and makes a bubble's text once with its blocks.

`pnpm flake packages/agent/test/serve/chat-cache.bench.test.ts --repeat 10
--machines 1`, 50 single-run p95s:

- Event through encoded window, p95: **10.5 to 21.2 ms, median 14.3**
  (before: 30.2 to 46.7, median 38.9).
- Append/read-mark event, p95: 11.7 to 23.9 ms, median 17.0 (before: 37 to 51).
- In-place update query, p95: 0.1 to 0.3 ms.
- Retained projection heap: 13.8 MiB, unchanged.

The chat-bubble time map is still read again after each append; reading only
new rows would be wrong after a rolled-back transaction.

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
