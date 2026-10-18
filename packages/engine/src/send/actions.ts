/**
 * Edit, delete and react (spec section 7; architecture 5.7). Each command
 * writes its outbox row (or rewrites a post Slack has not got) in one
 * transaction and answers; `ActionWorker` sends it. None has an undo
 * (ADR 0010).
 *
 * An edit keeps the message's mentions: the composer text names people and
 * channels as "@Maya Chen" and "#eng", so the names the message mentioned
 * are turned back into Slack's ids when it is composed again. Its linked
 * words show as their text, so they are linked again where they still stand.
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, Rejected, type MessageActionError, type MessageRef } from '@juno/contract'
import { composeOutgoing, type MentionTargets } from '@juno/richtext'
import { StoreWriter, transaction, type Invalidation, type SqlError } from '@juno/store'
import { resolveFailedAction, queueDelete, queueEdit, queueReaction, resolveTarget, storedMe, type ActionRefusal, type MessageRef as StoreRef } from '@juno/sync'
import { userName, type UserRow } from '../topicRows'
import { Workspace } from '../workspace'

const toStoreRef = (message: MessageRef): StoreRef => ({ channel: message.channelId, ts: message.ts, clientMsgId: message.clientMsgId })

const refused = (message: MessageRef, refusal: ActionRefusal | undefined): Effect.Effect<void, NotFound> =>
  refusal === undefined ? Effect.void : Effect.fail(new NotFound({ kind: 'message', id: message.ts }))

/** Runs a store effect in the open workspace, in one transaction, with the signed-in user's id. A store failure is a bug (architecture 2.6). */
const inWorkspace = <A>(
  run: (selfId: string, now: number) => Effect.Effect<A, SqlError, StoreWriter | Invalidation>,
): Effect.Effect<A, NotSignedIn, Workspace> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotSignedIn()
    const now = yield* Clock.currentTimeMillis
    return yield* transaction(
      Effect.gen(function* () {
        const me = yield* storedMe
        return yield* run(me?.userId ?? '', now)
      }),
    ).pipe(Effect.provide(open.context), Effect.orDie)
  })

const USER_ID = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>|"user_id":"([UW][A-Z0-9]+)"/g
const CHANNEL_ID = /<#([CGD][A-Z0-9]+)(?:\|[^>]*)?>|"channel_id":"([CGD][A-Z0-9]+)"/g

const idsIn = (pattern: RegExp, sources: ReadonlyArray<string | null>): ReadonlyArray<string> => {
  const ids = new Set<string>()
  for (const source of sources) if (source !== null) for (const match of source.matchAll(pattern)) ids.add(match[1] ?? match[2]!)
  return [...ids]
}

/** The words a message's `link` elements put a link on, from its blocks. */
const linkedWords = (blocksJson: string | null): ReadonlyArray<{ readonly text: string; readonly url: string }> => {
  if (blocksJson === null) return []
  const out: Array<{ readonly text: string; readonly url: string }> = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk)
    else if (node !== null && typeof node === 'object') {
      const el = node as Record<string, unknown>
      if (el['type'] === 'link' && typeof el['url'] === 'string' && typeof el['text'] === 'string') out.push({ text: el['text'], url: el['url'] })
      Object.values(el).forEach(walk)
    }
  }
  try {
    walk(JSON.parse(blocksJson))
  } catch {
    return []
  }
  return out
}

/** The people and channels a message mentions, by the names its edit text shows them with, and its linked words. */
const mentionTargets = (text: string, blocksJson: string | null): Effect.Effect<MentionTargets, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const userIds = idsIn(USER_ID, [text, blocksJson])
    const channelIds = idsIn(CHANNEL_ID, [text, blocksJson])
    const users = userIds.length === 0 ? [] : yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in(userIds)}`
    const channels = channelIds.length === 0 ? [] : yield* sql<{ id: string; name: string | null }>`SELECT id, name FROM conversations WHERE id IN ${sql.in(channelIds)}`
    return {
      people: users.map((user) => ({ id: user.id, name: userName(user.id, user) })),
      channels: channels.flatMap((channel) => (channel.name === null ? [] : [{ id: channel.id, name: channel.name }])),
      links: linkedWords(blocksJson),
    }
  })

export const editMessage = (message: MessageRef, text: string): Effect.Effect<void, MessageActionError, Workspace> =>
  Effect.gen(function* () {
    if (text.trim() === '') return yield* new Rejected({ code: 'no_text' })
    const refusal = yield* inWorkspace((selfId, now) =>
      Effect.gen(function* () {
        const ref = toStoreRef(message)
        const target = yield* resolveTarget(ref)
        const targets =
          target === undefined
            ? {}
            : target.kind === 'stored'
              ? yield* mentionTargets(target.row.text, target.row.blocks_json)
              : yield* mentionTargets(target.post.text, target.post.blocksJson)
        const outgoing = composeOutgoing(text, targets)
        return yield* queueEdit({ ref, text: outgoing.text, blocksJson: JSON.stringify(outgoing.blocks), selfId, now })
      }),
    )
    yield* refused(message, refusal)
  })

export const deleteMessage = (message: MessageRef): Effect.Effect<void, MessageActionError, Workspace> =>
  Effect.gen(function* () {
    const refusal = yield* inWorkspace((selfId, now) => queueDelete({ ref: toStoreRef(message), selfId, now }))
    yield* refused(message, refusal)
  })

export const reactToMessage = (message: MessageRef, name: string, on: boolean): Effect.Effect<void, MessageActionError, Workspace> =>
  Effect.gen(function* () {
    const refusal = yield* inWorkspace((_, now) => queueReaction({ ref: toStoreRef(message), name, on, now }))
    yield* refused(message, refusal)
  })

export const resolveMessageAction = (id: number, retry: boolean) =>
  inWorkspace((_, now) => resolveFailedAction(id, retry, now))
