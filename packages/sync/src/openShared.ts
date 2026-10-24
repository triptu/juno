/**
 * What the open fetches share (`open.ts` for Main and the dispatch,
 * `openThread.ts` for threads): the page sizes, the result, and the checks
 * both make of the store.
 */
import { millisToTs } from '@juno/domain'
import type { SlackApi, SlackApiError } from '@juno/slack'
import type { Message } from '@juno/slack-schema'
import { StoreWriter, type Invalidation, type MessageRow, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import { referencedUserIds } from './users'

/** Messages one open fetches at most to reach the read pointer. */
export const OPEN_FETCH_MAX = 500
/** Messages per page when opening and when loading older messages. */
export const OPEN_PAGE = 100
/** Main's first page when the store has no history of the channel (architecture 5.5). */
export const MAIN_FIRST_PAGE = 50
/** The `from_ts` of a synced range that reaches the start of a conversation. */
export const HISTORY_START = '0000000000.000000'

export type FetchLane = 'interactive' | 'background'

export type OpenError = SlackApiError | SqlError
export type OpenServices = SlackApi | StoreWriter | Invalidation

/** What a fetch did. `fetched`: a call was made. `complete`: the store now holds the topic from its first message. */
export interface FetchReport {
  readonly fetched: boolean
  readonly complete: boolean
  /** Senders on the fetched pages the `users` table lacks; the caller names them. */
  readonly unknownUsers: ReadonlyArray<string>
}

export const nowTs = Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))

type RootContent = Pick<MessageRow, 'user_id' | 'text' | 'blocks_json'>

/** A root the store knows only from a reply; its content has not arrived. */
export const isStub = (root: RootContent): boolean =>
  root.user_id === null && root.text === '' && root.blocks_json === null

/** The message is stored with its whole content: not a search match, not a root known only from a reply. */
export const storedInFull = (channel: string, ts: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<RootContent & { partial: 0 | 1 }>`
      SELECT user_id, text, blocks_json, partial FROM messages WHERE channel = ${channel} AND ts = ${ts}`
    const row = rows[0]
    return row !== undefined && row.partial === 0 && !isStub(row)
  })

/** People `messages` show (senders, mentions, repliers) with no `users` row, for the caller to name. */
export const unknownSenders = (messages: ReadonlyArray<Message>): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const ids = new Set(referencedUserIds(messages))
    if (ids.size === 0) return []
    const sql = yield* StoreWriter
    const known = yield* sql<{ id: string }>`SELECT id FROM users WHERE id IN ${sql.in([...ids])}`
    for (const row of known) ids.delete(row.id)
    return [...ids]
  })
