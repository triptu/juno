/**
 * The topic actions (spec section 5 "Row actions", inventory 15.1; ADR
 * 0010): resolve, reopen, pin, unpin, rename, the restore that undoes them,
 * and ignoring a channel. All of them are Juno's own state in `user.db`
 * (`topic_overlay`, `ignored_channels`); nothing goes to Slack except the
 * mark read inside a resolve, which mirrors like any mark (`marks.ts`).
 *
 * Each runs in one writer transaction and returns the undo computed from
 * the state before the change, or no undo when nothing changed. The
 * overlay undo is a `topics.restore` with the columns' old values, so a
 * resolve's undo puts back the resolve state, the Reopened tag and the
 * unread messages together.
 *
 * Resolve (architecture 4.4) stores when and at which activity the topic
 * was resolved; a later message reopens it (`reopenIfResolved` in the
 * sync). It never unfollows: Slack's follow flag is not touched.
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, type EngineConfig as Config, type CommandResult, type KeptSuggestion, type OverlayPatch, type TopicActionError, type UndoCommand } from '@juno/contract'
import { compareTs, manualTitleAfterRename, millisToTs, parseTopicId, type ParsedTopicId, type Ts } from '@juno/domain'
import { StoreWriter, transaction, type Invalidation, type SqlError } from '@juno/store'
import { patchOverlay, readOverlay, setIgnored } from '@juno/sync'
import { EngineConfig } from './config'
import { markReadStep, markUnreadStep, type Marked } from './marks'
import { Workspace } from './workspace'

type Step = (topic: ParsedTopicId, config: Config, now: number) => Effect.Effect<Marked | 'missing', SqlError, StoreWriter | Invalidation>

const unchanged: Marked = { result: {}, queued: false }

const undone = (undo: UndoCommand | undefined, queued = false): Marked => ({ result: undo === undefined ? {} : { undo }, queued })

const restore = (id: string, overlay: OverlayPatch | undefined, unreadFrom?: string): UndoCommand | undefined =>
  overlay === undefined ? undefined : { _tag: 'topics.restore', id, overlay, ...(unreadFrom === undefined ? {} : { unreadFrom }) }

/** Runs `step` on a topic id in one writer transaction of the open workspace. */
const onTopic = (id: string, step: Step): Effect.Effect<Marked, TopicActionError, Workspace | EngineConfig> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotSignedIn()
    const topic = parseTopicId(id)
    if (topic === undefined) return yield* new NotFound({ kind: 'topic', id })
    const config = yield* EngineConfig
    const now = yield* Clock.currentTimeMillis
    const outcome = yield* transaction(step(topic, config, now)).pipe(Effect.provide(open.context), Effect.orDie)
    if (outcome === 'missing') return yield* new NotFound({ kind: 'topic', id })
    return outcome
  })

/** The topic's latest activity from its index row, or undefined when the store does not know it. */
const lastActivity = (id: string): Effect.Effect<Ts | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ last_activity_ts: string }>`SELECT last_activity_ts FROM topic_index WHERE topic_id = ${id}`
    return rows[0]?.last_activity_ts as Ts | undefined
  })

/** Resolved, and no activity since (domain `isResolved`). */
const isResolvedAt = (overlay: { readonly resolvedAt: string | null; readonly resolvedActivityTs: string | null }, activity: Ts): boolean =>
  overlay.resolvedAt !== null && (overlay.resolvedActivityTs === null || compareTs(activity, overlay.resolvedActivityTs as Ts) <= 0)

export const resolveTopic = (id: string) =>
  onTopic(id, (topic, config, now) =>
    Effect.gen(function* () {
      const activity = yield* lastActivity(id)
      if (activity === undefined) return 'missing' as const
      if (isResolvedAt(yield* readOverlay(id), activity)) return unchanged
      const overlay = yield* patchOverlay(id, { resolvedAt: String(now), resolvedActivityTs: activity, reopenedAt: null })
      const marked = yield* markReadStep(id, topic, undefined, config, now)
      const unreadFrom = marked.undo?._tag === 'reads.markUnread' ? marked.undo.from : undefined
      return undone(restore(id, overlay, unreadFrom), marked.queued)
    }),
  )

/** Keep open on Tidy up: not suggested again until activity after what it has now. */
export const keepTopicOpen = (id: string) =>
  onTopic(id, () =>
    Effect.gen(function* () {
      const activity = yield* lastActivity(id)
      if (activity === undefined) return 'missing' as const
      const before = yield* readOverlay(id)
      if (before.settledDismissedTs === activity) return unchanged
      return undone(restore(id, yield* patchOverlay(id, { settledDismissedTs: activity })))
    }),
  )

/**
 * Keep following or Keep showing on Home's Unfollow or Ignore review: the
 * suggestion waits its full time again from now (`unfollowEvidence`,
 * `ignoreEvidence`).
 */
export const keepSuggested = (id: string, suggestion: KeptSuggestion) =>
  onTopic(id, (_topic, _config, now) =>
    Effect.gen(function* () {
      if ((yield* lastActivity(id)) === undefined) return 'missing' as const
      const patch: OverlayPatch = suggestion === 'unfollow' ? { unfollowKeptTs: millisToTs(now) } : { ignoreKeptTs: millisToTs(now) }
      return undone(restore(id, yield* patchOverlay(id, patch)))
    }),
  )

export const reopenTopic = (id: string) =>
  onTopic(id, () =>
    Effect.gen(function* () {
      const activity = yield* lastActivity(id)
      if (activity === undefined) return 'missing' as const
      if (!isResolvedAt(yield* readOverlay(id), activity)) return unchanged
      return undone(restore(id, yield* patchOverlay(id, { resolvedAt: null, resolvedActivityTs: null })))
    }),
  )

export const setPinned = (id: string, pinned: boolean) =>
  onTopic(id, (_topic, _config, now) =>
    Effect.gen(function* () {
      if ((yield* lastActivity(id)) === undefined) return 'missing' as const
      const before = yield* readOverlay(id)
      if ((before.pinnedAt !== null) === pinned) return unchanged
      return undone(restore(id, yield* patchOverlay(id, { pinnedAt: pinned ? String(now) : null })))
    }),
  )

export const renameTopic = (id: string, title: string) =>
  onTopic(id, (topic) =>
    Effect.gen(function* () {
      if (topic.kind !== 'thread' || (yield* lastActivity(id)) === undefined) return 'missing' as const
      const sql = yield* StoreWriter
      const ai = (yield* sql<{ ai_title: string | null }>`SELECT ai_title FROM topic_overlay WHERE topic_id = ${id}`)[0]?.ai_title ?? undefined
      return undone(restore(id, yield* patchOverlay(id, { manualTitle: manualTitleAfterRename(title, ai) ?? null })))
    }),
  )

/** The undo of the actions above. It returns no undo of its own: the renderer never undoes an undo. */
export const restoreTopic = (id: string, overlay: OverlayPatch, unreadFrom: string | undefined) =>
  onTopic(id, (topic, config, now) =>
    Effect.gen(function* () {
      if ((yield* lastActivity(id)) === undefined) return 'missing' as const
      yield* patchOverlay(id, overlay)
      const marked = unreadFrom === undefined ? unchanged : yield* markUnreadStep(id, topic, unreadFrom, config, now)
      return { result: {}, queued: marked.queued }
    }),
  )

/** Ignores a channel (`ignored`) or stops ignoring it. A DM, or a conversation the store does not know, is `NotFound`. */
export const setChannelIgnored = (channel: string, ignored: boolean): Effect.Effect<CommandResult, TopicActionError, Workspace> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotSignedIn()
    const now = yield* Clock.currentTimeMillis
    const outcome = yield* transaction(
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        const kind = (yield* sql<{ kind: string }>`SELECT kind FROM conversations WHERE id = ${channel}`)[0]?.kind
        if (kind !== 'public' && kind !== 'private') return 'missing' as const
        return yield* setIgnored(channel, ignored ? String(now) : null)
      }),
    ).pipe(Effect.provide(open.context), Effect.orDie)
    if (outcome === 'missing') return yield* new NotFound({ kind: 'channel', id: channel })
    return outcome ? { undo: { _tag: ignored ? 'channels.unignore' : 'channels.ignore', channel } } : {}
  })
