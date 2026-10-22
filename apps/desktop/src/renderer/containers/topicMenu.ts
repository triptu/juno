import { junoNavAtom, watchReply, junoSettingsNow } from '@juno/state/agent'
import { openSettings } from './navigation'
import { whyLabel, type ContextMenuItem, type MessageView, topicMenuItems, type ContextMenuAt, type TopicMenuAction } from '@juno/contract'
import { broadcastMessage, copyText, loadWhy, messageLink, signedInAtom, redrawTopic, showToast, type RedrawProblem, canRedraw, currentNotificationSettings, junoAvailableAtom, loadNotificationSettings, popupContextMenu, registry, type RenameTarget } from '@juno/state'
import { choiceFor, nativeMenu, showPersonMenu, showWhy } from './notifyActions'
import { viewChoices } from './viewActions'
import { huddleMenuItem } from './huddle/menuItem'
import { openTopicInSlack, type MessageMenuChoice, labelOf, isLinkable, notifyTarget, runTopicAction, type ActionTopic } from './topicActions'

const dmPartner = (topic: ActionTopic) => topic.channel.kind === 'im' ? topic.channel.partner : undefined

/**
 * The topic menu (inventory 15.1), on a sidebar row and the header's title,
 * at the pointer or at `at`. `from` says which title Rename edits. Notify me
 * on a thread is how it is followed: Every message and When it matters
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


/**
 * "Also send to #eng" on your own thread reply, as Slack's "Send reply to
 * this channel"; "Also send to Main" in a DM or group DM, whose Main is the
 * conversation. Slack has threads in all four kinds.
 */
function broadcastLabel(channel: Pick<ActionTopic['channel'], 'kind' | 'name'>): string {
  return channel.kind === 'public' || channel.kind === 'private' ? `Also send to #${channel.name}` : 'Also send to Main'
}

/**
 * The message menu (SPEC 7 "More", inventory 15.4 and 15.6), from the
 * toolbar's More and from a right-click: Edit and Delete on your own
 * messages, and on your own reply in a thread Also send to #eng, unless it
 * already was; Start thread or Open thread in Main, View reactions, Forward…, Copy Slack link and Open in Slack,
 * and, on someone else's message, why it did or did not notify. A reply's
 * link carries its thread; a message Slack does not have yet has none. On
 * the sender's name or avatar it is the person menu.
 */
export async function showMessageMenu(
  topic: ActionTopic,
  message: Pick<MessageView, 'ts' | 'pending' | 'thread' | 'kind' | 'root' | 'broadcast' | 'reactions'>,
  editable: boolean,
  at: ContextMenuAt,
  sender: { readonly id: string; readonly name: string } | undefined,
  onSender: boolean,
): Promise<MessageMenuChoice | undefined> {
  const session = registry.get(signedInAtom)
  const own = sender !== undefined && sender.id === session?.userId
  if (onSender && sender !== undefined && !own) {
    await showPersonMenu(sender, at)
    return undefined
  }
  const { ts } = message
  const linkable = message.pending === undefined
  const why = own || !linkable ? undefined : await loadWhy(registry, topic.id, ts)
  // Only a reply Slack has, as Slack's own client offers it.
  const broadcastable = own && topic.kind === 'thread' && linkable && message.kind === 'message' && !message.root && !message.broadcast
  const items: ContextMenuItem[] = [
    ...(editable ? [{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete' }] : []),
    ...(broadcastable ? [{ id: 'broadcast', label: broadcastLabel(topic.channel) }] : []),
    ...(editable || broadcastable ? [{ separator: true } as const] : []),
    ...(topic.kind === 'main' && linkable ? [{ id: 'reply', label: message.thread === undefined ? 'Start thread' : 'Open thread' }, { separator: true } as const] : []),
    ...(own && linkable ? [{ id: 'watch-reply', label: 'Tell me if nobody replies', enabled: registry.get(junoNavAtom).mayAuthorize === true }] : []),
    // The keyboard's way to the reactions dialog; the pointer also has the card's See all.
    ...(message.reactions.length > 0 ? [{ id: 'reactions', label: 'View reactions' }] : []),
    // Only a message Slack has can be shared, as only it has a link.
    { id: 'forward', label: 'Forward…', ...(linkable && message.kind === 'message' ? {} : { enabled: false }) },
    { id: 'copy-link', label: 'Copy Slack link', ...(linkable ? {} : { enabled: false }) },
    { id: 'open-in-slack', label: 'Open in Slack' },
    ...(why === undefined ? [] : [{ separator: true } as const, { id: 'why', label: whyLabel(why.notified) }]),
  ]
  const chosen = await popupContextMenu(items, at)
  if (chosen === 'edit' || chosen === 'delete' || chosen === 'reply' || chosen === 'forward' || chosen === 'reactions') return chosen
  // Main shows the reply at once and the thread marks it; the outbox sends it. The engine refuses a reply deleted meanwhile.
  if (chosen === 'broadcast') void broadcastMessage(registry, { channelId: topic.channel.id, ts })
  if (chosen === 'watch-reply') await watchReply(registry, { channelId: topic.channel.id, ts, ...(topic.kind === 'thread' && topic.rootTs ? { threadTs: topic.rootTs } : {}) })
  else if (chosen === 'open-in-slack') openTopicInSlack(topic)
  else if (chosen === 'why' && why !== undefined) showWhy(topic.id, ts, why, at)
  else if (chosen === 'copy-link' && session !== undefined) copyText(messageLink(session.workspaceUrl, topic.channel.id, ts, topic.kind === 'thread' ? topic.rootTs : undefined))
  return undefined
}

