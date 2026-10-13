# @juno/sync

Slack into the store. Cold and warm boot, thread discovery, the merge rules, socket event application, read-state seeding and `reindexTopics`. See `docs/architecture.md` sections 4.4, 5 and 6, and ADRs 0004 and 0011.

## Public API

- `runSync({ onPhase })`: the whole sync for one session, until interrupted. Needs the Slack client (`SlackApi`, `SlackEdge`, `SlackSocket`, `SlackSession`) and the store (`StoreWriter`, `StoreReader`, `Invalidation`) in its context, plus a `Scope`. It opens the socket first, boots cold (empty cache) or warm (`sync_state.boot` present), then stays live: every event is one transaction, a reconnect runs the catch-up, a discovery sweep runs every ten minutes. It fails only with `SlackAuthRequired`; the engine then ends the session.
- `SyncPhase`: `booting`, `catching-up { done, total }`, `live`, `offline`. `onPhase` is called on every change; the engine folds it into `engine.status`.
- `SyncConfig` / `syncConfigLayer({ ... })`: the quiet window, page sizes, sweep interval, `discovery: 'search' | 'history'`.
- `reindexTopics(ids, { me })`, `reindexAll`: the one writer of `topic_index`. Call it at the end of any transaction that touched a topic's messages, reads or coverage. `topicsOfMessages(rows)` gives the ids a set of message rows belongs to.
- `mergeMessage`, `mergeTombstone`, `mergeRootCounters`, `stubRoot`, `toMessageRow`: the pure merge rules, for tests and for the outbox work to come.
- `syncKeys`: the invalidation keys the sync fires (`topics`, `{ topics: [id] }`, `{ messages: [topicId] }`, `conversations`, `users`, `team`, `channel_reads`, `thread_subs`, `{ topic_reads: [id] }`, `{ topic_overlay: [id] }`).

## What it decides

Beyond the architecture document, these are the rules the code settled:

- **Lanes.** `userBoot`, `prefs`, `counts` and `getView` run on the interactive lane (the sidebar is usable after them); history, replies, search and users on the background lane.
- **Read pointers.** The first time Juno sees a topic it takes Slack's pointer (`counts.last_read` for Main, the root's `last_read` for a followed thread). After that Juno's `topic_reads` is the state, and a server mark (a `*_marked` event, or a pointer in `counts` or `getView` seen after a disconnect) applies through the conflict rule of architecture 5.6. A thread the user does not follow has no pointer in Slack: at cold boot it starts read at its latest reply, so a first boot does not light up every old thread; one discovered later starts unread.
- **Exact counts.** A thread's `unread_count` is exact when every reply since the read pointer is stored: `thread_cursors.complete_from` records where coverage starts (a thread view stores every unread reply, so it is Slack's pointer), and a reply received as an event keeps it. Main is exact when a synced range covers everything since the pointer; otherwise the row carries `has_unreads` as a floor of one and `unread_exact = 0` (a dot, not a number).
- **Counters.** A root's `reply_count` and `latest_reply` take the maximum of what pages and events say and never go below the replies the store holds. A reply from a page that the root's counters never saw (a `message_replied` lost during a drop) queues a refetch of the root (`conversations.replies`, `limit: 1`). A deleted reply recounts the root from the store when the thread is complete, else drops the count by one.
- **Index rows carry what the row shows.** `preview_json` holds the sender, the stripped text, the sender id (so a rename applies at read time) and the first 240 characters of the root (the fallback title), so `topics.list` joins no `messages` row.
- **Discovery.** `search.modules.messages` with `is:thread after:<day before the gap>`, at most three pages of 50, members-only; matches merge as page messages without reaction state. The fake honours this; whether a real `xoxc` session does is still for the live smoke to confirm. `discovery: 'history'` is the fallback of architecture 5.3 (replies since the stored ones for roots whose `latest_reply` moved).
- **Users.** Ids referenced by messages and DMs with no `users` row are fetched from the edge in chunks of 100 after the history pages; the topics whose preview waited for a name are re-indexed when the users land.
- **Errors.** `SlackAuthRequired` ends the sync. Any other boot failure sets the phase to `offline` and retries after 30 s. A store error while applying one event is logged and the event is skipped, so one bad frame does not end the stream.

## Known gaps

- Edits, deletes and reactions that happen during a disconnect are recovered for threads by the search sweep (text) and otherwise only when the topic is opened (M4's refresh of the visible window). ADR 0011's `cached_latest_updates` path waits on the live smoke.
- A message first stored from a search match has no reaction state until a page or an event brings it.
- The sweep reads at most 150 matches per gap; a longer outage in a busy workspace misses older thread activity until the next sweep or open.
- `emojis/list`, the outbox, read-state mirroring and send reconciliation are later milestones; the tables and the conflict rule are in place.

## Must not

- Render anything or call AI. It depends on `@juno/slack`, `@juno/store`, `@juno/domain` and `@juno/slack-schema` only.
- Write `topic_index` anywhere but `reindex.ts`, or increment a counter in place.
- Let a socket event move `synced_ranges`; only pages extend them.
- Import `effect/sql` or `effect/reactivity`; the store's services are the only way to the database.

## Testing

`pnpm --filter @juno/sync test` runs the merge rule table (`test/merge.test.ts`). The sync itself is tested end to end in `packages/engine/test`: `sync.test.ts` (cold boot rows, call budget, warm boot, realtime, read marks, reopen, edits and deletes, offline and back), `convergence.test.ts` (seeded random events with drops; the store equals the fake and a full re-index changes nothing) and `plan.test.ts` (the sidebar statements never scan the guarded tables). `JUNO_BENCH=1` adds the large-seed benchmark in `test/bench`.
