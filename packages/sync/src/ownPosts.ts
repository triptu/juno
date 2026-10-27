/**
 * Juno's own posts that Slack has not stored yet (`pending_messages`,
 * `posts.ts`) as the topic index reads them: the user's messages at the time
 * they were queued (`reindex.ts`).
 */
import { millisToTs, type IndexMessage, type UserId } from '@juno/domain'
import type { Block, File } from '@juno/slack-schema'
import { StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'

/** A pending post as the rule reads it (`posts.ts`). */
export interface PendingRow {
  readonly client_msg_id: string
  readonly text: string
  readonly blocks_json: string | null
  readonly file_ids_json: string | null
  readonly created_at: string
}

/** Juno's own posts to Main (`threadTs` undefined) or to a thread that Slack has not stored yet, oldest first, through `pending_messages_channel`. */
export const pendingPosts = (channel: string, threadTs: string | undefined): Effect.Effect<ReadonlyArray<PendingRow>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return yield* sql<PendingRow>`SELECT client_msg_id, text, blocks_json, file_ids_json, created_at FROM pending_messages
      WHERE channel = ${channel} AND thread_ts IS ${threadTs ?? null} ORDER BY created_at, client_msg_id`
  })

/** A pending post as the user's message at the time it was queued. Its files are named by their staged names until Slack has them. */
export const ownMessage = (post: PendingRow, me: UserId): IndexMessage & { readonly text: string } => ({
  ts: millisToTs(Number(post.created_at)),
  userId: me,
  text: post.text,
  get blocks(): ReadonlyArray<Block> | undefined {
    return post.blocks_json === null ? undefined : (JSON.parse(post.blocks_json) as ReadonlyArray<Block>)
  },
  get files(): ReadonlyArray<File> | undefined {
    if (post.file_ids_json === null) return undefined
    const files = JSON.parse(post.file_ids_json) as ReadonlyArray<{ readonly id: string; readonly name: string; readonly mimetype: string }>
    return files.map((file) => ({ id: file.id, name: file.name, mimetype: file.mimetype }) as File)
  },
})
