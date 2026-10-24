/**
 * Slack reads as model tools (plan v3 §9 Tier 0). They go through the
 * AgentHost port, which WP13 serves (`agent-contract` `HostReadRpcs`); the
 * agent never reaches Slack itself. `HostReads` is that port without the
 * account: the host binds the signed-in account.
 *
 * Every read is untrusted content, so it taints the run (§6.4). Results are
 * plain lines; the request builder pages long ones. A message line starts
 * with its handle for sources (§19.1, `sources.ts`) and names the channel
 * and sender as the owner sees them, keeping the ids the tools take:
 *
 *   m3 #eng (C0ENG) ts 1760500000.000004 in thread 1760500000.000001, Maya Chen: It times out…
 */
import type { AgentHostError, HostMessagePage, HostSearchOptions, HostSearchPage, HostChannel, TopicLink } from '@juno/agent-contract'
import { abortable, Cancelled, defineTool, type JunoTool, type ToolOutput } from '../request/tool'
import type { SourceRef } from './sources'

type Page = typeof HostMessagePage.Type

export interface HostReads {
  readonly channels?: (pattern: string) => Promise<ReadonlyArray<typeof HostChannel.Type>>
  readonly search: (query: string, options?: typeof HostSearchOptions.Type & { readonly cursor?: string; readonly limit?: number }) => Promise<typeof HostSearchPage.Type>
  readonly history: (channelId: string) => Promise<Page>
  readonly replies: (channelId: string, threadTs: string) => Promise<Page>
  readonly topics: () => Promise<{ readonly topics: ReadonlyArray<TopicLink> }>
  readonly person: (userId: string) => Promise<{ readonly id: string; readonly name: string; readonly displayName: string }>
  /** Who the owner exchanged messages with in DMs and threads since `since` (ms), most first: counts only (SPEC 13.8). */
  readonly people?: (since: number) => Promise<ReadonlyArray<HostInteraction>>
  /** Workspace members for each name, for splitting the older People doc. */
  readonly members?: (names: ReadonlyArray<string>) => Promise<ReadonlyArray<{ readonly name: string; readonly ids: ReadonlyArray<{ readonly id: string; readonly name: string }> }>>
}

export interface HostInteraction {
  readonly id: string
  readonly name: string
  readonly owner: number
  readonly them: number
  readonly lastAt: number
  readonly dm?: string
}

/** Gives each message of a read its handle in the live run. */
export type Handles = (messages: ReadonlyArray<SourceRef>) => Promise<ReadonlyArray<string>>

const line = (m: Page['messages'][number], handle: string | undefined) => {
  const place = m.channelName === undefined ? m.channelId : `${m.channelName} (${m.channelId})`
  const thread = m.threadTs ? ` in thread ${m.threadTs}` : ''
  return `${handle === undefined ? '' : `${handle} `}${place} ts ${m.ts}${thread}, ${m.senderName ?? (m.senderId || 'unknown sender')}: ${m.text}`
}

const lines = async (page: Page, handles: Handles): Promise<ToolOutput> => {
  const summary = plural(page.messages.length, 'message', 'messages')
  if (page.messages.length === 0) return { text: 'No messages.', summary }
  const refs = page.messages.map((m) => ({ channelId: m.channelId, ts: m.ts, ...(m.channelName === undefined ? {} : { place: m.channelName }) }))
  const assigned = await handles(refs)
  return { text: page.messages.map((m, i) => line(m, assigned[i])).join('\n'), summary }
}

const reasons: Record<string, string> = {
  offline: 'Slack is not reachable right now.',
  signedOut: 'Juno is signed out of Slack.',
  notFound: 'Nothing was found there.',
  rateLimited: 'Slack asked Juno to slow down. Try again in a minute.',
}

/** A failed read is told to the model in fixed words, never with the host's error body. */
async function read(f: () => Promise<string | ToolOutput>, signal?: AbortSignal): Promise<ToolOutput> {
  try {
    const output = await abortable(f(), signal)
    return typeof output === 'string' ? { text: output } : output
  } catch (error) {
    if (error instanceof Cancelled) return { text: 'The read was cancelled.', isError: true }
    const reason = (error as Partial<typeof AgentHostError.Type>)?.reason
    return { text: (reason && reasons[reason]) ?? 'Slack could not be read.', isError: true }
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const string = (description: string) => ({ type: 'string', description })

export type HostTool = JunoTool & { readonly taints: boolean }

type SearchArgs = { readonly query: string; readonly cursor?: string; readonly limit?: number } & typeof HostSearchOptions.Type
type SearchMatch = (typeof HostSearchPage.Type)['matches'][number]

/** A match as a line: the message line with its time and topic, or a topic whose title matched. */
const matchLine = (m: SearchMatch, handle: string | undefined) => {
  const topic = `topic ${m.topic.topicId} "${m.topic.title}"`
  if (m.message !== undefined) return `${line(m.message, handle)} | ${m.time} | ${topic}`
  return `${handle === undefined ? '' : `${handle} `}Title match: ${topic} in ${m.topic.where} (${m.channelId}), last active ${m.time}`
}

const searchTool = (host: HostReads, handles: Handles) =>
  defineTool<SearchArgs>({
    name: 'slack_search',
    description: [
      'Search the owner\'s Slack: messages on this Mac and Slack\'s full history, plus Juno topic titles, newest first.',
      'Filters: from: and in: take names or ids (several in: match any of them); before:, after:, on: and during: take days or months in the owner\'s time zone (on:2026-10-12, during:2026-09);',
      'has:link, has:file, has:reaction, has:pin; is:thread; "exact phrase"; -word or -from:name to exclude.',
      'Apps and automated conversations are hidden unless you include them, as for alerts, deploys or bots.',
      'Text is the part around the match; read the thread for more. For more matches, call again with the cursor and the same query and options.',
    ].join(' '),
    parameters: { type: 'object', properties: {
      query: string('The search, words and filters'),
      includeApps: { type: 'boolean', description: 'Include messages from apps and bots' },
      includeAutomated: { type: 'boolean', description: 'Include automated conversations. An in: filter already includes its conversation' },
      sort: { type: 'string', enum: ['newest', 'oldest'] },
      cursor: string('The cursor from the previous page'),
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Matches per call, at most 50' },
    }, required: ['query'], additionalProperties: false },
    replay: 'safe',
    status: (n) => (n === 1 ? 'Searching Slack' : `Searching Slack, ${plural(n, 'search', 'searches')}`),
    run: ({ query, ...options }, call) => read(async () => {
      const page = await host.search(query, options)
      // A title match without a thread root names no message, so it gets no handle.
      const cited = page.matches.flatMap((m) => {
        const ts = m.message?.ts ?? m.rootTs
        return ts === undefined ? [] : [{ match: m, ref: { channelId: m.channelId, ts, place: m.topic.where } }]
      })
      const assigned = await handles(cited.map((c) => c.ref))
      const handleOf = new Map(cited.map((c, i) => [c.match, assigned[i]]))
      const rows = page.matches.map((m) => matchLine(m, handleOf.get(m)))
      if (rows.length === 0) rows.push(page.next === undefined ? 'No matches.' : 'No matches on this page.')
      rows.push(...page.notes.map((note) => `Note: ${note}`))
      if (page.next !== undefined) rows.push(`Next cursor: ${page.next}`)
      return { text: rows.join('\n'), summary: plural(page.matches.length, 'match', 'matches') }
    }, call.signal),
  })

/** `handles` numbers the messages read in the live run. */
export function hostTools(host: HostReads, handles: Handles): ReadonlyArray<HostTool> {
  const tools = [
    searchTool(host, handles),
    defineTool<{ readonly channel: string }>({
      name: 'slack_history',
      description: 'Read the newest messages of a channel or direct message.',
      parameters: { type: 'object', properties: { channel: string('The channel id') }, required: ['channel'], additionalProperties: false },
      replay: 'safe',
      status: (n) => `Reading ${plural(n, 'conversation', 'conversations')}`,
      run: ({ channel }, call) => read(async () => lines(await host.history(channel), handles), call.signal),
    }),
    defineTool<{ readonly channel: string; readonly thread: string }>({
      name: 'slack_replies',
      description: 'Read a thread: its first message and the replies.',
      parameters: {
        type: 'object',
        properties: { channel: string('The channel id'), thread: string("The thread's ts") },
        required: ['channel', 'thread'],
        additionalProperties: false,
      },
      replay: 'safe',
      status: (n) => `Reading ${plural(n, 'thread', 'threads')}`,
      run: ({ channel, thread }, call) => read(async () => lines(await host.replies(channel, thread), handles), call.signal),
    }),
    defineTool<Record<string, never>>({
      name: 'slack_topics',
      description: "List the owner's open topics in Juno: threads and each channel's Main stream.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      replay: 'safe',
      status: () => 'Reading topics',
      run: (_, call) =>
        read(async () => {
          const { topics } = await host.topics()
          const summary = plural(topics.length, 'topic', 'topics')
          return { text: topics.length === 0 ? 'No topics.' : topics.map((t) => `${t.topicId} ${t.title} (${t.where})`).join('\n'), summary }
        }, call.signal),
    }),
    defineTool<{ readonly user: string }>({
      name: 'slack_person',
      description: 'Look up a Slack user by id, such as one mentioned as <@U…> in a message: their name and display name.',
      parameters: { type: 'object', properties: { user: string('The user id') }, required: ['user'], additionalProperties: false },
      replay: 'safe',
      status: (n) => `Looking up ${plural(n, 'person', 'people')}`,
      run: ({ user }, call) =>
        read(async () => {
          const person = await host.person(user)
          return `${person.id}: ${person.name} (${person.displayName})`
        }, call.signal),
    }),
  ]
  const directory = host.channels
  return [
    ...tools.map((tool) => ({ ...tool, taints: true })),
    ...(directory === undefined ? [] : [{ ...defineTool<{ readonly pattern: string }>({
      name: 'slack_channels', description: 'Find all cached channels by case-insensitive name glob (* matches any text, ? one character). For every alerts channel use *alerts*. Returns only channel ids and names, no message content.',
      parameters: { type: 'object', properties: { pattern: string('Channel name glob') }, required: ['pattern'], additionalProperties: false },
      replay: 'safe', status: () => 'Finding channels', run: ({ pattern }, call) => read(async () => JSON.stringify(await directory(pattern)), call.signal),
    }), taints: false }]),
  ]
}
