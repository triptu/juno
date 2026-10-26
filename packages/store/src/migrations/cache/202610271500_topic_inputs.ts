import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * `topic_inputs`: the topics whose `topic_index` row is up to date with what
 * `reindexTopics` (`@juno/sync`) reads from this file, so a re-index of one
 * can stop after reading the marker. `context` is the index rule's version
 * and the user the row was computed for; `reads` is the topic's read state
 * from user.db, which no trigger here can see, compared on every re-index.
 *
 * The triggers delete a marker whenever an input of its topic changes:
 * - a message row, for its thread (`thread_ts`, or its own `ts` for a root)
 *   and, for a root or a broadcast, its channel's Main;
 * - a thread's ranges, except a tail moving between `live` and `held`,
 *   which count the same (`countExact`);
 * - a channel's newest synced range and its counts in `channel_reads`;
 * - the topic's own row, when anything else writes it;
 * - any stored name (people, user groups, conversations) or a
 *   conversation's kind, for every topic: a preview names whoever it
 *   mentions.
 * The table starts empty, so every topic is re-indexed once more after this
 * migration.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE topic_inputs (topic_id TEXT PRIMARY KEY, context TEXT NOT NULL, reads TEXT NOT NULL) WITHOUT ROWID`

  // A message's topics, as `reindexTopics` reads them: its thread (a root is its own) and, for a root or a broadcast, Main.
  const topicsOf = (row: 'NEW' | 'OLD') =>
    `'t:' || ${row}.channel || ':' || COALESCE(${row}.thread_ts, ${row}.ts),
      CASE WHEN ${row}.thread_ts IS NULL OR ${row}.thread_ts = ${row}.ts OR ${row}.subtype = 'thread_broadcast' THEN 'm:' || ${row}.channel END`
  yield* sql.unsafe(`CREATE TRIGGER topic_inputs_message_insert AFTER INSERT ON messages
    BEGIN DELETE FROM topic_inputs WHERE topic_id IN (${topicsOf('NEW')}); END`)
  yield* sql.unsafe(`CREATE TRIGGER topic_inputs_message_delete AFTER DELETE ON messages
    BEGIN DELETE FROM topic_inputs WHERE topic_id IN (${topicsOf('OLD')}); END`)
  yield* sql.unsafe(`CREATE TRIGGER topic_inputs_message_update AFTER UPDATE ON messages
    BEGIN DELETE FROM topic_inputs WHERE topic_id IN (${topicsOf('OLD')}, ${topicsOf('NEW')}); END`)

  yield* sql`CREATE TRIGGER topic_inputs_thread_range_insert AFTER INSERT ON thread_ranges
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 't:' || NEW.channel || ':' || NEW.thread_ts; END`
  yield* sql`CREATE TRIGGER topic_inputs_thread_range_delete AFTER DELETE ON thread_ranges
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 't:' || OLD.channel || ':' || OLD.thread_ts; END`
  yield* sql`CREATE TRIGGER topic_inputs_thread_range_update AFTER UPDATE ON thread_ranges
    WHEN OLD.kind IS NOT NEW.kind OR OLD.from_ts IS NOT NEW.from_ts OR OLD.to_ts IS NOT NEW.to_ts OR OLD.heard_ts IS NOT NEW.heard_ts
      OR (OLD.tail = 'none') IS NOT (NEW.tail = 'none')
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 't:' || NEW.channel || ':' || NEW.thread_ts; END`

  yield* sql`CREATE TRIGGER topic_inputs_synced_range_insert AFTER INSERT ON synced_ranges
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 'm:' || NEW.channel; END`
  yield* sql`CREATE TRIGGER topic_inputs_synced_range_delete AFTER DELETE ON synced_ranges
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 'm:' || OLD.channel; END`
  yield* sql`CREATE TRIGGER topic_inputs_synced_range_update AFTER UPDATE ON synced_ranges
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 'm:' || NEW.channel; END`

  yield* sql`CREATE TRIGGER topic_inputs_channel_reads_insert AFTER INSERT ON channel_reads
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 'm:' || NEW.channel; END`
  yield* sql`CREATE TRIGGER topic_inputs_channel_reads_delete AFTER DELETE ON channel_reads
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 'm:' || OLD.channel; END`
  yield* sql`CREATE TRIGGER topic_inputs_channel_reads_update AFTER UPDATE ON channel_reads
    WHEN OLD.latest IS NOT NEW.latest OR OLD.has_unreads IS NOT NEW.has_unreads OR OLD.mention_count IS NOT NEW.mention_count
    BEGIN DELETE FROM topic_inputs WHERE topic_id = 'm:' || NEW.channel; END`

  yield* sql`CREATE TRIGGER topic_inputs_index_update AFTER UPDATE ON topic_index
    BEGIN DELETE FROM topic_inputs WHERE topic_id = NEW.topic_id; END`
  yield* sql`CREATE TRIGGER topic_inputs_index_delete AFTER DELETE ON topic_index
    BEGIN DELETE FROM topic_inputs WHERE topic_id = OLD.topic_id; END`

  const names = {
    users: 'OLD.name IS NOT NEW.name OR OLD.display_name IS NOT NEW.display_name OR OLD.real_name IS NOT NEW.real_name',
    usergroups: 'OLD.handle IS NOT NEW.handle OR OLD.name IS NOT NEW.name',
    conversations: 'OLD.name IS NOT NEW.name OR OLD.kind IS NOT NEW.kind',
  }
  for (const [table, changed] of Object.entries(names)) {
    // A marked row found every person and group it looked for (`reindex.ts`), so a new one cannot change it.
    if (table === 'conversations') yield* sql.unsafe(`CREATE TRIGGER topic_inputs_${table}_insert AFTER INSERT ON ${table} BEGIN DELETE FROM topic_inputs; END`)
    yield* sql.unsafe(`CREATE TRIGGER topic_inputs_${table}_delete AFTER DELETE ON ${table} BEGIN DELETE FROM topic_inputs; END`)
    yield* sql.unsafe(`CREATE TRIGGER topic_inputs_${table}_update AFTER UPDATE ON ${table} WHEN ${changed} BEGIN DELETE FROM topic_inputs; END`)
  }
})
