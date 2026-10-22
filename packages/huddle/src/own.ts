/**
 * The user's own call as the UI shows it: who is in it and when it
 * started. The running list can stop listing the call's room while the user
 * talks in it (Slack's edge lags its socket), so the call keeps what Juno
 * last knew of its room.
 */
import type { Core } from './core'
import * as L from './lifecycle'
import type { Running } from './running'

/**
 * What Juno last knew of the room of the user's own call: who is in it and
 * when it started, from the join answer, then from the running list while
 * that lists the room. A read that does not list the room the user is
 * talking in leaves the call as it was.
 */
export interface OwnRoom {
  readonly attendeeId: string
  readonly callId: string
  readonly participants: ReadonlyArray<string>
  readonly startedAt: number | null
  /** When Slack answered the join. */
  readonly joinedAt: number
}

/**
 * The room of the call: its running entry while that is about the call's
 * room, else what Juno last knew of it. Before Slack answers the join, the
 * huddle being joined.
 */
export const callRoom = (s: L.Lifecycle, running: Running, own: OwnRoom | undefined): { readonly participants: ReadonlyArray<string>; readonly startedAt: number | null } | undefined => {
  const channelId = L.callChannel(s)
  const entry = channelId === undefined ? undefined : running.get(channelId)
  const identity = s.current?.identity
  if (identity === undefined || entry?.callId === identity.callId) return entry
  return own?.attendeeId === identity.attendeeId ? own : undefined
}

/** Keeps `own` up to date with the running list, under the lock. */
export const followOwn = (core: Pick<Core, 's' | 'running' | 'own'>) => {
  const identity = core.s.current?.identity
  const own = core.own
  if (identity === undefined || own?.attendeeId !== identity.attendeeId) return
  const entry = core.running.get(identity.channelId)
  if (entry?.callId !== identity.callId || (entry.participants === own.participants && entry.startedAt === own.startedAt)) return
  core.own = { ...own, participants: entry.participants, startedAt: entry.startedAt ?? own.startedAt }
}

