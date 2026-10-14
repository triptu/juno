/**
 * `messages.send` (spec section 9): a message to a channel, a thread, or a
 * person.
 *
 * 1. A person with no DM yet gets one: `conversations.open` with `users`.
 * 2. `chat.postMessage` with the renderer's `client_msg_id`, the text as one
 *    `rich_text` block and its mrkdwn fallback.
 * 3. What Slack answered is stored the way the socket echo would store it
 *    (`TopicFetcher.sent`), so the topic the command returns opens at once
 *    with the message in it. The echo, when it arrives, changes nothing.
 *
 * Nothing is written before Slack accepts the message: a failed send leaves
 * the store as it was and the renderer keeps the draft. The persisted outbox
 * with an optimistic row comes with the composer (M6).
 */
import { Effect } from 'effect'
import { NotSignedIn, Rejected, type SendError, type SendResult, type SendTarget } from '@juno/contract'
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { composeOutgoing } from '@juno/richtext'
import { Outbox } from '../outbox'
import { SyncLink } from '../syncLink'

export const sendMessage = (to: SendTarget, text: string, clientMsgId: string): Effect.Effect<SendResult, SendError, Outbox | SyncLink> =>
  Effect.gen(function* () {
    const outbox = yield* Outbox
    const link = yield* SyncLink
    if (text.trim() === '') return yield* new Rejected({ code: 'no_text' })
    const opened = to.kind === 'person' ? (yield* outbox.send((api) => api.call('conversations.open', { users: to.userId, return_im: true }))).channel : undefined
    const channel = opened?.id ?? (to.kind === 'channel' ? to.channelId : undefined)
    if (channel === undefined) return yield* new NotSignedIn()
    const threadTs = to.kind === 'channel' ? to.threadTs : undefined
    const outgoing = composeOutgoing(text)
    const posted = yield* outbox.send((api) =>
      api.call('chat.postMessage', {
        channel,
        text: outgoing.text,
        blocks: outgoing.blocks,
        client_msg_id: clientMsgId,
        ...(threadTs === undefined ? {} : { thread_ts: threadTs as Ts }),
      }),
    )
    const fetcher = yield* link.fetcher
    if (fetcher === undefined) return yield* new NotSignedIn()
    // A store failure is a bug, not a state the user can act on (architecture 2.6).
    yield* fetcher.sent({ opened, channel: posted.channel, message: posted.message }).pipe(Effect.orDie)
    return { topicId: threadTs === undefined ? mainTopicId(posted.channel as ChannelId) : threadTopicId(posted.channel as ChannelId, threadTs as Ts) }
  })
