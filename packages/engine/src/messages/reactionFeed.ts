/**
 * The `reactions.feed` query (SPEC 5, "Reactions"): the newest rows of
 * `reaction_feed` within `REACTION_DAYS`, at most `REACTION_ROWS`, in
 * conversations the user is in that are not archived or ignored.
 *
 * A row reads as Slack's Activity does: its headline is the row's own
 * reactor and emoji (the feed entry, or the latest live `reaction_added`),
 * then "+N", how many other people have any reaction on the message now,
 * from the stored message. A row drops out once the stored message has no
 * reaction left from anyone but the user, unless the store has not yet seen
 * the headline's reaction (`known`). Rows whose message the store lacks are
 * hidden and reported as `missing`; the handler asks the sync to read them.
 * Statements are exported for the plan test.
 */
import { Effect } from 'effect'
import { REACTION_DAYS, REACTION_ROWS, type Person, type ReactionRow, type RowChannel } from '@juno/contract'
import { firstWords, mainTopicId, mentionedUserIds, messagePreviewText, shortName, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { emojiUnicode, splitEmojiName } from '@juno/richtext'
import { StoreReader, type SqlError } from '@juno/store'
import { channelInfoOf, channelRefOf, parseIds, personFrom, userName } from '../topicRows'
import { reactionEmoji, readEmoji } from '../emojiLookup'
import { messageUsersStatement, type MessageUser } from './query'
import { reactionsStatement } from './window'

const DAY = 24 * 60 * 60 * 1000

type PreviewInput = Parameters<typeof messagePreviewText>[0]

export interface ReactionFeedRun {
  readonly rows: ReadonlyArray<ReactionRow>
  /** Rows of the window whose message the store does not have. */
  readonly missing: ReadonlyArray<{ readonly channel: string; readonly ts: string }>
}

interface FeedRow {
  readonly channel: string
  readonly ts: string
  readonly at: number
  readonly feed_user: string
  readonly feed_name: string
  readonly known: 0 | 1
  readonly m_ts: string | null
  readonly user_id: string | null
  readonly text: string | null
  readonly blocks_json: string | null
  readonly files_json: string | null
  readonly attachments_json: string | null
  readonly subtype: string | null
  readonly thread_ts: string | null
  readonly deleted: 0 | 1 | null
  readonly c_kind: 'public' | 'private' | 'im' | 'mpim'
  readonly c_name: string | null
  readonly c_user_id: string | null
  readonly c_members: string | null
}

/** The window by time, through `reaction_feed_at`, with each row's message and conversation by primary key. */
export function reactionFeedStatements(since: number) {
  return {
    feed: {
      sql: `SELECT f.channel, f.ts, f.at, f.user_id AS feed_user, f.name AS feed_name, f.known,
          m.ts AS m_ts, m.user_id, m.text, m.blocks_json, m.files_json, m.attachments_json, m.subtype, m.thread_ts, m.deleted,
          c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members
        FROM reaction_feed f INDEXED BY reaction_feed_at
        JOIN conversations c ON c.id = f.channel
        LEFT JOIN messages m ON m.channel = f.channel AND m.ts = f.ts
        LEFT JOIN ignored_channels ig ON ig.channel = f.channel
        WHERE f.at > ? AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
        ORDER BY f.at DESC LIMIT ?`,
      params: [since, REACTION_ROWS],
    },
    /** Thread titles: the overlay's and the root's text, by primary key. */
    threads: (channel: string, roots: ReadonlyArray<string>) => ({
      sql: `SELECT r.ts, r.text, o.manual_title, o.ai_title FROM messages r
        LEFT JOIN topic_overlay o ON o.topic_id = 't:' || r.channel || ':' || r.ts
        WHERE r.channel = ? AND r.ts IN (${roots.map(() => '?').join(', ')})`,
      params: [channel, ...roots],
    }),
  } as const
}

const parseJson = <A>(json: string | null): A | undefined => {
  if (json === null) return undefined
  try {
    return JSON.parse(json) as A
  } catch {
    return undefined
  }
}

const isReply = (row: Pick<FeedRow, 'ts' | 'thread_ts'>): boolean => row.thread_ts !== null && row.thread_ts !== row.ts

type StoredReactions = ReadonlyArray<{ readonly name: string; readonly users: ReadonlyArray<string> }>
type ThreadTitle = { readonly text: string; readonly manual: string | null; readonly ai: string | null }

/** Everyone but the user with a reaction on the stored message. */
const reactorsOf = (reactions: StoredReactions, selfId: string | undefined): ReadonlySet<string> =>
  new Set(reactions.flatMap((reaction) => reaction.users.filter((user) => user !== selfId)))

/** The shown rows' reactions and their replies' thread roots, one statement each per conversation. */
const readMessageParts = (rows: ReadonlyArray<FeedRow>, statements: ReturnType<typeof reactionFeedStatements>) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const byChannel = new Map<string, Array<FeedRow>>()
    for (const row of rows) byChannel.set(row.channel, [...(byChannel.get(row.channel) ?? []), row])
    const reactions = new Map<string, Array<{ name: string; users: ReadonlyArray<string> }>>()
    const titles = new Map<string, ThreadTitle>()
    for (const [channel, list] of byChannel) {
      const read = reactionsStatement(channel, list.map((row) => row.ts))
      for (const reaction of yield* sql.unsafe<{ ts: string; name: string; user_ids_json: string | null }>(read.sql, read.params)) {
        const key = `${channel}:${reaction.ts}`
        reactions.set(key, [...(reactions.get(key) ?? []), { name: reaction.name, users: parseIds(reaction.user_ids_json) }])
      }
      const roots = [...new Set(list.filter(isReply).map((row) => row.thread_ts!))]
      if (roots.length === 0) continue
      const threads = statements.threads(channel, roots)
      for (const root of yield* sql.unsafe<{ ts: string; text: string; manual_title: string | null; ai_title: string | null }>(threads.sql, threads.params)) {
        titles.set(`${channel}:${root.ts}`, { text: root.text, manual: root.manual_title, ai: root.ai_title })
      }
    }
    return { reactions, titles }
  })

/** Everything a row needs besides its own columns. */
interface Shaper {
  readonly selfId: string | undefined
  readonly users: ReadonlyMap<string, MessageUser>
  readonly titles: ReadonlyMap<string, ThreadTitle>
  readonly emoji: Parameters<typeof reactionEmoji>[1]
}

function shapeRow(row: FeedRow, others: number, shaper: Shaper): ReactionRow {
  const { selfId, users } = shaper
  const person = (id: string): Person => personFrom(id, users.get(id))
  const nameOf = (id: string) => userName(id, users.get(id))
  const lookups = { ...(selfId === undefined ? {} : { me: selfId }), user: (id: string) => (users.has(id) ? nameOf(id) : undefined) }
  const info = channelInfoOf(row, { members: row.c_kind === 'mpim' ? parseIds(row.c_members) : [] }, selfId, nameOf)
  const { partnerId, memberIds, ...ref } = channelRefOf(info, row.c_kind === 'im' ? (row.c_user_id ?? undefined) : undefined)
  const channel: RowChannel = { ...ref, ...(partnerId === undefined ? {} : { partner: person(partnerId) }), ...(memberIds === undefined ? {} : { members: memberIds.map(person) }) }
  const files = parseJson<NonNullable<PreviewInput['files']>>(row.files_json) ?? []
  const attachments = parseJson<NonNullable<PreviewInput['attachments']>>(row.attachments_json) ?? []
  const blocks = parseJson<PreviewInput['blocks']>(row.blocks_json)
  const preview = messagePreviewText(
    { text: row.text ?? '', ...(blocks === undefined ? {} : { blocks }), ...(files.length === 0 ? {} : { files }), ...(attachments.length === 0 ? {} : { attachments }), ...(row.subtype === null ? {} : { subtype: row.subtype }) },
    lookups,
  )
  const reply = isReply(row)
  const thread = reply ? shaper.titles.get(`${row.channel}:${row.thread_ts}`) : undefined
  const threadTitle = thread === undefined ? undefined : (thread.manual ?? thread.ai ?? firstWords(thread.text, undefined, lookups))
  const reactor = person(row.feed_user)
  const realName = users.get(row.feed_user)?.real_name ?? undefined
  const first = shortName({ id: reactor.id, name: reactor.name, ...(realName === undefined ? {} : { realName }) }, [])
  return {
    id: `${row.channel}:${row.ts}`,
    topicId: reply ? threadTopicId(row.channel as ChannelId, row.thread_ts as Ts) : mainTopicId(row.channel as ChannelId),
    ts: row.ts,
    at: row.at,
    reactor,
    others,
    who: others > 0 ? `${first} +${others}` : first,
    emoji: { name: row.feed_name, ...reactionEmoji(row.feed_name, shaper.emoji) },
    preview,
    channel,
    ...(threadTitle === undefined || threadTitle === '' ? {} : { threadTitle }),
    ...(thread !== undefined && thread.manual === null && thread.ai === null ? { threadTitleSensitive: true } : {}),
  }
}

/** Reads the view's rows. */
export const readReactionFeed = (selfId: string | undefined, now: number): Effect.Effect<ReactionFeedRun, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statements = reactionFeedStatements(now - REACTION_DAYS * DAY)
    const feed = yield* sql.unsafe<FeedRow>(statements.feed.sql, statements.feed.params)
    const missing: Array<{ channel: string; ts: string }> = []
    const stored: Array<FeedRow> = []
    for (const row of feed) {
      const lacking = row.m_ts === null || (row.user_id === null && row.text === '' && row.blocks_json === null)
      if (lacking) missing.push({ channel: row.channel, ts: row.ts })
      else if (row.deleted !== 1 && row.user_id === selfId) stored.push(row)
    }
    const { reactions, titles } = yield* readMessageParts(stored, statements)
    const picked = stored.flatMap((row) => {
      const reactors = reactorsOf(reactions.get(`${row.channel}:${row.ts}`) ?? [], selfId)
      if (reactors.size === 0 && row.known === 1) return []
      return [{ row, others: reactors.size - (reactors.has(row.feed_user) ? 1 : 0) }]
    })

    // The headline reactors, the DM partners and group members for line three, and the people the previews mention.
    const ids = new Set<string>()
    for (const { row } of picked) {
      for (const id of [row.feed_user, ...parseIds(row.c_members), ...mentionedUserIds(row.text ?? '')]) ids.add(id)
      if (row.c_user_id !== null) ids.add(row.c_user_id)
    }
    const users = new Map<string, MessageUser>()
    if (ids.size > 0) {
      const read = messageUsersStatement([...ids])
      for (const user of yield* sql.unsafe<MessageUser>(read.sql, read.params)) users.set(user.id, user)
    }
    const emoji = { emoji: new Map<string, string | null>(), emojiAliases: new Map<string, string>() }
    const custom = [...new Set(picked.map(({ row }) => row.feed_name))].filter((name) => emojiUnicode(name) === undefined).map((name) => splitEmojiName(name).name)
    if (custom.length > 0) yield* readEmoji(sql, emoji, custom)

    const shaper: Shaper = { selfId, users, titles, emoji }
    return { rows: picked.map(({ row, others }) => shapeRow(row, others, shaper)), missing }
  })
