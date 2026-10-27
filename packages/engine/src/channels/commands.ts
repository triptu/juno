/**
 * `channels.create`, `channels.edit` and `channels.members` (SPEC 5,
 * "Channel sheet"; research `slack-channels.md`).
 *
 * Create needs Slack's answer before anything shows: the channel's id. It
 * is sent once (`Outbox.sendOnce`), since a second `conversations.create`
 * after a lost answer would only meet its own channel as `name_taken`. The
 * answer is stored as `channel_joined` would store it, so the Main opens
 * before the socket says so, then the members are invited.
 *
 * Edit applies a rename to the store at once, so the sidebar, tabs, pills
 * and ⌘K show it, then asks Slack; a refusal puts the old name back unless
 * the name changed again meanwhile. Members are invited in one call with
 * `force`, so Slack adds whom it can and lists the rest, and removed one
 * call each (`conversations.kick` takes one user). These calls are safe to
 * repeat: `already_in_channel` and `not_in_channel` count as done. The undo
 * is the same command with the old name and the opposite changes, for what
 * Slack did. Edits of one channel run one at a time.
 *
 * Nothing here is kept across a restart: each call settles while the
 * command waits, and the next `client.userBoot` or socket event brings the
 * store back to what Slack has.
 */
import { NotFound, NotSignedIn, Rejected, type ChannelCreated, type ChannelEdited, type ChannelError, type ChannelMemberIssue, type Person, type UndoCommand } from '@juno/contract'
import { mainTopicId, normalizeChannelName, type ChannelId } from '@juno/domain'
import { StoreReader } from '@juno/store'
import type { TopicFetcher } from '@juno/sync'
import { Effect } from 'effect'
import { Outbox, type MirrorError } from '../outbox'
import { SyncLink } from '../syncLink'
import { personFrom, type UserRow } from '../topicRows'
import { Workspace, type OpenWorkspace } from '../workspace'

type Services = Workspace | Outbox | SyncLink

/** At most this many members are listed in the sheet; a bigger channel lists the first of them. */
const MEMBERS_MAX = 1000
const MEMBERS_PAGE = 200

/** The open workspace and the running sync's fetcher, or `NotSignedIn`. */
const session = Effect.gen(function* () {
  const open = yield* (yield* Workspace).current
  const fetcher = yield* (yield* SyncLink).fetcher
  if (open === undefined || fetcher === undefined) return yield* new NotSignedIn()
  return { open, fetcher }
})

/** A failed call as a code the sheet and toasts put in words. */
const codeOf = (error: MirrorError): string => {
  switch (error._tag) {
    case 'Rejected':
      return error.code
    case 'Offline':
      return 'offline'
    case 'RateLimited':
      return 'ratelimited'
    case 'NotSignedIn':
      return 'not_authed'
  }
}

/** The people named by `issues`, from the store. */
const withPeople = (open: OpenWorkspace, issues: ReadonlyArray<{ readonly user: string; readonly code: string }>): Effect.Effect<ReadonlyArray<ChannelMemberIssue>> =>
  Effect.gen(function* () {
    if (issues.length === 0) return []
    const people = yield* readPeople(issues.map((issue) => issue.user))
    return issues.map((issue) => ({ person: people.get(issue.user) ?? personFrom(issue.user, undefined), code: issue.code }))
  }).pipe(Effect.provide(open.context), Effect.orDie)

const readPeople = (ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const people = new Map<string, Person>()
    for (let at = 0; at < ids.length; at += 500) {
      const rows = yield* sql<UserRow & { readonly id: string }>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in(ids.slice(at, at + 500))}`
      for (const row of rows) people.set(row.id, personFrom(row.id, row))
    }
    return people
  })

/** Invite answers that leave nothing to do, as the official client ignores them. */
const DONE: ReadonlySet<string> = new Set(['already_in_channel', 'already_in_channel_ug', 'cant_invite_self'])

/** Invites `users` in one call. Returns whom Slack added and whom it would not. */
const invite = (outbox: Outbox['Service'], channel: string, users: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (users.length === 0) return { added: [] as ReadonlyArray<string>, issues: [] as ReadonlyArray<{ user: string; code: string }> }
    const answer = yield* Effect.result(outbox.send((api) => api.call('conversations.invite', { channel, users: users.join(','), force: true })))
    if (answer._tag === 'Failure') {
      const code = codeOf(answer.failure)
      // One person already in it refuses the call without `force`; with it, the call fails only when no one could be added.
      return DONE.has(code) ? { added: [], issues: [] } : { added: [], issues: users.map((user) => ({ user, code })) }
    }
    const issues = (answer.success.errors ?? []).flatMap((issue) => (issue.user === undefined || DONE.has(issue.error) ? [] : [{ user: issue.user, code: issue.error }]))
    const refused = new Set(issues.map((issue) => issue.user))
    return { added: users.filter((user) => !refused.has(user)), issues }
  })

/** Removes `users` one call each. Returns whom Slack removed and whom it would not. */
const kick = (outbox: Outbox['Service'], channel: string, users: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const removed: Array<string> = []
    const issues: Array<{ user: string; code: string }> = []
    for (const user of users) {
      const answer = yield* Effect.result(outbox.send((api) => api.call('conversations.kick', { channel, user })))
      const code = answer._tag === 'Failure' ? codeOf(answer.failure) : undefined
      if (code === undefined || code === 'not_in_channel') removed.push(user)
      else issues.push({ user, code })
    }
    return { removed, issues }
  })

export const createChannel = (input: { readonly name: string; readonly isPrivate: boolean; readonly members: ReadonlyArray<string> }): Effect.Effect<ChannelCreated, ChannelError, Services> =>
  Effect.gen(function* () {
    const { open, fetcher } = yield* session
    const outbox = yield* Outbox
    const { name } = normalizeChannelName(input.name)
    if (name === '') return yield* new Rejected({ code: 'invalid_name_required' })
    const channel = (yield* outbox.sendOnce((api) => api.call('conversations.create', { name, validate_name: true, ...(input.isPrivate ? { is_private: true } : {}) }))).channel
    // A store failure is a bug, not a state the user can act on (architecture 2.6).
    yield* fetcher.opened(channel).pipe(Effect.orDie)
    const { issues } = yield* invite(outbox, channel.id, input.members)
    return { channelId: channel.id, topicId: mainTopicId(channel.id as ChannelId), name: channel.name ?? name, notAdded: yield* withPeople(open, issues) }
  })

/** Renames the channel in Slack after showing the new name. Returns the name it has now and, when Slack refused, its code. */
const rename = (outbox: Outbox['Service'], fetcher: TopicFetcher, channel: string, from: string, to: string) =>
  Effect.gen(function* () {
    yield* fetcher.renamed(channel, to).pipe(Effect.orDie)
    const answer = yield* Effect.result(outbox.send((api) => api.call('conversations.rename', { channel, name: to, validate: true })))
    if (answer._tag === 'Success') {
      const named = answer.success.channel.name ?? to
      yield* fetcher.renamed(channel, named, to).pipe(Effect.orDie)
      return { name: named, refused: undefined }
    }
    yield* fetcher.renamed(channel, from, to).pipe(Effect.orDie)
    return { name: from, refused: codeOf(answer.failure) }
  })

export const editChannel = (input: { readonly channel: string; readonly name?: string | undefined; readonly add: ReadonlyArray<string>; readonly remove: ReadonlyArray<string> }): Effect.Effect<ChannelEdited, ChannelError, Services> =>
  Effect.gen(function* () {
    const { open, fetcher } = yield* session
    const outbox = yield* Outbox
    const { channel } = input
    return yield* outbox.exclusive(`channel:${channel}`)(
      Effect.gen(function* () {
        const rows = yield* Effect.gen(function* () {
          const sql = yield* StoreReader
          return yield* sql<{ name: string | null; kind: string }>`SELECT name, kind FROM conversations WHERE id = ${channel}`
        }).pipe(Effect.provide(open.context), Effect.orDie)
        const row = rows[0]
        if (row === undefined || row.kind === 'im' || row.kind === 'mpim') return yield* new NotFound({ kind: 'channel', id: channel })
        const before = row.name ?? ''
        const wanted = input.name === undefined ? '' : normalizeChannelName(input.name).name
        const renamed = wanted === '' || wanted === before ? undefined : yield* rename(outbox, fetcher, channel, before, wanted)
        const { added, issues: notAdded } = yield* invite(outbox, channel, input.add)
        const { removed, issues: notRemoved } = yield* kick(outbox, channel, input.remove)
        const didRename = renamed !== undefined && renamed.refused === undefined
        const undo: UndoCommand | undefined =
          didRename || added.length > 0 || removed.length > 0 ? { _tag: 'channels.edit', channel, ...(didRename ? { name: before } : {}), add: removed, remove: added } : undefined
        return {
          name: renamed?.name ?? before,
          ...(renamed?.refused === undefined ? {} : { renameRefused: renamed.refused }),
          notAdded: yield* withPeople(open, notAdded),
          notRemoved: yield* withPeople(open, notRemoved),
          ...(undo === undefined ? {} : { undo }),
        }
      }),
    )
  })

/** The channel's members from Slack, the user left out, by name. Unknown people are named later, as a page that names them would. */
export const channelMembers = (channel: string): Effect.Effect<ReadonlyArray<Person>, ChannelError, Services> =>
  Effect.gen(function* () {
    const { open, fetcher } = yield* session
    const outbox = yield* Outbox
    const ids: Array<string> = []
    let cursor: string | undefined
    do {
      const page = yield* outbox.lookup((api) => api.call('conversations.members', { channel, limit: MEMBERS_PAGE, ...(cursor === undefined ? {} : { cursor }) }))
      ids.push(...page.members)
      cursor = page.response_metadata?.next_cursor || undefined
    } while (cursor !== undefined && ids.length < MEMBERS_MAX)
    const selfId = yield* Effect.gen(function* () {
      const sql = yield* StoreReader
      return (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
    }).pipe(Effect.provide(open.context), Effect.orDie)
    const others = ids.filter((id) => id !== selfId).slice(0, MEMBERS_MAX)
    const people = yield* readPeople(others).pipe(Effect.provide(open.context), Effect.orDie)
    const unknown = others.filter((id) => !people.has(id))
    if (unknown.length > 0) yield* fetcher.wantUsers(unknown)
    return others.map((id) => people.get(id) ?? personFrom(id, undefined)).toSorted((a, b) => a.name.localeCompare(b.name))
  })
