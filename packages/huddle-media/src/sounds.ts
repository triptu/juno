/**
 * Which moments in a call make a sound (SPEC 20, "Sounds"): a join sound when
 * the user's own call connects or someone else joins, and a leave sound when
 * the user's call ends or someone else leaves. A reconnect is not a join.
 * Past eight people, other people's joins and leaves are silent.
 */

export type HuddleSound = 'join' | 'leave'

/** What the rule looks at, read from the media session and the engine's call each time either changes. */
export interface SoundView {
  /** The user's own call: `out` with none, or after it ended. */
  readonly own: 'out' | 'connecting' | 'connected' | 'reconnecting'
  /** The call's attendee, so a new call is told from the same one coming back. */
  readonly attendeeId: string | null
  /**
   * The other people in the huddle, by user id, while the user is in it; null
   * until the engine's call says who they are. The first list is where others
   * start, so the people already there when the user joins make no sound.
   */
  readonly others: ReadonlyArray<string> | null
}

/** Above this many people, the user included, other people come and go in silence. */
export const QUIET_ABOVE = 8

const inCall = (own: SoundView['own']) => own === 'connected' || own === 'reconnecting'

/** The sounds to play for the change from `before` to `after`, in order. */
export function huddleSounds(before: SoundView, after: SoundView): ReadonlyArray<HuddleSound> {
  const sameCall = before.attendeeId === after.attendeeId
  if (inCall(before.own) && (!inCall(after.own) || !sameCall)) return ['leave']
  if (after.own === 'connected' && !inCall(before.own)) return ['join']
  if (!inCall(before.own) || !inCall(after.own) || before.others === null || after.others === null) return []
  if (Math.max(before.others.length, after.others.length) + 1 > QUIET_ABOVE) return []
  const had = new Set(before.others)
  const has = new Set(after.others)
  const sounds: Array<HuddleSound> = []
  if (after.others.some((id) => !had.has(id))) sounds.push('join')
  if (before.others.some((id) => !has.has(id))) sounds.push('leave')
  return sounds
}
