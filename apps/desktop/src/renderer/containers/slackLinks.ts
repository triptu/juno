/**
 * Slack links in messages (SPEC 8, "Links"). A link to a message, a channel
 * or a person in the signed-in workspace opens inside Juno. Any other web
 * link opens in the web panel beside the topic, or in the browser with ⌘
 * (`openWebLink`).
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
 * - A click on a person in a message opens them as a link to them does
 *   (`openPerson`), and a click on a #channel chip opens the channel as a
 *   link to it does (`openChannel`): its Main, a preview for a public
 *   channel the user is not in.
 * - An answer that comes after the user went elsewhere (a slow fetch, a tab
 *   switch meanwhile), or after a later link was clicked, opens nothing
 *   (`movedOn`): the tab and the composer's focus stay where the user is.
 */
import type { ActivateEvent, LinkInfo } from '@juno/views'
import {
  channelLink,
  locateMessage,
  locatePerson,
  loadMessageAt,
  openExternal,
  openInSlack,
  openWebPanel,
  parseSlackLink,
  registry,
  showToast,
  signedInAtom,
  tabsAtom,
  tabShowing,
  traceSend,
  type SlackLinkMatch,
  type SlackLinkTarget,
} from '@juno/state'
import { movedOn, newMessage, openTopic, openTopicAt, openTopicAtInBackground, openTopicInBackground, shown, type Shown } from './navigation'
import { readingOnly } from './readingOnly'

/** The link read against the signed-in workspace; undefined for a link that is not to Slack, or when signed out. */
function read(url: string): SlackLinkMatch | undefined {
  const session = registry.get(signedInAtom)
  return session === undefined ? undefined : parseSlackLink(url, { url: session.workspaceUrl, teamId: session.teamId })
}

/** Which navigation path a message link uses before modifier keys are applied. */
export function messageLinkKind(url: string): 'juno' | 'web' | 'browser' {
  const match = read(url)
  return match?.ours === true ? 'juno' : match === undefined ? 'web' : 'browser'
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

/** A topic, in a new tab (`behind` the current one, with ⌘), or the tab that already shows it; at `ts` when given, which flashes. */
function openLinked(topicId: string, ts: string | undefined, behind: boolean): void {
  const shown = tabShowing(registry.get(tabsAtom), topicId) !== undefined
  if (ts === undefined) {
    if (behind && !shown) openTopicInBackground(topicId)
    else openTopic(topicId, { newTab: !shown })
    return
  }
  if (behind && !shown) openTopicAtInBackground(topicId, ts)
  else openTopicAt(topicId, ts, { newTab: !shown, flash: true })
}

const NO_CONVERSATION = 'Juno cannot reach that conversation'

/** Whether the answer came too late to act on: the user went elsewhere since `since`. */
function late(since: Shown, link: string): boolean {
  if (!movedOn(since)) return false
  traceSend('link dropped', () => ({ link }))
  return true
}

/**
 * A person, from a link to them or a click on them in a message (SPEC 7 and
 * 8): your DM with them at its Main, as a link to a topic opens it, or Home
 * addressed to them when you have never messaged them; with ⌘, either opens
 * behind the current tab. Reading only, there is no Home, so a person
 * never messaged opens nothing. False when Juno does not know them.
 */
export async function openPerson(user: string, behind: boolean): Promise<boolean> {
  const since = shown(!behind)
  const found = await locatePerson(registry, user)
  const person = found._tag === 'Success' ? found.value : undefined
  if (person?.person === undefined) return false
  if (late(since, 'person')) return true
  if (person.mainId !== undefined) openLinked(person.mainId, undefined, behind)
  else if (!readingOnly()) newMessage({ key: `u:${user}`, name: person.person.name, kind: 'im', tint: 'dm', person: person.person, empty: true }, behind)
  return true
}

async function openSlackLink(url: string, match: SlackLinkMatch, event: ActivateEvent): Promise<void> {
  const { target } = match
  if (target.kind === 'person') {
    if (!(await openPerson(target.user, event.metaKey))) openOutside(url, match, 'Juno does not know that person')
    return
  }
  const since = shown(!event.metaKey)
  switch (target.kind) {
    case 'channel': {
      const located = await locateMessage(registry, target.channel, undefined)
      if (located._tag !== 'Success' || located.value.place === undefined) return openOutside(url, match, NO_CONVERSATION)
      if (late(since, 'channel')) return
      return openLinked(located.value.topicId, undefined, event.metaKey)
    }
    case 'message': {
      const topic = await messageTopic(target)
      if (topic?.place === undefined) return openOutside(url, match, NO_CONVERSATION)
      if (!topic.stored) {
        const loaded = await loadMessageAt(registry, topic.topicId, target.ts)
        if (loaded._tag === 'Success' && loaded.value.outcome === 'rejected') return openOutside(url, match, NO_CONVERSATION)
      }
      if (late(since, 'message')) return
      return openLinked(topic.topicId, target.ts, event.metaKey)
    }
  }
}

/** A #channel chip in a message: what a link to the channel opens (SPEC 7, "Mentions"). With ⌘, behind the current tab. */
export function openChannel(channel: string, behind: boolean): void {
  const session = registry.get(signedInAtom)
  if (session === undefined) return
  const url = channelLink(session.workspaceUrl, channel)
  const match = read(url)
  if (match !== undefined) void openSlackLink(url, match, { metaKey: behind, shiftKey: false, altKey: false, source: 'pointer' })
}

/** A web link: in the web panel, or in the browser with ⌘ (SPEC 8). Reading only, there is no web panel: always the browser. */
export function openWebLink(url: string, event: ActivateEvent): void {
  if (event.metaKey || readingOnly()) openExternal(url)
  else openWebPanel(registry, url)
}

/** A click on a link in a message: inside Juno for a Slack link to this workspace, else in the web panel or outside. */
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
  // Another workspace's web link needs its own Slack sign-in, which the browser has.
  if (match !== undefined) openExternal(url)
  else openWebLink(url, event)
}

/** For `MessageBody`: which links open inside Juno, and where they go. One object for the app's life (performance 5.1). */
export const messageLinkInfo: LinkInfo = {
  inApp: (url) => read(url)?.ours === true,
  describe,
}
