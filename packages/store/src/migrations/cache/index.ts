import messageAttention from './202610201300_message_attention'
import mutationRepair from './202610190100_mutation_repair'
import avatarSizes from './202610171000_avatar_sizes'
import usergroups from './202610171200_usergroups'
import partialMessages from './202610171300_partial_messages'
import automatedHolds from './202610172300_automated_holds'
import type { Effect } from 'effect'
import type { SqlClient } from 'effect/sql'
import integrationSearch from './202610160300_integration_search'
import frequentSends from './202610160310_frequent_sends'
import recheckedTopics from './202610170910_rechecked_topics'
import botSender from './202610160200_bot_sender'
import initial from './202610121200_initial'
import topicIndexes from './202610131000_topic_indexes'
import threadSubsEventTs from './202610131800_thread_subs_event_ts'
import search from './202610140100_search'
import threadSubsCommanded from './202610140900_thread_subs_commanded'
import mainWindow from './202610141000_main_window'

/**
 * Reset epoch of `cache.db`, stored in `PRAGMA user_version`. A cache file
 * with another epoch is deleted and recreated when the store opens, and the
 * engine syncs everything from Slack again. Schema changes do not touch it:
 * they are migrations that run on the existing file and keep its rows.
 * Change it only for a change that cannot be migrated, together with a
 * decision fragment that says "cache reset epoch N" and why
 * (`scripts/check-cache-epoch.mjs`, ADR 0008).
 * A stored column that only changes meaning needs no migration: `@juno/sync`
 * `INDEX_VERSION` re-indexes it from local messages.
 */
export const CACHE_RESET_EPOCH = 10

/**
 * Migrations for `cache.db`, keyed `<timestamp>_<name>`. They run on a
 * populated cache, so each one keeps existing rows (store README, "Cache
 * migrations"). A new id must be later than every id here: the Migrator
 * skips ids at or below the newest one it has recorded.
 */
export const cacheMigrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {
  '202610121200_initial': initial,
  '202610131000_topic_indexes': topicIndexes,
  '202610131800_thread_subs_event_ts': threadSubsEventTs,
  '202610140100_search': search,
  '202610140900_thread_subs_commanded': threadSubsCommanded,
  '202610141000_main_window': mainWindow,
  '202610160200_bot_sender': botSender,
  '202610160300_integration_search': integrationSearch,
  '202610160310_frequent_sends': frequentSends,
  '202610170910_rechecked_topics': recheckedTopics,
  '202610171000_avatar_sizes': avatarSizes,
  '202610171200_usergroups': usergroups,
  '202610171300_partial_messages': partialMessages,
  '202610172300_automated_holds': automatedHolds,
  '202610190100_mutation_repair': mutationRepair,
  '202610201300_message_attention': messageAttention,
}
