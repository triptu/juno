/**
 * The two buttons of Home's Unfollow and Ignore reviews (SPEC 12,
 * `docs/design/settled-suggestions/`).
 */
import { Exit } from 'effect'
import { channelsIgnore, notificationsSetLevel, topicsKeepSuggested, type CommandResult, type HomeTopic, type UndoCommand } from '@juno/contract'
import type { Registry } from './client'
import { runActionExit } from './undo'

/**
 * One row of the Unfollow or Ignore review: Unfollow (Notify me Never,
 * which unfollows in Slack) or Ignore channel, or Keep following or Keep
 * showing; each with its toast and Undo. Resolves with the undo, or
 * undefined when nothing changed. For Ignore the topic is the channel's Main.
 */
export async function actOnSuggested(registry: Registry, suggestion: 'unfollow' | 'ignore', topic: HomeTopic, action: 'act' | 'keep'): Promise<UndoCommand | undefined> {
  const exit =
    action === 'keep'
      ? await runActionExit(registry, topicsKeepSuggested, { id: topic.id, suggestion }, { text: suggestion === 'unfollow' ? `Still following · ${topic.title}` : `Still showing ${topic.title}` })
      : suggestion === 'unfollow'
        ? await runActionExit(registry, notificationsSetLevel, { target: { kind: 'thread', id: topic.id }, choice: 'never' }, { text: `Unfollowed · ${topic.title}` })
        : await runActionExit(registry, channelsIgnore, { channel: topic.id.replace(/^m:/, '') }, { text: `Ignoring ${topic.title}` })
  return Exit.isSuccess(exit) ? (exit.value as CommandResult).undo : undefined
}
