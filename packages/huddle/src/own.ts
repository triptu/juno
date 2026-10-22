/** The live call keeps its own room when Slack's running-only edge stops listing it. */
import type { RoomsJoinHuddle } from '@juno/slack-schema'
import type { Core } from './core'
import * as L from './lifecycle'
import { applies, secondsToMillis, type Entry, type RoomFrame, type Running } from './running'

export interface OwnRoom extends Pick<Entry, 'callId' | 'participants' | 'startedAt' | 'eventTs'> {
  readonly attendeeId: string
  /** When Slack answered the join. */
  readonly joinedAt: number
}

/** A frame already received is newer than the join answer. */
export const joinedOwn = (identity: L.Identity, running: Running, huddle: RoomsJoinHuddle | undefined, joinedAt: number): OwnRoom => {
  const entry = running.get(identity.channelId)
  const room = entry?.callId === identity.callId ? entry : undefined
  return {
    attendeeId: identity.attendeeId, callId: identity.callId, joinedAt,
    participants: room?.participants ?? huddle?.participants ?? [],
    startedAt: room?.startedAt ?? secondsToMillis(huddle?.date_start),
    eventTs: room?.eventTs,
  }
}

type OwnCore = Pick<Core, 's' | 'own'>

/** Before the join answers, show the running room; afterwards use only this attendee's room. */
export const callRoom = (s: L.Lifecycle, running: Running, own: OwnRoom | undefined): Pick<Entry, 'participants' | 'startedAt'> | undefined => {
  const identity = s.current?.identity
  if (identity !== undefined) return own?.attendeeId === identity.attendeeId ? own : undefined
  const channelId = L.callChannel(s)
  return channelId === undefined ? undefined : running.get(channelId)
}

/** Drop the retained room as soon as this attendee leaves, switches, or loses its media. */
export const followOwn = (core: OwnCore) => {
  if (core.own?.attendeeId !== core.s.current?.identity.attendeeId) core.own = undefined
}

/** Frames update the retained room even after an edge read removed its running entry. */
export const frameOwn = (core: OwnCore, frame: RoomFrame) => {
  const own = core.own
  if (own === undefined || core.s.current?.identity.channelId !== frame.channelId || !applies(own, frame)) return
  core.own = { ...own, participants: frame.ended ? [] : frame.participants, startedAt: frame.startedAt ?? own.startedAt, eventTs: frame.eventTs ?? own.eventTs }
}

/** A missing listing is inconclusive; a listed room updates only its own call, never another room in that channel. */
export const readOwn = (core: OwnCore, channels: ReadonlyArray<string>, running: Running) => {
  const identity = core.s.current?.identity
  const own = core.own
  if (identity === undefined || own?.attendeeId !== identity.attendeeId || !channels.includes(identity.channelId)) return
  const entry = running.get(identity.channelId)
  if (entry?.callId !== own.callId) return
  core.own = { ...own, participants: entry.participants, startedAt: entry.startedAt ?? own.startedAt }
}
