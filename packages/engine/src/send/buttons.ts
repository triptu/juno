/**
 * `messages.attachmentAction`: a press on a legacy attachment's button,
 * sent as the official client sends it, for Slackbot's notes and any app's
 * buttons (research `integration-shapes.md`, "Buttons on a Slackbot
 * message"). The payload is built from the stored message: the action as
 * Slack sent it, where the message is, and whether it is ephemeral.
 *
 * Nothing is written locally. Slack sends what the press changed on the
 * socket (the message replaced or `message_deleted`), and the sync stores it.
 * The call goes once (`sendOnce`): a press is not retried behind the user.
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, type MessageRef, type SendError } from '@juno/contract'
import { StoreWriter, type MessageRow, type SqlError } from '@juno/store'
import type { Ts } from '@juno/domain'
import type { MessageContent } from '@juno/richtext'
import { Outbox } from '../outbox'
import { Workspace } from '../workspace'

export interface ButtonPress {
  readonly message: MessageRef
  readonly attachment: string
  readonly button: string
}

type ButtonRow = Pick<MessageRow, 'ts' | 'thread_ts' | 'user_id' | 'attachments_json' | 'ephemeral' | 'bot_id'>

export const pressButton = (press: ButtonPress): Effect.Effect<void, SendError, Workspace | Outbox> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotSignedIn()
    const channel = press.message.channelId
    const row = yield* readRow(channel, press.message.ts).pipe(Effect.provide(open.context), Effect.orDie)
    const attachments = row?.attachments_json == null ? [] : (JSON.parse(row.attachments_json) as NonNullable<MessageContent['attachments']>)
    const attachment = attachments.find((each) => each.id !== undefined && String(each.id) === press.attachment)
    const action = attachment?.actions?.find((each) => each.id !== undefined && String(each.id) === press.button)
    if (row === undefined || attachment === undefined || action === undefined) return yield* new NotFound({ kind: 'button', id: press.button })
    // A message with no `user` keeps its `bot_id` in `user_id` (`toMessageRow`): then there is no bot user to name.
    const botUser = row.user_id !== null && row.user_id !== row.bot_id ? row.user_id : undefined
    const now = yield* Clock.currentTimeMillis
    yield* (yield* Outbox).sendOnce((api) =>
      api.call('chat.attachmentAction', {
        payload: {
          actions: [action],
          attachment_id: press.attachment,
          ...(attachment.callback_id === undefined ? {} : { callback_id: attachment.callback_id }),
          channel_id: channel,
          is_ephemeral: row.ephemeral === 1,
          ...(row.thread_ts === null || row.thread_ts === row.ts ? {} : { thread_ts: row.thread_ts as Ts }),
          message_ts: row.ts as Ts,
          prompt_app_install: false,
        },
        client_token: `web-${now}`,
        ...(row.bot_id == null ? {} : { service_id: row.bot_id }),
        ...(botUser === undefined ? {} : { bot_user_id: botUser }),
      }),
    )
  })

const readRow = (channel: string, ts: string): Effect.Effect<ButtonRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return (yield* sql<ButtonRow>`SELECT ts, thread_ts, user_id, attachments_json, ephemeral, bot_id FROM messages WHERE channel = ${channel} AND ts = ${ts} AND deleted = 0`)[0]
  })
