/**
 * The ⌘K command grammar (spec section 10, inventory section 9). A model
 * fallback may run after this; the grammar handles the clear cases.
 */
import { channelLabel, firstName, isDm, type ChannelInfo } from './channel'
import type { ChannelId, TopicId, UserId } from './ids'

export interface CommandPerson {
  readonly id: UserId
  /** Full display name, for example "Maya Chen". */
  readonly name: string
}

export interface CommandTopic {
  readonly id: TopicId
  readonly title: string
  readonly channel: ChannelInfo
}

export interface CommandContext {
  /** Most recent first; the order breaks ties between people with the same first name. */
  readonly people: ReadonlyArray<CommandPerson>
  readonly channels: ReadonlyArray<ChannelInfo>
  /** Topics that can be resolved (not already resolved). */
  readonly topics: ReadonlyArray<CommandTopic>
}

interface CommandBase {
  readonly label: string
  readonly sub: string
  /** 0..1, shown as a percentage badge. */
  readonly confidence: number
  readonly hint: string
}

export type Command =
  | (CommandBase & { readonly kind: 'send-dm'; readonly userId: UserId; readonly text: string })
  | (CommandBase & { readonly kind: 'open-dm'; readonly userId: UserId })
  | (CommandBase & { readonly kind: 'post'; readonly channelId: ChannelId; readonly text: string })
  | (CommandBase & { readonly kind: 'ask'; readonly prompt: string })
  | (CommandBase & { readonly kind: 'resolve'; readonly topicId: TopicId })

export const MIN_COMMAND_LENGTH = 4

const SEND_VERBS = /^(message|tell|ask|dm|ping|text)\s+(.+)$/i
const POST_VERBS = /^(?:post|send|say)\s+(?:in|to)\s+#?([\w-]+)\s+(.+)$/i
const ASK_VERBS = /^(summari[sz]e|catch me up(?: on)?|tl;?dr|what did i miss)\b\s*(.*)$/i
const RESOLVE_VERB = /^resolve\s+(.+)$/i

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
}

interface PersonMatch {
  readonly person: CommandPerson
  readonly rest: string
  readonly ambiguous: boolean
}

/** Finds the person named at the start of `text`: the full name first, then a first name. */
function matchPerson(text: string, people: ReadonlyArray<CommandPerson>): PersonMatch | undefined {
  const lower = text.toLowerCase()
  const startsWithName = (name: string) => {
    const n = name.toLowerCase()
    return lower === n || (lower.startsWith(n) && /\s/.test(lower.charAt(n.length)))
  }
  const full = people.filter((p) => startsWithName(p.name)).toSorted((a, b) => b.name.length - a.name.length)
  const byFull = full[0]
  if (byFull) return { person: byFull, rest: text.slice(byFull.name.length), ambiguous: false }
  const first = people.filter((p) => startsWithName(firstName(p.name)))
  const byFirst = first[0]
  if (byFirst) return { person: byFirst, rest: text.slice(firstName(byFirst.name).length), ambiguous: first.length > 1 }
  return undefined
}

/** Parses a palette query. `undefined` when it is a search, not a command. */
export function parseCommand(raw: string, ctx: CommandContext): Command | undefined {
  const q = raw.trim()
  if (q.length < MIN_COMMAND_LENGTH) return undefined

  let m = SEND_VERBS.exec(q)
  if (m && m[2] !== undefined) {
    const match = matchPerson(m[2], ctx.people)
    if (match) {
      const body = match.rest.replace(/^\s+(?:that|to)\b/i, '').trim()
      const { person } = match
      const penalty = match.ambiguous ? 0.2 : 0
      return describeCommand(body.length === 0 ? { kind: 'open-dm', userId: person.id } : { kind: 'send-dm', userId: person.id, text: body }, ctx, (body.length === 0 ? 0.88 : 0.95) - penalty)
    }
  }

  m = POST_VERBS.exec(q)
  if (m && m[1] !== undefined && m[2] !== undefined) {
    const name = m[1].toLowerCase()
    const channel = ctx.channels.find((c) => !isDm(c.kind) && c.name.toLowerCase() === name)
    if (channel) return describeCommand({ kind: 'post', channelId: channel.id, text: m[2].trim() }, ctx, 0.93)
  }

  m = ASK_VERBS.exec(q)
  if (m && m[1] !== undefined) {
    const verb = m[1].toLowerCase()
    const rest = (m[2] ?? '').trim()
    const what = verb.startsWith('what') ? 'catch you up' : verb.startsWith('catch') ? 'catch you up' + (rest ? ` on ${rest}` : '') : `summarize${rest ? ` ${rest}` : ''}`
    return { kind: 'ask', prompt: q, label: `Ask Juno to ${what}`, sub: 'Opens Juno with this request', confidence: 0.91, hint: '↵' }
  }

  m = RESOLVE_VERB.exec(q)
  if (m && m[1] !== undefined) {
    const words = tokens(m[1])
    let best: { topic: CommandTopic; n: number } | undefined
    for (const topic of ctx.topics) {
      const haystack = new Set(tokens(`${topic.title} ${channelLabel(topic.channel)}`))
      const n = words.filter((w) => haystack.has(w)).length
      if (n > 0 && (!best || n > best.n)) best = { topic, n }
    }
    if (best) return describeCommand({ kind: 'resolve', topicId: best.topic.id }, ctx, Math.min(0.95, Math.round((0.6 + 0.15 * best.n) * 100) / 100))
  }

  return undefined
}

/** What a command does, before it is labelled: the grammar's match, or the model's answer. */
export type RawCommand =
  | { readonly kind: 'send-dm'; readonly userId: UserId; readonly text: string }
  | { readonly kind: 'open-dm'; readonly userId: UserId }
  | { readonly kind: 'post'; readonly channelId: ChannelId; readonly text: string }
  | { readonly kind: 'ask'; readonly prompt: string }
  | { readonly kind: 'resolve'; readonly topicId: TopicId }

/**
 * The palette row for a command (inventory 9): its label, sub line and
 * hint. `undefined` when the command names a person, channel or topic the
 * context does not hold.
 */
export function describeCommand(raw: RawCommand, ctx: CommandContext, confidence: number): Command | undefined {
  switch (raw.kind) {
    case 'send-dm':
    case 'open-dm': {
      const person = ctx.people.find((p) => p.id === raw.userId)
      if (person === undefined) return undefined
      if (raw.kind === 'open-dm') return { ...raw, label: `Message ${person.name}`, sub: `Opens your Main thread with ${firstName(person.name)}`, confidence, hint: '↵' }
      return { ...raw, label: `Send to ${person.name}`, sub: `"${raw.text}"`, confidence, hint: '↵ Send' }
    }
    case 'post': {
      const channel = ctx.channels.find((c) => c.id === raw.channelId && !isDm(c.kind))
      if (channel === undefined) return undefined
      return { ...raw, label: `Post in ${channelLabel(channel)}`, sub: `"${raw.text}"`, confidence, hint: '↵ Send' }
    }
    case 'ask':
      return { ...raw, label: 'Ask Juno', sub: 'Opens Juno with this request', confidence, hint: '↵' }
    case 'resolve': {
      const topic = ctx.topics.find((t) => t.id === raw.topicId)
      if (topic === undefined) return undefined
      return { ...raw, label: `Resolve ${topic.title}`, sub: `${channelLabel(topic.channel)} · hides it until there is new activity`, confidence, hint: '↵ Resolve' }
    }
  }
}
