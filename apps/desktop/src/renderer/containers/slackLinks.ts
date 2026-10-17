/**
 * Slack links in messages (SPEC 8, "Links"). A link to a message, a channel
 * or a person in the signed-in workspace opens inside Juno; any other link
 * opens outside, as before.
 *
 * - A message opens in its topic, at the message, which flashes, the way a
 *   search result lands: a reply in its thread, any other message in its
 *   channel's Main. One the store does not have is fetched first, with the
 *   page that ends at it.
 * - A click opens a new tab, so the message the link was in stays in its
 *   own; ⌘-click opens the tab behind the current one. A tab that already
 *   shows the topic is used instead of a second one.
 * - A conversation Juno does not have, or one Slack refuses, opens in the
 *   browser (or in Slack, for a `slack://` link) with a toast saying why.
 */
import type { ActivateEvent, LinkInfo } from '@juno/views'
import {
  locateMessage,
  locatePerson,
  loadOlderMessages,
  openExternal,
  openInSlack,
  parseSlackLink,
  registry,
  showToast,
  signedInAtom,
  tabsAtom,
  tabShowing,
  type SlackLinkMatch,
  type SlackLinkTarget,
} from '@juno/state'
import { newMessage, openTopic, openTopicAt, openTopicAtInBackground, openTopicInBackground } from './navigation'

/** The ts just after `ts`, so a page fetched "before" it includes it. */
export function justAfter(ts: string): string {
  const [seconds = '0', micros = '0'] = ts.split('.')
  const next = Number(micros) + 1
  return next >= 1_000_000 ? `${Number(seconds) + 1}.000000` : `${seconds}.${String(next).padStart(6, '0')}`
}

/** The link read against the signed-in workspace; undefined for a link that is not to Slack, or when signed out. */
function read(url: string): SlackLinkMatch | undefined {
  const session = registry.get(signedInAtom)
  return session === undefined ? undefined : parseSlackLink(url, { url: session.workspaceUrl, teamId: session.teamId })
}

const isMain = (topicId: string) => topicId.startsWith('m:')

/**
 * The topic a message link opens: a reply's thread, else Main. The store
 * places a thread's root in its thread; a link to the root opens Main, where
 * the root sits with its thread link under it.
 */
async function messageTopic(target: Extract<SlackLinkTarget, { kind: 'message' }>) {
  const located = await locateMessage(registry, target.channel, target.ts, target.threadTs)
  if (located._tag !== 'Success') return undefined
  const { topicId, stored, place } = located.value
  const rootLink = target.threadTs === undefined && topicId === `t:${target.channel}:${target.ts}`
  return { topicId: rootLink ? `m:${target.channel}` : topicId, stored, place }
}

/** Where an in-app link goes, for its hover text: "#eng · Thread", "#eng · Main" or the person's name. */
async function describe(url: string): Promise<string | undefined> {
  const match = read(url)
  if (match?.ours !== true) return undefined
  const { target } = match
  switch (target.kind) {
    case 'person': {
      const found = await locatePerson(registry, target.user)
      return found._tag === 'Success' ? found.value.person?.name : undefined
    }
    case 'channel': {
      const located = await locateMessage(registry, target.channel, undefined)
      return located._tag === 'Success' && located.value.place !== undefined ? `${located.value.place} · Main` : undefined
    }
    case 'message': {
      const topic = await messageTopic(target)
      return topic?.place === undefined ? undefined : `${topic.place} · ${isMain(topic.topicId) ? 'Main' : 'Thread'}`
    }
  }
}

/** Opens the link outside the app with a toast saying why Juno did not: the browser, or Slack for a `slack://` link. */
function openOutside(url: string, match: SlackLinkMatch, why: string): void {
  const channel = match.target.kind === 'person' ? undefined : match.target.channel
  if (url.startsWith('slack:') && match.teamId !== undefined && channel !== undefined) {
    openInSlack({ teamId: match.teamId, channelId: channel })
    showToast(registry, { text: `${why} · Opened in Slack` })
    return
  }
  openExternal(url)
  showToast(registry, { text: `${why} · Opened in the browser` })
}

/** A topic, in a new tab (behind the current one with ⌘), or the tab that already shows it; at `ts` when given, which flashes. */
function openLinked(topicId: string, ts: string | undefined, event: ActivateEvent): void {
  const shown = tabShowing(registry.get(tabsAtom), topicId) !== undefined
  if (ts === undefined) {
    if (event.metaKey && !shown) openTopicInBackground(topicId)
    else openTopic(topicId, { newTab: !shown })
    return
  }
  if (event.metaKey && !shown) openTopicAtInBackground(topicId, ts)
  else openTopicAt(topicId, ts, { newTab: !shown, flash: true })
}

const NO_CONVERSATION = 'Juno cannot reach that conversation'

async function openSlackLink(url: string, match: SlackLinkMatch, event: ActivateEvent): Promise<void> {
  const { target } = match
  switch (target.kind) {
    case 'person': {
      const found = await locatePerson(registry, target.user)
      const person = found._tag === 'Success' ? found.value : undefined
      if (person?.person === undefined) return openOutside(url, match, 'Juno does not know that person')
      if (person.mainId !== undefined) return openLinked(person.mainId, undefined, event)
      newMessage({ key: `u:${target.user}`, name: person.person.name, kind: 'im', tint: 'dm', person: person.person, empty: true })
      return
    }
    case 'channel': {
      const located = await locateMessage(registry, target.channel, undefined)
      if (located._tag !== 'Success' || located.value.place === undefined) return openOutside(url, match, NO_CONVERSATION)
      return openLinked(located.value.topicId, undefined, event)
    }
    case 'message': {
      const topic = await messageTopic(target)
      if (topic?.place === undefined) return openOutside(url, match, NO_CONVERSATION)
      if (!topic.stored) {
        const loaded = await loadOlderMessages(registry, topic.topicId, justAfter(target.ts))
        if (loaded._tag === 'Success' && loaded.value.outcome === 'rejected') return openOutside(url, match, NO_CONVERSATION)
      }
      return openLinked(topic.topicId, target.ts, event)
    }
  }
}

/** A click on a link in a message: inside Juno for a Slack link to this workspace, else outside. */
export function openMessageLink(url: string, event: ActivateEvent): void {
  const match = read(url)
  if (match?.ours === true) {
    void openSlackLink(url, match, event)
    return
  }
  // Another workspace's deep link opens in Slack; main opens only web links.
  if (match !== undefined && match.teamId !== undefined && url.startsWith('slack:') && match.target.kind !== 'person') {
    openInSlack({ teamId: match.teamId, channelId: match.target.channel })
    return
  }
  openExternal(url)
}

/** For `MessageBody`: which links open inside Juno, and where they go. One object for the app's life (performance 5.1). */
export const messageLinkInfo: LinkInfo = {
  inApp: (url) => read(url)?.ours === true,
  describe,
}
