/**
 * The send commands (spec sections 8 and 9; architecture 5.7).
 *
 * `messages.send` queues a message for a channel, a thread or a person:
 *
 * 1. A person with no DM yet gets one: `conversations.open` with `users`,
 *    stored as the socket's `im_created` would store it. This step needs
 *    Slack; a failure fails the command and the renderer keeps the draft.
 * 2. One transaction writes the pending row (`queued`, with the text as one
 *    `rich_text` block and its mrkdwn fallback, as the post will carry it,
 *    and the staged files it names) and clears the composer's draft. The
 *    list shows the row at once.
 * 3. `PostWorker` posts it and reconciles (`worker.ts`).
 *
 * `messages.retry` and `messages.discard` are Retry and Delete draft on a
 * failed row.
 */
import { Clock, Effect } from 'effect'
import { MAX_FILES_PER_MESSAGE, NotFound, NotSignedIn, Rejected, type SendError, type SendResult, type SendTarget } from '@juno/contract'
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { StoreWriter, transaction } from '@juno/store'
import { discardPost, readPost, retryPost, sendDraft, startThread } from '@juno/sync'
import { Staging } from '../staging'
import { Outbox } from '../outbox'
import { queueText } from '../postQueue'
import { SyncLink } from '../syncLink'
import { Workspace } from '../workspace'

export interface SendInput {
  readonly startThread?: boolean
  readonly to: SendTarget
  readonly text: string
  readonly clientMsgId: string
  /** The topic whose draft this was, cleared with the queuing. */
  readonly draftOf?: string | undefined
  /** Staged files (`files.stage`) that go with the text. */
  readonly files?: ReadonlyArray<string> | undefined
}

export const sendMessage = (input: SendInput): Effect.Effect<SendResult, SendError, Outbox | Workspace | Staging | SyncLink> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const staging = yield* Staging
    const { to } = input
    const fileIds = input.files ?? []
    if (input.text.trim() === '' && fileIds.length === 0) return yield* new Rejected({ code: 'no_text' })
    if (fileIds.length > MAX_FILES_PER_MESSAGE) return yield* new Rejected({ code: 'too_many_files' })
    const open = yield* workspace.current
    if (open === undefined) return yield* new NotSignedIn()
    const channel = yield* conversationOf(to)
    const threadTs = to.kind === 'channel' ? to.threadTs : undefined
    // Taken last, after the DM is open: a failed send leaves the chips as they were.
    const files = fileIds.length === 0 ? [] : yield* staging.take(fileIds)
    const now = yield* Clock.currentTimeMillis
    const topicId = yield* transaction(
      Effect.gen(function* () {
        // Slack's draft goes with the post (`draft_id`) when the post goes where the draft was; a post sent elsewhere leaves it for Juno to delete.
        const here = input.draftOf !== undefined && input.startThread !== true && input.draftOf === (threadTs === undefined ? mainTopicId(channel as ChannelId) : threadTs.startsWith('pending:') ? `p:${channel}:${threadTs.slice(8)}` : threadTopicId(channel as ChannelId, threadTs as Ts))
        // The draft remembers the text this post carries, so that text never comes back as the draft.
        const draftId = input.draftOf === undefined ? undefined : yield* sendDraft(input.draftOf, input.text, now, here)
        const text = yield* queueText({ clientMsgId: input.clientMsgId, channel, threadTs, text: input.text, files, createdAt: now, ...(draftId === undefined ? {} : { draftId }) })
        if (input.startThread === true && threadTs === undefined) {
          const sql = yield* StoreWriter
          const conversation = (yield* sql<{ kind: string }>`SELECT kind FROM conversations WHERE id = ${channel}`)[0]
          if (conversation !== undefined && conversation.kind !== 'im') {
            return yield* startThread({ channel, clientMsgId: input.clientMsgId, text, createdAt: now })
          }
        }
        return threadTs === undefined ? mainTopicId(channel as ChannelId) : threadTs.startsWith('pending:') ? `p:${channel}:${threadTs.slice(8)}` : threadTopicId(channel as ChannelId, threadTs as Ts)
      }),
    ).pipe(Effect.provide(open.context), Effect.orDie)
    return { topicId }
  })

/**
 * The conversation a message to `to` goes to. A person with no DM yet gets
 * one: `conversations.open`, stored as the socket's `im_created` would
 * store it. That needs Slack, and a failure fails the command.
 */
export const conversationOf = (to: SendTarget): Effect.Effect<string, SendError, Outbox | SyncLink> =>
  Effect.gen(function* () {
    if (to.kind === 'channel') return to.channelId
    const fetcher = yield* (yield* SyncLink).fetcher
    if (fetcher === undefined) return yield* new NotSignedIn()
    const opened = (yield* (yield* Outbox).send((api) => api.call('conversations.open', { users: to.userId, return_im: true }))).channel
    // A store failure is a bug, not a state the user can act on (architecture 2.6).
    yield* fetcher.opened(opened).pipe(Effect.orDie)
    return opened.id
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

/** Delete draft: the failed row is removed, and its staged files with it. */
export const discardMessage = (clientMsgId: string): Effect.Effect<void, NotFound, Workspace | Staging> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotFound({ kind: 'pending message', id: clientMsgId })
    const post = yield* readPost(clientMsgId).pipe(Effect.provide(open.context), Effect.orDie)
    const removed = yield* transaction(discardPost(clientMsgId)).pipe(Effect.provide(open.context), Effect.orDie)
    if (!removed) return yield* new NotFound({ kind: 'pending message', id: clientMsgId })
    if (post !== undefined) yield* (yield* Staging).release(open, post.files)
  })
