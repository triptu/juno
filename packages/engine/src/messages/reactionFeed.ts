/**
 * The `reactions.feed` query (SPEC 5, "Reactions"): the newest rows of
 * `reaction_feed` within `REACTION_DAYS`, at most `REACTION_ROWS`, each
 * shaped from its stored message. A row shows who reacted and with what as
 * the message's reactions say now, so a removed reaction changes the row and
 * one with no one else's reaction left drops out.
 *
 * Rows whose message the store lacks, or whose stored reactions may be
 * older than the row (`fetched_at`), are reported as `missing`; the handler
 * asks the sync to fetch them. Until then the feed's own reaction shows. Statements are exported for the plan test.
 */
import { Effect } from 'effect'
import { REACTION_DAYS, REACTION_ROWS, type Person, type ReactionRow, type ReactionRowEmoji, type RowChannel } from '@juno/contract'
import { firstWords, mainTopicId, mentionedUserIds, messagePreviewText, shortName, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { emojiUnicode, splitEmojiName } from '@juno/richtext'
import { StoreReader, type SqlError } from '@juno/store'
import { channelInfoOf, channelRefOf, parseIds, personFrom, userName } from '../topicRows'
import { messageUsersStatement, reactionEmoji, readEmoji, type MessageUser } from './query'
import { reactionsStatement } from './window'

const DAY = 24 * 60 * 60 * 1000

type PreviewInput = Parameters<typeof messagePreviewText>[0]
const SHOWN_REACTORS = 2
const SHOWN_EMOJI = 3

export interface ReactionFeedRun {
  readonly rows: ReadonlyArray<ReactionRow>
  /** Rows of the window whose message the store does not have, or has from before the row's reaction. */
  readonly missing: ReadonlyArray<{ readonly channel: string; readonly ts: string }>
}

interface FeedRow {
  readonly channel: string
  readonly ts: string
  readonly at: number
  readonly feed_user: string
  readonly feed_name: string
  readonly fetched_at: number | null
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
      sql: `SELECT f.channel, f.ts, f.at, f.user_id AS feed_user, f.name AS feed_name, f.fetched_at,
          m.ts AS m_ts, m.user_id, m.text, m.blocks_json, m.files_json, m.attachments_json, m.subtype, m.thread_ts, m.deleted,
          c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members
        FROM reaction_feed f INDEXED BY reaction_feed_at
        JOIN conversations c ON c.id = f.channel
        LEFT JOIN messages m ON m.channel = f.channel AND m.ts = f.ts
        LEFT JOIN ignored_channels ig ON ig.channel = f.channel
        WHERE f.at > ? AND ig.channel IS NULL
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

/** The stored reactions include the row's own: a socket event wrote them, or a fetch since it came. */
const fresh = (row: Pick<FeedRow, 'at' | 'fetched_at'>): boolean => row.fetched_at !== null && row.fetched_at >= row.at

type StoredReactions = ReadonlyArray<{ readonly name: string; readonly users: ReadonlyArray<string> }>
type ThreadTitle = { readonly text: string; readonly manual: string | null; readonly ai: string | null }

/** Who reacted, the latest first (the feed's reactor, then Slack's order backwards), and their emoji. Empty when no one else has a reaction left. */
function pickReactors(row: FeedRow, reactions: StoredReactions, selfId: string | undefined): { readonly people: ReadonlyArray<string>; readonly names: ReadonlyArray<string> } {
  const people = new Set<string>()
  const names = new Set<string>()
  // Until the message is fetched again, the feed's reaction is newer than what the store says.
  if (row.feed_user !== selfId && (!fresh(row) || reactions.some((reaction) => reaction.name === row.feed_name && reaction.users.includes(row.feed_user)))) {
    people.add(row.feed_user)
    names.add(row.feed_name)
  }
  for (const reaction of reactions.toReversed()) {
    const users = reaction.users.filter((user) => user !== selfId)
    if (users.length === 0) continue
    names.add(reaction.name)
    for (const user of users.toReversed()) people.add(user)
  }
  return { people: [...people], names: [...names].slice(0, SHOWN_EMOJI) }
}

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

function shapeRow(row: FeedRow, people: ReadonlyArray<string>, names: ReadonlyArray<string>, shaper: Shaper): ReactionRow {
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
  const reactors = people.slice(0, SHOWN_REACTORS).map(person)
  const more = people.length - reactors.length
  const realName = (id: string) => users.get(id)?.real_name ?? undefined
  const firstNames = reactors.map((each) => shortName({ id: each.id, name: each.name, ...(realName(each.id) === undefined ? {} : { realName: realName(each.id)! }) }, reactors)).join(', ')
  return {
    id: `${row.channel}:${row.ts}`,
    topicId: reply ? threadTopicId(row.channel as ChannelId, row.thread_ts as Ts) : mainTopicId(row.channel as ChannelId),
    ts: row.ts,
    at: row.at,
    reactors,
    moreReactors: more,
    who: more > 0 ? `${firstNames} +${more}` : firstNames,
    emoji: names.map((name): ReactionRowEmoji => ({ name, ...reactionEmoji(name, shaper.emoji) })),
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
      if (lacking || !fresh(row)) missing.push({ channel: row.channel, ts: row.ts })
      if (!lacking && row.deleted !== 1 && row.user_id === selfId) stored.push(row)
    }
    const { reactions, titles } = yield* readMessageParts(stored, statements)
    const picked = stored.flatMap((row) => {
      const { people, names } = pickReactors(row, reactions.get(`${row.channel}:${row.ts}`) ?? [], selfId)
      return people.length === 0 ? [] : [{ row, people, names }]
    })

    // The reactors shown, the DM partners and group members for line three, and the people the previews mention.
    const ids = new Set<string>()
    for (const { row, people } of picked) {
      for (const id of [...people.slice(0, SHOWN_REACTORS), ...parseIds(row.c_members), ...mentionedUserIds(row.text ?? '')]) ids.add(id)
      if (row.c_user_id !== null) ids.add(row.c_user_id)
    }
    const users = new Map<string, MessageUser>()
    if (ids.size > 0) {
      const read = messageUsersStatement([...ids])
      for (const user of yield* sql.unsafe<MessageUser>(read.sql, read.params)) users.set(user.id, user)
    }
    const emoji = { emoji: new Map<string, string | null>(), emojiAliases: new Map<string, string>() }
    const custom = [...new Set(picked.flatMap((each) => each.names))].filter((name) => emojiUnicode(name) === undefined).map((name) => splitEmojiName(name).name)
    if (custom.length > 0) yield* readEmoji(sql, emoji, custom)

    const shaper: Shaper = { selfId, users, titles, emoji }
    return { rows: picked.map(({ row, people, names }) => shapeRow(row, people, names, shaper)), missing }
  })
