/**
 * Slack links for a topic (research, slack-data-access "Permalinks"): no
 * API call. A thread links to its root message, Main to its channel.
 */
import type { TopicDetail } from '@juno/contract'

/** A thread's root ts from its topic id (`t:<channel>:<thread_ts>`, architecture 4.4); undefined for Main. */
export function threadRootTs(topicId: string): string | undefined {
  return topicId.startsWith('t:') ? topicId.slice(topicId.lastIndexOf(':') + 1) : undefined
}

export function slackLink(workspaceUrl: string, topic: Pick<TopicDetail, 'channel' | 'rootTs'>): string {
  const base = new URL(`archives/${topic.channel.id}`, workspaceUrl.endsWith('/') ? workspaceUrl : `${workspaceUrl}/`).toString()
  return topic.rootTs === undefined ? base : `${base}/p${topic.rootTs.replace('.', '')}`
}

/** Where a Slack link points (research, slack-data-access "Permalinks"). */
export type SlackLinkTarget =
  | { readonly kind: 'message'; readonly channel: string; readonly ts: string; readonly threadTs?: string }
  | { readonly kind: 'channel'; readonly channel: string }
  | { readonly kind: 'person'; readonly user: string }

/**
 * A Slack link, read: `ours` when it names the signed-in workspace, by its
 * host or its team id. `teamId` is the team a `slack://` or app.slack.com
 * link names, so a link to another workspace can still open in Slack.
 */
export interface SlackLinkMatch {
  readonly ours: boolean
  readonly target: SlackLinkTarget
  readonly teamId?: string
}

/** The workspace links are matched against: its URL (`https://acme.slack.com/`) and team id. */
export interface LinkWorkspace {
  readonly url: string
  readonly teamId: string
}

const CHANNEL_ID = /^[CGD][A-Z0-9]+$/
const USER_ID = /^[UW][A-Z0-9]+$/
const TS = /^\d+\.\d+$/

/** `p1712345678000200` as a ts, `1712345678.000200`; the last six digits are the fraction. */
function permalinkTs(segment: string | undefined): string | undefined {
  const digits = /^p(\d{7,})$/.exec(segment ?? '')?.[1]
  return digits === undefined ? undefined : `${digits.slice(0, -6)}.${digits.slice(-6)}`
}

/** A ts as a query parameter gives it: `1712345678.000200`, or the `p` form. */
function paramTs(value: string | null): string | undefined {
  if (value === null) return undefined
  return TS.test(value) ? value : permalinkTs(value.startsWith('p') ? value : `p${value}`)
}

/** A message target, with its thread when it is a reply. */
function message(channel: string, ts: string, threadTs: string | undefined): SlackLinkTarget {
  return threadTs === undefined || threadTs === ts ? { kind: 'message', channel, ts } : { kind: 'message', channel, ts, threadTs }
}

/** `/archives/<C>[/p<ts>]` and `/team/<U>`, with `?thread_ts=` on a reply. */
function workspacePath(url: URL): SlackLinkTarget | undefined {
  const [first, id, third] = url.pathname.split('/').filter((part) => part !== '')
  if (first === 'team' && id !== undefined && USER_ID.test(id)) return { kind: 'person', user: id }
  if (first !== 'archives' || id === undefined || !CHANNEL_ID.test(id)) return undefined
  if (third === undefined) return { kind: 'channel', channel: id }
  const ts = permalinkTs(third)
  return ts === undefined ? undefined : message(id, ts, paramTs(url.searchParams.get('thread_ts')))
}

/** `/client/<T>/<C>`, with `/p<ts>` or `/thread/<C>-<ts>` after it, or `/client/<T>/user_profile/<U>`. */
function clientPath(url: URL): { readonly teamId: string; readonly target: SlackLinkTarget } | undefined {
  const [first, teamId, id, fourth, fifth] = url.pathname.split('/').filter((part) => part !== '')
  if (first !== 'client' || teamId === undefined || id === undefined) return undefined
  if (id === 'user_profile' && fourth !== undefined && USER_ID.test(fourth)) return { teamId, target: { kind: 'person', user: fourth } }
  if (!CHANNEL_ID.test(id)) return undefined
  if (fourth === undefined) return { teamId, target: { kind: 'channel', channel: id } }
  if (fourth === 'thread') {
    const [, threadTs] = /^[A-Z0-9]+-(\d+\.\d+)$/.exec(fifth ?? '') ?? []
    return threadTs === undefined ? undefined : { teamId, target: { kind: 'message', channel: id, ts: threadTs } }
  }
  const ts = permalinkTs(fourth)
  return ts === undefined ? undefined : { teamId, target: message(id, ts, paramTs(url.searchParams.get('thread_ts'))) }
}

/** `slack://channel?team=<T>&id=<C>[&message=<ts>][&thread_ts=<ts>]` and `slack://user?team=<T>&id=<U>`. */
function deepLink(url: URL): { readonly teamId: string; readonly target: SlackLinkTarget } | undefined {
  const teamId = url.searchParams.get('team')
  const id = url.searchParams.get('id')
  if (teamId === null || id === null) return undefined
  // `slack://channel?…` parses with `channel` as the host.
  const kind = url.host || url.pathname.replace(/^\/+/, '')
  if (kind === 'user') return USER_ID.test(id) ? { teamId, target: { kind: 'person', user: id } } : undefined
  if (kind !== 'channel' || !CHANNEL_ID.test(id)) return undefined
  const ts = paramTs(url.searchParams.get('message'))
  return { teamId, target: ts === undefined ? { kind: 'channel', channel: id } : message(id, ts, paramTs(url.searchParams.get('thread_ts'))) }
}

/**
 * Reads a link to a Slack message, channel or person: a permalink
 * (`https://<team>.slack.com/archives/…`), a profile link (`/team/<U>`),
 * an app.slack.com client link or a `slack://` deep link. Undefined for
 * anything else, including Slack pages such as slack.com/help.
 */
export function parseSlackLink(href: string, workspace: LinkWorkspace): SlackLinkMatch | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }
  if (url.protocol === 'slack:') {
    const found = deepLink(url)
    return found === undefined ? undefined : { ours: found.teamId === workspace.teamId, target: found.target, teamId: found.teamId }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (url.hostname === 'app.slack.com') {
    const found = clientPath(url)
    return found === undefined ? undefined : { ours: found.teamId === workspace.teamId, target: found.target, teamId: found.teamId }
  }
  const ours = sameHost(url, workspace.url)
  if (!ours && !url.hostname.endsWith('.slack.com')) return undefined
  const target = workspacePath(url)
  return target === undefined ? undefined : { ours, target }
}

function sameHost(url: URL, workspaceUrl: string): boolean {
  try {
    return new URL(workspaceUrl).host === url.host
  } catch {
    return false
  }
}
