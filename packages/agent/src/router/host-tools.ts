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
import type { AgentHostError, HostMessagePage, TopicLink } from '@juno/agent-contract'
import { defineTool, type JunoTool } from '../request/tool'
import type { SourceRef } from './sources'

type Page = typeof HostMessagePage.Type

export interface HostReads {
  readonly search: (query: string) => Promise<Page>
  readonly history: (channelId: string) => Promise<Page>
  readonly replies: (channelId: string, threadTs: string) => Promise<Page>
  readonly topics: () => Promise<{ readonly topics: ReadonlyArray<TopicLink> }>
  readonly person: (userId: string) => Promise<{ readonly id: string; readonly name: string; readonly displayName: string }>
}

/** Gives each message of a read its handle in the live run. */
export type Handles = (messages: ReadonlyArray<SourceRef>) => Promise<ReadonlyArray<string>>

const line = (m: Page['messages'][number], handle: string | undefined) => {
  const place = m.channelName === undefined ? m.channelId : `${m.channelName} (${m.channelId})`
  const thread = m.threadTs ? ` in thread ${m.threadTs}` : ''
  return `${handle === undefined ? '' : `${handle} `}${place} ts ${m.ts}${thread}, ${m.senderName ?? (m.senderId || 'unknown sender')}: ${m.text}`
}

const lines = async (page: Page, handles: Handles) => {
  if (page.messages.length === 0) return 'No messages.'
  const refs = page.messages.map((m) => ({ channelId: m.channelId, ts: m.ts, ...(m.channelName === undefined ? {} : { place: m.channelName }) }))
  const assigned = await handles(refs)
  return page.messages.map((m, i) => line(m, assigned[i])).join('\n')
}

const reasons: Record<string, string> = {
  offline: 'Slack is not reachable right now.',
  signedOut: 'Juno is signed out of Slack.',
  notFound: 'Nothing was found there.',
  rateLimited: 'Slack asked Juno to slow down. Try again in a minute.',
}

/** A failed read is told to the model in fixed words, never with the host's error body. */
async function read(f: () => Promise<string>): Promise<{ readonly text: string; readonly isError?: boolean }> {
  try {
    return { text: await f() }
  } catch (error) {
    const reason = (error as Partial<typeof AgentHostError.Type>)?.reason
    return { text: (reason && reasons[reason]) ?? 'Slack could not be read.', isError: true }
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const string = (description: string) => ({ type: 'string', description })

export type HostTool = JunoTool & { readonly taints: true }

/** `handles` numbers the messages read in the live run. */
export function hostTools(host: HostReads, handles: Handles): ReadonlyArray<HostTool> {
  const tools = [
    defineTool<{ readonly query: string }>({
      name: 'slack_search',
      description: 'Search the owner\'s Slack messages. Slack search syntax works, for example "from:@maya in:#eng".',
      parameters: { type: 'object', properties: { query: string('The search') }, required: ['query'], additionalProperties: false },
      replay: 'safe',
      status: (n) => (n === 1 ? 'Searching Slack' : `Searching Slack, ${plural(n, 'search', 'searches')}`),
      run: ({ query }) => read(async () => lines(await host.search(query), handles)),
    }),
    defineTool<{ readonly channel: string }>({
      name: 'slack_history',
      description: 'Read the newest messages of a channel or direct message.',
      parameters: { type: 'object', properties: { channel: string('The channel id') }, required: ['channel'], additionalProperties: false },
      replay: 'safe',
      status: (n) => `Reading ${plural(n, 'conversation', 'conversations')}`,
      run: ({ channel }) => read(async () => lines(await host.history(channel), handles)),
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
      run: ({ channel, thread }) => read(async () => lines(await host.replies(channel, thread), handles)),
    }),
    defineTool<Record<string, never>>({
      name: 'slack_topics',
      description: "List the owner's open topics in Juno: threads and each channel's Main stream.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      replay: 'safe',
      status: () => 'Reading topics',
      run: () =>
        read(async () => {
          const { topics } = await host.topics()
          return topics.length === 0 ? 'No topics.' : topics.map((t) => `${t.topicId} ${t.title} (${t.where})`).join('\n')
        }),
    }),
    defineTool<{ readonly user: string }>({
      name: 'slack_person',
      description: 'Look up a Slack user by id, such as one mentioned as <@U…> in a message: their name and display name.',
      parameters: { type: 'object', properties: { user: string('The user id') }, required: ['user'], additionalProperties: false },
      replay: 'safe',
      status: (n) => `Looking up ${plural(n, 'person', 'people')}`,
      run: ({ user }) =>
        read(async () => {
          const person = await host.person(user)
          return `${person.id}: ${person.name} (${person.displayName})`
        }),
    }),
  ]
  return tools.map((tool) => ({ ...tool, taints: true as const }))
}
