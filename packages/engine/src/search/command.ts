/**
 * `search.command`: what the palette's text means as a command (spec
 * section 15, "Command routing (⌘K)": a decision, shown only with a clear
 * intent and target). The grammar in `@juno/domain` answers the clear
 * phrasings at once; the model answers the rest, only for text of
 * `MODEL_MIN_WORDS` words or more, since a word or two is a search and
 * every pause in typing would otherwise be a model call. Nothing while AI
 * assist is off: ⌘K then only searches (inventory 17).
 */
import type { PaletteCommand } from '@juno/contract'
import { AiProvider, tasks } from '@juno/ai'
import { describeCommand, FALLBACK_TITLE_WORDS, firstWords, mainLabel, mainTopicId, parseCommand, type ChannelId, type ChannelInfo, type Command, type CommandContext, type ConversationKind, type RawCommand, type TopicId, type UserId } from '@juno/domain'
import { StoreReader, type SqlClient } from '@juno/store'
import { Effect } from 'effect'
import { aiAssistOn } from '../ai'
import { personFrom, userName, type UserRow } from '../topicRows'

/** Text with fewer words never reaches the model. */
export const MODEL_MIN_WORDS = 3
/** A model answer below this is not a clear intent. */
export const MODEL_MIN_CONFIDENCE = 0.7
/** Topics a resolve command can name: the most recent open ones. */
const RESOLVABLE_TOPICS = 200
/** What the model sees of each list. */
const MODEL_LIST_MAX = 40

interface Context extends CommandContext {
  /** DM channel by person, for those with a DM Main. */
  readonly dms: ReadonlyMap<string, string>
  readonly users: ReadonlyMap<string, UserRow>
}

const readContext = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    // Full names, as labels say them ("Send to Maya Chen"). People you talk to most recently come first: the grammar breaks first-name ties by this order.
    const people = yield* sql<UserRow & { readonly dm: string | null }>`SELECT u.id, u.name, COALESCE(NULLIF(u.real_name, ''), NULLIF(u.display_name, '')) AS display_name, u.real_name, u.avatar_url, u.avatar_small_url, u.avatar_large_url, d.id AS dm
      FROM users u
      LEFT JOIN conversations d ON d.kind = 'im' AND d.user_id = u.id AND d.is_member = 1
      LEFT JOIN topic_index t ON t.topic_id = 'm:' || d.id
      WHERE u.deleted = 0 AND u.is_bot = 0 AND u.id <> COALESCE((SELECT self_user_id FROM team LIMIT 1), '')
      ORDER BY t.last_activity_ts IS NULL, t.last_activity_ts DESC, u.id`
    const channels = yield* sql<{ id: string; kind: ConversationKind; name: string | null }>`SELECT c.id, c.kind, c.name FROM conversations c
      LEFT JOIN ignored_channels g ON g.channel = c.id
      WHERE c.is_member = 1 AND g.channel IS NULL AND c.kind IN ('public', 'private') ORDER BY c.name, c.id`
    const topics = yield* sql<{ id: string; channel: string; kind: string; title: string; named: string | null; c_kind: ConversationKind; c_name: string | null }>`SELECT i.topic_id AS id, i.channel, i.kind,
        COALESCE(json_extract(i.preview_json, '$.rootText'), '') AS title,
        COALESCE(NULLIF(trim(o.manual_title), ''), NULLIF(trim(o.ai_title), '')) AS named, c.kind AS c_kind, c.name AS c_name
      FROM topic_index i INDEXED BY topic_index_activity JOIN conversations c ON c.id = i.channel
      LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
      LEFT JOIN ignored_channels g ON g.channel = i.channel
      WHERE c.is_member = 1 AND g.channel IS NULL AND i.kind = 'thread'
        AND (o.resolved_at IS NULL OR i.last_activity_ts > o.resolved_activity_ts)
      ORDER BY i.last_activity_ts DESC LIMIT ${RESOLVABLE_TOPICS}`
    const dms = new Map<string, string>()
    for (const person of people) if (person.dm !== null && !dms.has(person.id)) dms.set(person.id, person.dm)
    const users = new Map<string, UserRow>(people.map((person) => [person.id, person]))
    // A fallback title names the people it mentions; bots and anyone not stored read "Someone".
    const names = { user: (id: string) => (users.has(id) ? userName(id, users.get(id)) : undefined) }
    return {
      people: [...users.values()].map((person) => ({ id: person.id as UserId, name: userName(person.id, person) })),
      channels: channels.map((c): ChannelInfo => ({ id: c.id as ChannelId, kind: c.kind, name: c.name ?? c.id })),
      topics: topics.map((t) => {
        const channel: ChannelInfo = { id: t.channel as ChannelId, kind: t.c_kind, name: t.c_name ?? t.channel }
        return { id: t.id as TopicId, title: t.kind === 'main' ? mainLabel(channel) : t.named || firstWords(t.title, FALLBACK_TITLE_WORDS, names) || t.c_name || t.channel, channel }
      }),
      dms,
      users,
    } satisfies Context
  })

/** The model's answer as a command the grammar could have given, or `undefined`. */
const askModel = (text: string, ctx: Context) =>
  Effect.gen(function* () {
    const provider = yield* AiProvider
    const decision = yield* provider.decide(tasks.parseCommand, {
      text,
      people: ctx.people.slice(0, MODEL_LIST_MAX),
      channels: ctx.channels.slice(0, MODEL_LIST_MAX),
      topics: ctx.topics.slice(0, MODEL_LIST_MAX).map((t) => ({ id: t.id, title: t.title, channel: t.channel.name })),
    })
    if (decision._tag !== 'Decided' || decision.value.command === null || decision.value.confidence < MODEL_MIN_CONFIDENCE) return undefined
    const c = decision.value.command
    const raw: RawCommand =
      c.kind === 'send_dm'
        ? { kind: 'send-dm', userId: c.userId as UserId, text: c.text }
        : c.kind === 'open_dm'
          ? { kind: 'open-dm', userId: c.userId as UserId }
          : c.kind === 'post'
            ? { kind: 'post', channelId: c.channelId as ChannelId, text: c.text }
            : c.kind === 'ask'
              ? { kind: 'ask', prompt: c.prompt }
              : { kind: 'resolve', topicId: c.topicId as TopicId }
    return describeCommand(raw, ctx, decision.value.confidence)
  })

function toWire(command: Command, ctx: Context): PaletteCommand {
  const base = { label: command.label, sub: command.sub, confidence: command.confidence, hint: command.hint }
  switch (command.kind) {
    case 'send-dm':
      return { ...base, kind: 'send-dm', userId: command.userId, text: command.text, place: ctx.people.find((p) => p.id === command.userId)?.name ?? command.userId }
    case 'open-dm': {
      const dm = ctx.dms.get(command.userId)
      return { ...base, kind: 'open-dm', userId: command.userId, person: personFrom(command.userId, ctx.users.get(command.userId)), ...(dm === undefined ? {} : { mainId: mainTopicId(dm as ChannelId) }) }
    }
    case 'post':
      return { ...base, kind: 'post', channelId: command.channelId, text: command.text, place: `#${ctx.channels.find((c) => c.id === command.channelId)?.name ?? command.channelId}` }
    case 'ask':
      return { ...base, kind: 'ask', prompt: command.prompt }
    case 'resolve':
      return { ...base, kind: 'resolve', topicId: command.topicId, title: ctx.topics.find((t) => t.id === command.topicId)?.title ?? '' }
  }
}

export const queryCommand = Effect.fn('search.command')(function* (text: string) {
  const typed = text.trim()
  if (typed === '' || !(yield* aiAssistOn)) return null
  const ctx = yield* readContext(yield* StoreReader)
  const command = parseCommand(typed, ctx) ?? (typed.split(/\s+/).length >= MODEL_MIN_WORDS ? yield* askModel(typed, ctx) : undefined)
  return command === undefined ? null : toWire(command, ctx)
})
