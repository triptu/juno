import { junoSettingsNow } from '@juno/state/agent'
import { openSettings } from './navigation'
import { topicMenuItems, type ContextMenuAt, type TopicMenuAction } from '@juno/contract'
import { redrawTopic, showToast, type RedrawProblem, canRedraw, currentNotificationSettings, junoAvailableAtom, loadNotificationSettings, popupContextMenu, registry, type RenameTarget } from '@juno/state'
import { choiceFor, nativeMenu } from './notifyActions'
import { viewChoices } from './viewActions'
import { huddleMenuItem } from './huddle/menuItem'
import { labelOf, isLinkable, notifyTarget, runTopicAction } from './topicActions'
import type { ActionTopic } from './topicSource'

const dmPartner = (topic: ActionTopic) => topic.channel.kind === 'im' ? topic.channel.partner : undefined

/**
 * The topic menu (inventory 15.1), on a sidebar row and the header's title,
 * at the pointer or at `at`. `from` says which title Rename edits. Notify me
 * on a thread is how it is followed: Always and Auto
 * follow it in Slack, Never unfollows it (SPEC 5). On Main it is the
 * channel's or DM's choice.
 */
export async function showTopicMenu(topic: ActionTopic, from: RenameTarget['where'], at?: ContextMenuAt): Promise<void> {
  // Redraw art shows only when a drawing can be made: asked beside the settings, within a fraction of a second.
  const drawable = canRedraw(registry)
  const settings = currentNotificationSettings(registry) ?? (await loadNotificationSettings(registry))
  const notify = notifyTarget(topic)
  const huddle = huddleMenuItem(topic.channel)
  const state = {
    kind: topic.kind,
    channel: topic.channel,
    unread: topic.unreadCount > 0,
    pinned: topic.pinned,
    resolved: topic.resolved,
    notify: choiceFor(settings, notify.target, topic.subscribed),
    canDraw: settings?.aiAssist === true && (await drawable),
    // Add to view (inventory 15.8) is on Main: the row's channel or DM.
    ...(topic.kind === 'main' ? { views: viewChoices(topic.channel.id) } : {}),
    ...(huddle === undefined ? {} : { huddle }),
    ...(dmPartner(topic) !== undefined && registry.get(junoAvailableAtom) ? { knowsAbout: dmPartner(topic)!.name } : {}),
  }
  const chosen = (await popupContextMenu(nativeMenu(topicMenuItems(state), (id) => isLinkable(topic) || (id !== 'copy-link' && id !== 'open-in-slack')), at)) as TopicMenuAction | undefined
  if (chosen !== undefined) runTopicAction(topic, chosen, from)
}


/** Why Redraw art made nothing, said plainly. */
const REDRAW_PROBLEMS: Record<RedrawProblem, string> = {
  off: 'AI assist is off',
  budget: 'Today’s AI limit is reached',
  'no-key': 'Add an OpenRouter key in Settings › Juno',
  'no-agent': 'Juno’s agent did not answer the daily limit check',
  timeout: 'The model took too long',
  provider: 'The model service returned an error',
  invalid: 'The model’s drawing could not be used',
  other: 'Something went wrong',
}

/** Redraw art: a new drawing from the model, which takes a few seconds; the undo puts the old one back. */
export async function redrawArt(topic: ActionTopic): Promise<void> {
  const problem = await redrawTopic(registry, topic.id, { text: `Redrawn · ${labelOf(topic)}` })
  if (problem === 'budget') showToast(registry, { text: await limitReached(), action: { label: 'Change limit', onAction: () => openSettings('ai-activity') } })
  else if (problem !== undefined) showToast(registry, { text: `Could not redraw · ${REDRAW_PROBLEMS[problem]}` })
}

const dollars = (value: number): string => `$${value.toFixed(2)}`

/**
 * Which limit stopped a call, from the agent's ledger: today's limit, or the
 * half of it that topic art, titles and Home may use.
 */
async function limitReached(): Promise<string> {
  const page = await junoSettingsNow(registry)
  if (page === undefined) return `Could not redraw · ${REDRAW_PROBLEMS.budget}`
  if (page.spentTodayUsd < page.limitTodayUsd && page.backgroundTodayUsd >= page.backgroundLimitUsd) {
    return `Topic art and titles have used their ${dollars(page.backgroundLimitUsd)} of today’s ${dollars(page.limitTodayUsd)} AI limit`
  }
  return `Today’s AI limit of ${dollars(page.limitTodayUsd)} is reached`
}
