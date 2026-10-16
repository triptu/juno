import type { Effect } from 'effect'
import type { SqlClient } from 'effect/sql'
import dropForYouCards from './202610160200_drop_for_you_cards'
import initial from './202610121200_initial'
import overlayPinned from './202610131000_overlay_pinned'
import search from './202610140100_search'
import readMirror from './202610141200_read_mirror'
import notifications from './202610151000_notifications'
import topicArt from './202610141300_topic_art'
import agentAttempts from './202610151200_agent_attempts'
import postOutbox from './202610151500_post_outbox'
import home from './202610151600_home'
import sidebarViews from './202610151730_sidebar_views'
import agentResolves from './202610160100_agent_resolves'
import automatedView from './202610152300_automated_view'
import sentPosts from './202610161000_sent_posts'
import keptCopies from './202610170900_kept_copies'
import outboxIds from './202610171000_outbox_ids'
import sentPostsOwnDelete from './202610171100_sent_posts_own_delete'

/**
 * Migrations for `user.db`, keyed `<timestamp>_<name>`. Add a file per change
 * with a new timestamp id and list it here; the Migrator runs the ones not yet
 * recorded, in id order. Never edit a migration that has shipped.
 */
export const userMigrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {
  '202610121200_initial': initial,
  '202610131000_overlay_pinned': overlayPinned,
  '202610140100_search': search,
  '202610141200_read_mirror': readMirror,
  '202610141300_topic_art': topicArt,
  '202610151000_notifications': notifications,
  '202610151200_agent_attempts': agentAttempts,
  '202610151500_post_outbox': postOutbox,
  '202610151600_home': home,
  '202610151730_sidebar_views': sidebarViews,
  '202610152300_automated_view': automatedView,
  '202610160100_agent_resolves': agentResolves,
  '202610160200_drop_for_you_cards': dropForYouCards,
  '202610161000_sent_posts': sentPosts,
  '202610170900_kept_copies': keptCopies,
  '202610171000_outbox_ids': outboxIds,
  '202610171100_sent_posts_own_delete': sentPostsOwnDelete,
}
