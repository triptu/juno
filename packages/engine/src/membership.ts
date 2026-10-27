/**
 * `channels.join`, `channels.leave` and `channels.membership` (SPEC 5, 7 and
 * 10; architecture 5.7). A top-level module, like `follow.ts`.
 *
 * A join or a leave is three steps:
 * 1. the membership changes in the store through the running sync's
 *    metadata fence (`TopicFetcher.membership`), as the socket's
 *    `channel_joined` or `channel_left` changes it, so the sidebar, an open
 *    tab and ⌘K follow at once, and a snapshot read in flight keeps it
 *    (`specs/metadata.qnt`);
 * 2. `conversations.join` or `conversations.leave` through the `Outbox` seam;
 * 3. on success the change is stored once more, so a snapshot read that
 *    began before Slack ran the call keeps it too; on any failure the
 *    membership goes back and the command fails with the contract's error.
 *    A lost answer after Slack ran the call is put right by Slack's own
 *    event, or by the full `client.counts` after a reconnect.
 *
 * What Slack would refuse (a private channel to join, #general to leave, an
 * archived channel) is refused here with Slack's code, without a call.
 * Commands on one channel run one at a time (`Outbox.exclusive`).
 */
import { Effect } from 'effect'
import { NotFound, NotSignedIn, Rejected, type ChannelMembership, type CommandResult, type MembershipError } from '@juno/contract'
import { StoreReader } from '@juno/store'
import { Outbox } from './outbox'
import { SyncLink } from './syncLink'
import { Workspace, type OpenWorkspace } from './workspace'

interface MembershipRow {
  readonly kind: string
  readonly is_member: 0 | 1
  readonly is_archived: 0 | 1
  readonly is_general: 0 | 1
}

// A store failure is a bug, not a state the user can act on (architecture 2.6).
const readRow = (open: OpenWorkspace, channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    return (yield* sql<MembershipRow>`SELECT kind, is_member, is_archived, is_general FROM conversations WHERE id = ${channel}`)[0]
  }).pipe(Effect.provide(open.context), Effect.orDie)

const isChannel = (row: MembershipRow) => row.kind === 'public' || row.kind === 'private'

/** Slack's code for a change it would refuse, or undefined. */
const refusal = (row: MembershipRow, member: boolean): string | undefined => {
  if (row.is_archived === 1) return 'is_archived'
  if (member) return row.kind === 'public' ? undefined : 'method_not_supported_for_channel_type'
  return row.is_general === 1 ? 'cant_leave_general' : undefined
}

/** `channels.join` when `member`, `channels.leave` otherwise. Leaving a public channel returns the join as its undo. */
export const setMembership = (channel: string, member: boolean): Effect.Effect<CommandResult, MembershipError, Workspace | Outbox | SyncLink> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    const fetcher = yield* (yield* SyncLink).fetcher
    if (open === undefined || fetcher === undefined) return yield* new NotSignedIn()
    const outbox = yield* Outbox
    return yield* outbox.exclusive(`membership:${channel}`)(
      Effect.gen(function* () {
        const row = yield* readRow(open, channel)
        if (row === undefined || !isChannel(row)) return yield* new NotFound({ kind: 'channel', id: channel })
        if ((row.is_member === 1) === member) return {} satisfies CommandResult
        const code = refusal(row, member)
        if (code !== undefined) return yield* new Rejected({ code })
        const store = (to: boolean) => fetcher.membership(channel, to).pipe(Effect.orDie)
        yield* store(member)
        yield* outbox
          .send((api) => (member ? api.call('conversations.join', { channel }) : api.call('conversations.leave', { channel })))
          .pipe(Effect.tapError(() => store(!member)))
        yield* store(member)
        const result: CommandResult = !member && row.kind === 'public' ? { undo: { _tag: 'channels.join', channel } } : {}
        return result
      }),
    )
  })

/** What a channel's menus need to offer Leave channel; `null` for a conversation the store does not know. */
export const channelMembership = (channel: string): Effect.Effect<ChannelMembership | null, NotSignedIn, Workspace> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotSignedIn()
    const row = yield* readRow(open, channel)
    if (row === undefined) return null
    const member = row.is_member === 1
    return { member, canLeave: member && isChannel(row) && refusal(row, false) === undefined }
  })
