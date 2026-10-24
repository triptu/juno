/**
 * The Search tab's cards (SPEC 10a, "Cards"): each result's whole message,
 * shaped as the topic shapes it (`messages/query.ts`), with its sender and
 * photo, its files, its reactions and where it stands in its thread. Built
 * with the hits: from the stored row for a match on this Mac, and from
 * Slack's match for one Slack found (`toMessageRow`, as sync stores it).
 */
import type { Person, ReactionView, SearchCard } from '@juno/contract'
import { tsToMillis, type Me, type Ts, type UserId } from '@juno/domain'
import { emojiUnicode, messageBody, splitEmojiName, type MessageContent } from '@juno/richtext'
import { StoreReader, syncState } from '@juno/store'
import { Effect } from 'effect'
import { bodyLookups, makeMessageCache, reach, reactionEmoji, readUsers, readWanted, storedFiles, unreachable, wantedNothing, wantsAny, type MessageCache, type StoredReaction } from './messages/query'
import { personFrom } from './topicRows'

/** What a card is made from: a stored message's columns. */
export interface CardRow {
  readonly channel: string
  readonly ts: string
  readonly thread_ts: string | null
  readonly user_id: string | null
  readonly bot_name?: string | null | undefined
  readonly bot_icon?: string | null | undefined
  readonly subtype?: string | null | undefined
  readonly text: string
  readonly blocks_json?: string | null | undefined
  readonly files_json?: string | null | undefined
  readonly attachments_json?: string | null | undefined
  readonly reply_count: number
  readonly latest_reply?: string | null | undefined
  readonly reply_users_json?: string | null | undefined
  /** Slack's reactions, for a match Slack found. A stored match's are read from the store. */
  readonly slackReactions?: ReadonlyArray<{ readonly name: string; readonly count?: number | undefined; readonly users?: ReadonlyArray<string> | undefined }> | undefined
}

/** Faces before a thread's reply count. */
const REPLIERS = 3

export const cardKey = (row: Pick<CardRow, 'channel' | 'ts'>): string => `${row.channel}:${row.ts}`

const parse = <A>(json: string | null | undefined): A | undefined => {
  if (json == null) return undefined
  try {
    return JSON.parse(json) as A
  } catch {
    return undefined
  }
}

const contentOf = (row: CardRow): MessageContent => ({
  text: row.text,
  ...(row.blocks_json == null ? {} : { blocks: parse<MessageContent['blocks']>(row.blocks_json) ?? [] }),
  ...(row.files_json == null ? {} : { files: parse<MessageContent['files']>(row.files_json) ?? [] }),
  ...(row.attachments_json == null ? {} : { attachments: parse<MessageContent['attachments']>(row.attachments_json) ?? [] }),
})

/** Cards for `rows`, by `cardKey`. */
export const searchCards = (rows: ReadonlyArray<CardRow>) =>
  Effect.gen(function* () {
    const cards = new Map<string, SearchCard>()
    if (rows.length === 0) return cards
    const sql = yield* StoreReader
    const selfId = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
    const me = (yield* syncState.get<Me>('me')) ?? (selfId === undefined ? undefined : { userId: selfId as UserId })
    const reactions = yield* reactionsOf(rows, selfId)
    const repliers = new Map(rows.map((row) => [cardKey(row), (parse<Array<string>>(row.reply_users_json) ?? []).slice(0, REPLIERS)]))
    const cache = makeMessageCache()
    yield* readUsers(sql, cache, [...rows.flatMap((row) => (row.user_id === null ? [] : [row.user_id])), ...[...repliers.values()].flat()])
    // Parse with what the cache holds, read what the bodies asked for, and parse again only then.
    const wanted = wantedNothing()
    const lookups = bodyLookups(cache, selfId, me, wanted)
    let bodies = rows.map((row) => messageBody(contentOf(row), lookups))
    for (const list of reactions.values()) for (const reaction of list) if (emojiUnicode(reaction.name) === undefined) lookups.emoji(splitEmojiName(reaction.name).name)
    if (wantsAny(wanted)) {
      yield* readWanted(sql, cache, wanted, selfId)
      bodies = rows.map((row) => messageBody(contentOf(row), lookups))
    }
    rows.forEach((row, index) => {
      const key = cardKey(row)
      const root = row.thread_ts === row.ts || (row.thread_ts === null && row.reply_count > 0)
      const faces = (repliers.get(key) ?? []).flatMap((id) => {
        const user = cache.users.get(id)
        return user == null ? [] : [reach(personFrom(id, user), unreachable(user))]
      })
      const shown: ReadonlyArray<ReactionView> = (reactions.get(key) ?? []).map((reaction) => ({ name: reaction.name, count: reaction.count, me: reaction.me === 1, ...reactionEmoji(reaction.name, cache) }))
      cards.set(key, {
        body: bodies[index]!,
        files: storedFiles({ files_json: row.files_json ?? null, attachments_json: row.attachments_json ?? null }),
        reactions: shown,
        sender: senderOf(row, cache),
        app: row.bot_name != null || row.bot_icon != null || row.subtype === 'bot_message' || cache.users.get(row.user_id ?? '')?.is_bot === 1,
        reply: row.thread_ts !== null && row.thread_ts !== row.ts,
        ...(root && row.reply_count > 0
          ? { thread: { replyCount: row.reply_count, ...(row.latest_reply == null ? {} : { lastReplyAt: tsToMillis(row.latest_reply as Ts) }), repliers: faces } }
          : {}),
      })
    })
    return cards
  })

/** The sender as the topic draws them: a post with its own name or icon (an app, a webhook) as that sender. */
function senderOf(row: CardRow, cache: MessageCache): Person {
  const user = row.user_id === null ? undefined : cache.users.get(row.user_id)
  if (row.bot_name != null || row.bot_icon != null) {
    const id = `bot:${row.channel}:${row.ts}`
    const name = row.bot_name ?? row.user_id ?? ''
    const person = personFrom(id, { id, name, display_name: name, real_name: null, avatar_url: row.bot_icon ?? user?.avatar_url ?? null, avatar_small_url: null, avatar_large_url: null })
    return { ...person, ...(unreachable(user) || row.user_id === null ? { unreachable: true as const } : { user: row.user_id }) }
  }
  if (row.user_id === null) return { ...personFrom(`unknown:${row.channel}:${row.ts}`, undefined), unreachable: true }
  return reach(personFrom(row.user_id, user), unreachable(user))
}

/** Each row's reactions, in Slack's order: Slack's own for a match it found, the store's for the rest. */
const reactionsOf = (rows: ReadonlyArray<CardRow>, selfId: string | undefined) =>
  Effect.gen(function* () {
    const out = new Map<string, Array<StoredReaction>>()
    const local = rows.filter((row) => row.slackReactions === undefined)
    for (const row of rows) {
      if (row.slackReactions === undefined) continue
      out.set(cardKey(row), row.slackReactions.map((reaction) => ({ name: reaction.name, count: reaction.count ?? reaction.users?.length ?? 1, me: selfId !== undefined && reaction.users?.includes(selfId) === true ? 1 : 0, users: reaction.users ?? [] })))
    }
    if (local.length === 0) return out
    const sql = yield* StoreReader
    const wanted = new Set(local.map(cardKey))
    const found = yield* sql<{ channel: string; ts: string; name: string; count: number; me: 0 | 1 }>`SELECT channel, ts, name, count, me FROM reactions
      WHERE channel IN ${sql.in([...new Set(local.map((row) => row.channel))])} AND ts IN ${sql.in([...new Set(local.map((row) => row.ts))])} ORDER BY channel, ts, rowid`
    for (const reaction of found) {
      const key = `${reaction.channel}:${reaction.ts}`
      if (!wanted.has(key)) continue
      let list = out.get(key)
      if (list === undefined) out.set(key, (list = []))
      list.push({ name: reaction.name, count: reaction.count, me: reaction.me, users: [] })
    }
    return out
  })
