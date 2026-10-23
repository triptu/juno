import missedHuddles from './202610201700_missed_huddles'
import notificationDecidedBy from './202610232300_notification_decided_by'
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
import startedThreads from './202610171001_started_threads'
import keptCopies from './202610170900_kept_copies'
import noNotificationSummary from './202610171000_no_notification_summary'
import outboxIds from './202610171200_outbox_ids'
import sentPostsOwnDelete from './202610171300_sent_posts_own_delete'
import viewColors from './202610171400_view_colors'
import aiCalls from './202610180900_ai_calls'
import automatedReason from './202610180930_automated_reason'
import uploadedFiles from './202610181000_uploaded_files'
import aiRefusals from './202610181130_ai_refusals'
import aiTitleVersion from './202610181500_ai_title_version'
import automatedMoves from './202610181600_automated_moves'
import reviewKeeps from './202610181900_review_keeps'
import keptSuggestions from './202610182100_kept_suggestions'
import noAiTitleVersion from './202610182200_no_ai_title_version'
import agentApprovals from './202610182230_agent_approvals'
import forwards from './202610191200_forwards'

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
  '202610171000_no_notification_summary': noNotificationSummary,
  '202610171001_started_threads': startedThreads,
  '202610171200_outbox_ids': outboxIds,
  '202610171300_sent_posts_own_delete': sentPostsOwnDelete,
  '202610171400_view_colors': viewColors,
  '202610180900_ai_calls': aiCalls,
  '202610180930_automated_reason': automatedReason,
  '202610181000_uploaded_files': uploadedFiles,
  '202610181130_ai_refusals': aiRefusals,
  '202610181500_ai_title_version': aiTitleVersion,
  '202610181600_automated_moves': automatedMoves,
  '202610181900_review_keeps': reviewKeeps,
  '202610182100_kept_suggestions': keptSuggestions,
  '202610182200_no_ai_title_version': noAiTitleVersion,
  '202610182230_agent_approvals': agentApprovals,
  '202610191200_forwards': forwards,
  '202610201700_missed_huddles': missedHuddles,
  '202610232300_notification_decided_by': notificationDecidedBy,
}
