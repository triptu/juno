/**
 * Incoming huddles (SPEC 20, "Incoming huddles"): the huddles that just
 * started in a conversation the user is in, by someone else, while the user
 * is not in them. Pure rules over the running list and the call; the engine
 * decides how each may interrupt and posts the OS notification.
 *
 * Each huddle is looked at once, the first time the running list holds its
 * call id. It is offered only when it started less than a minute ago, so a
 * huddle found by the read after a launch or a reconnect, which has run for
 * a while, is not. It stays until the user joins it (here or on another
 * device), dismisses it, or it ends.
 */
import type { HuddleAlert, HuddleCall, IncomingHuddle, RunningHuddle, RunningHuddles } from '@juno/contract'

/** How long after its start a huddle still counts as just started. */
export const NEW_HUDDLE_MILLIS = 60_000

/** How long an incoming huddle rings, from when Juno saw it. */
export const RING_MILLIS = 30_000

export interface IncomingState {
  /** Newest first. */
  readonly list: ReadonlyArray<IncomingHuddle>
  /** Call ids already looked at, so each huddle is offered once. */
  readonly seen: ReadonlySet<string>
}

export const noIncoming: IncomingState = { list: [], seen: new Set() }

/** A huddle seen for the first time that may be offered. */
export interface Fresh {
  readonly channelId: string
  readonly huddle: RunningHuddle
  readonly startedBy: string
}

/** Who started a huddle: Slack's `created_by`, else the first to join. */
const starterOf = (huddle: RunningHuddle): string | undefined => huddle.createdBy ?? huddle.participants[0]

/**
 * The huddles in `running` not looked at before, and the state with them
 * marked seen. Only those started by someone else less than a minute ago,
 * with the user not in them, come back as fresh.
 */
export function lookAt(state: IncomingState, running: RunningHuddles, selfId: string, now: number): { readonly state: IncomingState; readonly fresh: ReadonlyArray<Fresh> } {
  const unseen = Object.entries(running).filter(([, huddle]) => !state.seen.has(huddle.callId))
  if (unseen.length === 0) return { state, fresh: [] }
  const fresh: Array<Fresh> = []
  for (const [channelId, huddle] of unseen) {
    const startedBy = starterOf(huddle)
    if (startedBy === undefined || startedBy === selfId || huddle.participants.includes(selfId)) continue
    if (huddle.startedAt === null || now - huddle.startedAt > NEW_HUDDLE_MILLIS) continue
    fresh.push({ channelId, huddle, startedBy })
  }
  return { state: { ...state, seen: new Set([...state.seen, ...unseen.map(([, huddle]) => huddle.callId)]) }, fresh }
}

/** Whether the user is in, or joining, a huddle. */
export const inACall = (call: HuddleCall | undefined): boolean => call !== undefined && (call.phase === 'joining' || call.phase === 'joined')

/**
 * The entry for a fresh huddle. It rings for `RING_MILLIS` unless it is
 * quiet, Ring for huddles is off (`sound`), or the user is in a call.
 */
export function incomingOf(fresh: Fresh, alert: HuddleAlert, sound: boolean, call: HuddleCall | undefined, now: number): IncomingHuddle {
  return {
    channelId: fresh.channelId,
    callId: fresh.huddle.callId,
    startedBy: fresh.startedBy,
    participants: fresh.huddle.participants,
    alert,
    ringUntil: alert === 'ring' && sound && !inACall(call) ? now + RING_MILLIS : null,
  }
}

/** Adds new entries in front, the newest first. */
export const offer = (state: IncomingState, entries: ReadonlyArray<IncomingHuddle>): IncomingState =>
  entries.length === 0 ? state : { ...state, list: [...entries.toReversed(), ...state.list] }

/**
 * The list after a change to the running huddles or the call: a huddle that
 * ended, that the user is in or joining, goes; the others take the people
 * Slack lists now. Joining another huddle stops the ring of the rest.
 */
export function settle(state: IncomingState, running: RunningHuddles, call: HuddleCall | undefined, selfId: string): IncomingState {
  const calling = inACall(call)
  let changed = false
  const list = state.list.flatMap((entry) => {
    const huddle = running[entry.channelId]
    const joining = calling && call?.channelId === entry.channelId
    if (huddle === undefined || huddle.callId !== entry.callId || huddle.participants.includes(selfId) || joining) {
      changed = true
      return []
    }
    const ringUntil = calling ? null : entry.ringUntil
    if (sameIds(huddle.participants, entry.participants) && ringUntil === entry.ringUntil) return [entry]
    changed = true
    return [{ ...entry, participants: huddle.participants, ringUntil }]
  })
  return changed ? { ...state, list } : state
}

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.length === b.length && a.every((id, index) => id === b[index])

/** Hides one huddle's card and stops its ring. It is never offered again. */
export function dismiss(state: IncomingState, callId: string): IncomingState {
  const list = state.list.filter((entry) => entry.callId !== callId)
  return list.length === state.list.length ? state : { ...state, list }
}
