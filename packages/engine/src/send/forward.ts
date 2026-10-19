/**
 * `messages.forward` (spec section 7, "Forward"; research
 * `slack-forward.md`): a stored message shared into another conversation's
 * Main, with an optional note, as the official client's Forward dialog
 * does it.
 *
 * A forward is a post. It is queued as a `pending_messages` row in the
 * destination like `messages.send` queues one, with the note as its text
 * and the source in `share_json`, and `PostWorker` sends it once with
 * `chat.shareMessage` instead of `chat.postMessage`. Slack's answer carries
 * no message, so the row waits for the echo or a lookup, which match the
 * stored copy by `client_msg_id`, as for `files.share` (`worker.ts`).
 *
 * Until then the list shows the row with a shared-message card built here
 * from the stored source, in the shape Slack's copy will have, so the row
 * keeps its place and size when Slack's copy replaces it.
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, Rejected, type SendError, type SendResult, type SendTarget } from '@juno/contract'
import { mainTopicId, type ChannelId } from '@juno/domain'
import { StoreWriter, transaction, type SqlError } from '@juno/store'
import type { PendingShare } from '@juno/sync'
import { Outbox } from '../outbox'
import { queueText } from '../postQueue'
import { SyncLink } from '../syncLink'
import { userName, type UserRow } from '../topicRows'
import { Workspace } from '../workspace'
import { conversationOf } from './commands'

export interface ForwardInput {
  readonly to: SendTarget
  readonly note: string
  readonly clientMsgId: string
  readonly source: { readonly channelId: string; readonly ts: string }
}

export const forwardMessage = (input: ForwardInput): Effect.Effect<SendResult, SendError, Outbox | Workspace | SyncLink> =>
  Effect.gen(function* () {
    // One destination's Main for v1: Slack's Forward dialog has no thread either.
    if (input.to.kind === 'channel' && input.to.threadTs !== undefined) return yield* new Rejected({ code: 'invalid_target' })
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotSignedIn()
    const share = yield* sourceShare(input.source.channelId, input.source.ts).pipe(Effect.provide(open.context), Effect.orDie)
    if (share === undefined) return yield* new NotFound({ kind: 'message', id: input.source.ts })
    const channel = yield* conversationOf(input.to)
    const now = yield* Clock.currentTimeMillis
    yield* transaction(queueText({ clientMsgId: input.clientMsgId, channel, threadTs: undefined, text: input.note, share, createdAt: now })).pipe(
      Effect.provide(open.context),
      Effect.orDie,
    )
    return { topicId: mainTopicId(channel as ChannelId) }
  })

interface SourceRow {
  readonly ts: string
  readonly thread_ts: string | null
  readonly user_id: string | null
  readonly bot_name: string | null
  readonly bot_icon: string | null
  readonly text: string
  readonly blocks_json: string | null
  readonly reply_count: number
}

/**
 * The source message as Slack's shared-message attachment shows it: the
 * author, the words as blocks and as mrkdwn, and where it was posted.
 * Undefined when the message is not stored, is deleted, or is a pending
 * row Slack does not have yet.
 */
const sourceShare = (channel: string, ts: string): Effect.Effect<PendingShare | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const source = (yield* sql<SourceRow>`SELECT ts, thread_ts, user_id, bot_name, bot_icon, text, blocks_json, reply_count
      FROM messages WHERE channel = ${channel} AND ts = ${ts} AND deleted = 0`)[0]
    if (source === undefined) return undefined
    const user =
      source.user_id === null ? undefined : (yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id = ${source.user_id}`)[0]
    const conversation = (yield* sql<{ kind: string; name: string | null }>`SELECT kind, name FROM conversations WHERE id = ${channel}`)[0]
    const name = source.bot_name ?? userName(source.user_id ?? '', user)
    const icon = source.bot_icon ?? user?.avatar_url ?? undefined
    const where = (conversation?.kind === 'public' || conversation?.kind === 'private') && conversation.name !== null ? `#${conversation.name}` : 'a direct message'
    const inThread = (source.thread_ts !== null && source.thread_ts !== source.ts) || source.reply_count > 0
    const attachment = {
      is_msg_unfurl: true,
      is_share: true,
      color: 'D0D0D0',
      ts: source.ts,
      channel_id: channel,
      ...(source.user_id === null ? {} : { author_id: source.user_id }),
      author_name: name,
      ...(icon === undefined ? {} : { author_icon: icon }),
      text: source.text,
      fallback: `${name}: ${source.text}`,
      mrkdwn_in: ['text'],
      ...(source.blocks_json === null ? {} : { blocks: JSON.parse(source.blocks_json) as unknown }),
      footer: `${inThread ? 'Thread in' : 'Posted in'} ${where}`,
    }
    return { channel, ts: source.ts, attachment }
  })
