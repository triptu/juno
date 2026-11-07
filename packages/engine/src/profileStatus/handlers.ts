/**
 * Slack profile status (contract `routes/status.ts`, SPEC 14 "Your status").
 *
 * `status.of` reads one person's status from the `users` row, which every
 * user object Slack sends keeps current (`@juno/sync` `upsertUsers`). A
 * status with an expiry is served until that moment and then as none: the
 * stream waits for `expiresAt` on the engine's clock and sends the change,
 * and a new run (the row changed) cancels the wait. Nothing polls.
 *
 * `status.refresh` hands a hovered person to the sync (`refreshUsers`),
 * which asks Slack for their user object when the stored one is old; the
 * row it writes reaches `status.of` like any other change.
 *
 * `status.set` writes the user's own with `users.profile.set` on the send
 * lane, as `presence.set` is sent: one call that settles while the sheet
 * waits, nothing kept across a restart. Setting a status is safe to repeat.
 * Once Slack takes it, the row is written at once; the `user_change` Slack
 * sends after it writes the same values.
 */
import { NotSignedIn, ProfileStatus, StatusRoutes, type StatusClearAfterChoice } from '@juno/contract'
import { STATUS_DEFAULT_EMOJI, statusExpiry } from '@juno/domain'
import { emojiUnicode, splitEmojiName } from '@juno/richtext'
import { liveQuery, StoreReader, transaction } from '@juno/store'
import { writeOwnStatus } from '@juno/sync'
import { Clock, Effect, PubSub, Stream } from 'effect'
import { EngineConfig } from '../config'
import { reactionEmoji, readEmoji } from '../emojiLookup'
import { Outbox } from '../outbox'
import { HostLink } from '../protocol/host'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { untilExpiry } from './expiry'
import { SyncLink } from '../syncLink'
import { Workspace } from '../workspace'

interface StatusRow {
  readonly status_text: string | null
  readonly status_emoji: string | null
  readonly status_expiration: number | null
}

/** The stored status, its emoji drawn as reactions draw theirs; null when the person has none. Expiry is left to `untilExpiry`. */
const readStatus = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const [row] = yield* sql<StatusRow>`SELECT status_text, status_emoji, status_expiration FROM users WHERE id = ${userId}`
    const text = row?.status_text ?? ''
    const raw = (row?.status_emoji ?? '').replace(/^:|:$/g, '')
    if (text === '' && raw === '') return null
    const expiration = row?.status_expiration ?? 0
    const emoji = raw === '' ? undefined : yield* emojiOf(sql, raw)
    const status: ProfileStatus = { text, ...(emoji === undefined ? {} : { emoji }), ...(expiration > 0 ? { expiresAt: expiration * 1000 } : {}) }
    return status
  })

const emojiOf = (sql: StoreReader['Service'], name: string) =>
  Effect.gen(function* () {
    const cache = { emoji: new Map<string, string | null>(), emojiAliases: new Map<string, string>() }
    if (emojiUnicode(name) === undefined) yield* readEmoji(sql, cache, [splitEmojiName(name).name])
    return { name, ...reactionEmoji(name, cache) }
  })

/** The expiry Slack takes, in epoch seconds (0 for never), from the sheet's choice and the engine's clock. */
const expirationOf = (choice: StatusClearAfterChoice) =>
  Effect.map(Clock.currentTimeMillis, (now) => (typeof choice === 'string' ? statusExpiry(choice, new Date(now)) : Math.floor(choice.at / 1000)))

export const ProfileStatusHandlers = StatusRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const measure = (yield* EngineConfig).e2e
    const sync = yield* SyncLink
    // Main says when the Mac wakes; every expiry wait checks the clock then.
    const wakes = yield* PubSub.unbounded<void>()
    const fromMain = yield* (yield* HostLink).messages
    yield* Effect.forkScoped(Stream.runForEach(fromMain, (message) => (message._tag === 'wake' ? PubSub.publish(wakes, undefined) : Effect.void)))
    const onExpiry = untilExpiry(Stream.fromPubSub(wakes))
    return {
      'status.of': ({ userId }) =>
        serveLiveValue(
          workspace.changes.pipe(
            Stream.switchMap((open) => (open === undefined ? Stream.empty : liveQuery(['users', 'emoji'], timed(readStatus(userId))).pipe(Stream.provide(open.context)))),
            Stream.switchMap(onExpiry),
          ),
          { measure },
        ).pipe(retryFirstRun('status.of'), Stream.orDie),
      'status.refresh': ({ userId }) => Effect.flatMap(sync.fetcher, (fetcher) => fetcher?.refreshUsers([userId]) ?? Effect.void),
      'status.set': ({ text, emoji, clearAfter }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          const cleared = text.trim() === '' && emoji === ''
          const status = cleared
            ? { text: '', emoji: '', expiration: 0 }
            : { text: text.trim(), emoji: `:${emoji === '' ? STATUS_DEFAULT_EMOJI : emoji}:`, expiration: yield* expirationOf(clearAfter) }
          yield* outbox.send((api) =>
            api.call('users.profile.set', { profile: { status_text: status.text, status_emoji: status.emoji, status_expiration: status.expiration } }, { reason: cleared ? 'clear-status' : 'set-status' }),
          )
          // A store failure is a bug, not a state the user can act on (architecture 2.6).
          yield* Effect.gen(function* () {
            const sql = yield* StoreReader
            const [team] = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
            if (team?.self_user_id) yield* transaction(writeOwnStatus(team.self_user_id, status))
          }).pipe(Effect.provide(open.context), Effect.orDie)
        }),
    }
  }),
)
