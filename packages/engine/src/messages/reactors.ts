/**
 * The `reactions.who` query: everyone who reacted to one message, for the
 * "who reacted" dialog. It reads the message's reactions as the topic window
 * does (`query.ts`): the user's own changes not yet in Slack applied, emoji
 * resolved the same way, people shaped as the window's `refs`. Unlike the
 * window it keeps every reactor, not the first ten.
 *
 * A run reports whether a reaction lists fewer people than its count
 * (`short`) and which ids the store has no user for (`unknown`); the
 * handler fetches the full list and asks for those names.
 */
import { Effect } from 'effect'
import type { Person, WhoReacted } from '@juno/contract'
import { emojiUnicode, splitEmojiName } from '@juno/richtext'
import { StoreReader, type SqlError } from '@juno/store'
import { reactionEmoji, readEmoji } from '../emojiLookup'
import { personFrom } from '../topicRows'
import {
  intentOf,
  intentsOf,
  messageUsersStatement,
  orderedReactors,
  reach,
  unreachable,
  withReactionIntents,
  type ActionRow,
  type MessageUser,
  type StoredReaction,
} from './query'
import { actionsStatement } from './window'

export interface WhoReactedRun {
  /** `null` for a message the store does not have, or one deleted. */
  readonly value: Omit<WhoReacted, 'loading'> | null
  /** A stored reaction lists fewer people than its count. */
  readonly revision: string
  readonly short: boolean
  /** Reactors the store has no user for. */
  readonly unknown: ReadonlyArray<string>
}

const parseUsers = (json: string | null): ReadonlyArray<string> => {
  try {
    const value: unknown = JSON.parse(json ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** The message and its reactions, both by primary key. Exported for the plan test. */
export function whoReactedStatements(channel: string, ts: string) {
  return {
    message: { sql: 'SELECT client_msg_id, deleted FROM messages WHERE channel = ? AND ts = ?', params: [channel, ts] },
    reactions: { sql: 'SELECT name, count, me, user_ids_json FROM reactions WHERE channel = ? AND ts = ? ORDER BY rowid', params: [channel, ts] },
  } as const
}

/** Reads one message's reactions and the people who reacted. Three lookups by primary key, the outbox by channel, then users and emoji by id. */
export const whoReacted = (channel: string, ts: string): Effect.Effect<WhoReactedRun, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statements = whoReactedStatements(channel, ts)
    const messages = yield* sql.unsafe<{ client_msg_id: string | null; deleted: 0 | 1 }>(statements.message.sql, statements.message.params)
    const message = messages[0]
    if (message === undefined || message.deleted === 1) return { value: null, revision: '', short: false, unknown: [] }
    const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const selfId = team[0]?.self_user_id ?? undefined
    const stored: Array<StoredReaction> = []
    const rows = yield* sql.unsafe<{ name: string; count: number; me: 0 | 1; user_ids_json: string | null }>(statements.reactions.sql, statements.reactions.params)
    for (const row of rows) {
      stored.push({ name: row.name, count: row.count, me: row.me, users: parseUsers(row.user_ids_json) })
    }
    const short = stored.some((reaction) => reaction.users.length < reaction.count)

    // The user's own changes Slack does not have yet, as the chips show them (architecture 5.7).
    const statement = actionsStatement(channel)
    const actions = yield* sql.unsafe<ActionRow>(statement.sql, statement.params)
    const intent = actions.length === 0 ? undefined : intentOf(intentsOf(actions), { ts, client_msg_id: message.client_msg_id })
    if (intent?.deleted === true) return { value: null, revision: '', short: false, unknown: [] }
    const reactions = intent === undefined || intent.reactions.size === 0 ? stored : withReactionIntents(stored, intent.reactions, selfId)

    const ordered = reactions.map((reaction) => orderedReactors(reaction.users, reaction.me === 1, selfId))
    const ids = [...new Set(ordered.flat())]
    const users = new Map<string, MessageUser>()
    if (ids.length > 0) {
      const read = messageUsersStatement(ids)
      for (const user of yield* sql.unsafe<MessageUser>(read.sql, read.params)) users.set(user.id, user)
    }
    const people: Array<Person> = []
    const unknown: Array<string> = []
    for (const id of ids) {
      const user = users.get(id)
      if (user === undefined) unknown.push(id)
      else people.push(reach(personFrom(id, user), unreachable(user)))
    }

    const emoji = { emoji: new Map<string, string | null>(), emojiAliases: new Map<string, string>() }
    const custom = reactions.filter((reaction) => emojiUnicode(reaction.name) === undefined).map((reaction) => splitEmojiName(reaction.name).name)
    if (custom.length > 0) yield* readEmoji(sql, emoji, custom)

    return {
      value: {
        reactions: reactions.map((reaction, index) => ({
          name: reaction.name,
          count: reaction.count,
          me: reaction.me === 1,
          ...reactionEmoji(reaction.name, emoji),
          users: ordered[index]!,
        })),
        people,
      },
      revision: JSON.stringify(rows.map(({ name, count, user_ids_json }) => ({ name, count, user_ids_json }))),
      short,
      unknown,
    }
  })
