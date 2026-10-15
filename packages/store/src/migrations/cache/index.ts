import type { Effect } from 'effect'
import type { SqlClient } from 'effect/sql'
import botSender from './202610160200_bot_sender'
import initial from './202610121200_initial'
import topicIndexes from './202610131000_topic_indexes'
import threadSubsEventTs from './202610131800_thread_subs_event_ts'
import search from './202610140100_search'
import threadSubsCommanded from './202610140900_thread_subs_commanded'
import mainWindow from './202610141000_main_window'

/**
 * Schema version of `cache.db`, stored in `PRAGMA user_version`. A cache file
 * with a different version is deleted and recreated when the store opens, and
 * the engine re-syncs. Bump it with every change to the cache migrations; the
 * mirror is disposable, so its migrations only ever run on an empty file and
 * never transform data (ADR 0008).
 */
export const CACHE_SCHEMA_VERSION = 7

/** Migrations for `cache.db`, keyed `<timestamp>_<name>`. */
export const cacheMigrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {
  '202610121200_initial': initial,
  '202610131000_topic_indexes': topicIndexes,
  '202610131800_thread_subs_event_ts': threadSubsEventTs,
  '202610140100_search': search,
  '202610140900_thread_subs_commanded': threadSubsCommanded,
  '202610141000_main_window': mainWindow,
  '202610160200_bot_sender': botSender,
}
