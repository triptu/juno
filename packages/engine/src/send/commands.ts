/**
 * The send commands (spec sections 8 and 9; architecture 5.7).
 *
 * `messages.send` queues a message for a channel, a thread or a person:
 *
 * 1. A person with no DM yet gets one: `conversations.open` with `users`,
 *    stored as the socket's `im_created` would store it. This step needs
 *    Slack; a failure fails the command and the renderer keeps the draft.
 * 2. One transaction writes the pending row (`queued`, with the text as one
 *    `rich_text` block and its mrkdwn fallback, as the post will carry it)
 *    and clears the composer's draft. The list shows the row at once.
 * 3. `PostWorker` posts it and reconciles (`worker.ts`).
 *
 * `messages.retry` and `messages.discard` are Retry and Delete draft on a
 * failed row.
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, Rejected, type SendError, type SendResult, type SendTarget } from '@juno/contract'
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { composeOutgoing } from '@juno/richtext'
import { transaction } from '@juno/store'
import { applyOpened, discardPost, queuePost, retryPost } from '@juno/sync'
import { Outbox } from '../outbox'
import { Workspace } from '../workspace'
import { clearDraft } from './drafts'

export interface SendInput {
  readonly to: SendTarget
  readonly text: string
  readonly clientMsgId: string
  /** The topic whose draft this was, cleared with the queuing. */
  readonly draftOf?: string | undefined
}

export const sendMessage = (input: SendInput): Effect.Effect<SendResult, SendError, Outbox | Workspace> =>
  Effect.gen(function* () {
    const outbox = yield* Outbox
    const workspace = yield* Workspace
    const { to } = input
    if (input.text.trim() === '') return yield* new Rejected({ code: 'no_text' })
    const open = yield* workspace.current
    if (open === undefined) return yield* new NotSignedIn()
    let channel: string
    if (to.kind === 'person') {
      const opened = (yield* outbox.send((api) => api.call('conversations.open', { users: to.userId, return_im: true }))).channel
      // A store failure is a bug, not a state the user can act on (architecture 2.6).
      yield* applyOpened(opened).pipe(Effect.provide(open.context), Effect.orDie)
      channel = opened.id
    } else {
      channel = to.channelId
    }
    const threadTs = to.kind === 'channel' ? to.threadTs : undefined
    const outgoing = composeOutgoing(input.text)
    const now = yield* Clock.currentTimeMillis
    yield* transaction(
      Effect.gen(function* () {
        yield* queuePost({ clientMsgId: input.clientMsgId, channel, threadTs, text: outgoing.text, blocksJson: JSON.stringify(outgoing.blocks), createdAt: now })
        if (input.draftOf !== undefined) yield* clearDraft(input.draftOf)
      }),
    ).pipe(Effect.provide(open.context), Effect.orDie)
    return { topicId: threadTs === undefined ? mainTopicId(channel as ChannelId) : threadTopicId(channel as ChannelId, threadTs as Ts) }
  })

const onFailedRow =
  (change: (clientMsgId: string, now: number) => ReturnType<typeof discardPost>) =>
  (clientMsgId: string): Effect.Effect<void, NotFound, Workspace> =>
    Effect.gen(function* () {
      const open = yield* (yield* Workspace).current
      if (open === undefined) return yield* new NotFound({ kind: 'pending message', id: clientMsgId })
      const now = yield* Clock.currentTimeMillis
      const changed = yield* transaction(change(clientMsgId, now)).pipe(Effect.provide(open.context), Effect.orDie)
      if (!changed) return yield* new NotFound({ kind: 'pending message', id: clientMsgId })
    })

/** Retry: the failed row is queued again, due now. */
export const retryMessage = onFailedRow((clientMsgId, now) => retryPost(clientMsgId, now))

/** Delete draft: the failed row is removed. */
export const discardMessage = onFailedRow((clientMsgId) => discardPost(clientMsgId))
