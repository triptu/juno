/** The snapshot's starting value and the changes both sessions make to it. */
import { CONTENT_SUFFIX, slackUserIdOf } from './externalUserId.ts'
import type { Change } from './store.ts'
import type { Connection, Devices, LocalShare, MediaSnapshot, RemoteAttendee, ShareEndReason, ShareSource } from './types.ts'

const NO_DEVICES: Devices = {
  microphones: [],
  speakers: [],
  systemMicrophone: '',
  systemSpeaker: '',
  microphone: null,
  speaker: null,
  microphoneInUse: null,
  speakerInUse: null,
}

export const INITIAL_SNAPSHOT: MediaSnapshot = {
  connection: { state: 'idle' },
  local: { attendeeId: undefined, muted: false, speaking: false, sending: false },
  remotes: [],
  activeSpeaker: undefined,
  devices: NO_DEVICES,
  microphoneAccess: 'unknown',
  noiseSuppression: 'unsupported',
  shares: [],
  localShare: undefined,
  shareEnded: undefined,
}

/** A new call: what the last one left is cleared; devices and access carry over. */
export const startCall =
  (attendeeId: string): Change =>
  (s) => ({
    ...INITIAL_SNAPSHOT,
    devices: s.devices,
    microphoneAccess: s.microphoneAccess,
    noiseSuppression: s.noiseSuppression,
    shareEnded: s.shareEnded,
    connection: { state: 'connecting' },
    local: { attendeeId, muted: false, speaking: false, sending: false },
  })

export const setConnection =
  (connection: Connection): Change =>
  (s) => {
    if (s.connection.state === 'ended') return s
    if (connection.state !== 'ended') return { ...s, connection }
    return { ...s, connection, remotes: [], shares: [], localShare: undefined, activeSpeaker: undefined, local: { ...s.local, speaking: false, sending: false } }
  }

/**
 * Someone joined or left. The call's own attendee is `local`, never a remote.
 * A `#content` attendee is a screen share, not a person; the user's own is
 * not one of `shares`.
 */
export const presence =
  (attendeeId: string, present: boolean, externalUserId: string): Change =>
  (s) => {
    if (attendeeId === s.local.attendeeId) return s
    if (attendeeId.endsWith(CONTENT_SUFFIX)) {
      const owner = attendeeId.slice(0, -CONTENT_SUFFIX.length)
      if (owner === s.local.attendeeId) return s
      if (!present) return { ...s, shares: s.shares.filter((share) => share.attendeeId !== attendeeId) }
      const userId = slackUserIdOf(externalUserId) ?? s.remotes.find((r) => r.attendeeId === owner)?.userId
      const known = s.shares.find((share) => share.attendeeId === attendeeId)
      // A repeat may name the owner the first call could not.
      if (known !== undefined) return known.userId !== undefined || userId === undefined ? s : { ...s, shares: s.shares.map((share) => (share === known ? { ...share, userId } : share)) }
      return { ...s, shares: [...s.shares, { attendeeId, userId, ready: false }] }
    }
    const known = s.remotes.some((r) => r.attendeeId === attendeeId)
    if (present === known) return s
    if (!present) return { ...s, remotes: s.remotes.filter((r) => r.attendeeId !== attendeeId), activeSpeaker: s.activeSpeaker === attendeeId ? undefined : s.activeSpeaker }
    const remote: RemoteAttendee = { attendeeId, externalUserId, userId: slackUserIdOf(externalUserId), muted: false, speaking: false }
    // Their share may have come first, without a user it could name.
    const shares = s.shares.map((share) => (share.userId === undefined && share.attendeeId === `${attendeeId}${CONTENT_SUFFIX}` ? { ...share, userId: remote.userId } : share))
    return { ...s, remotes: [...s.remotes, remote], shares }
  }

/** A share's video has its first frame in a bound element, or no longer. Unknown ids are ignored. */
export const shareReady =
  (attendeeId: string, ready: boolean): Change =>
  (s) => ({ ...s, shares: s.shares.map((share) => (share.attendeeId === attendeeId ? { ...share, ready } : share)) })

/** Sets muted or speaking on the local attendee or one remote. Unknown ids are ignored. */
export const patchAttendee =
  (attendeeId: string, patch: Partial<Pick<RemoteAttendee, 'muted' | 'speaking'>>): Change =>
  (s) => {
    // A muted attendee does not speak.
    const full = patch.muted === true ? { ...patch, speaking: false } : patch
    const activeSpeaker = full.speaking === false && s.activeSpeaker === attendeeId ? undefined : s.activeSpeaker
    if (attendeeId === s.local.attendeeId) return { ...s, local: { ...s.local, ...full }, activeSpeaker }
    if (!s.remotes.some((r) => r.attendeeId === attendeeId)) return s
    return { ...s, remotes: s.remotes.map((r) => (r.attendeeId === attendeeId ? { ...r, ...full } : r)), activeSpeaker }
  }

/**
 * Chime's active speaker list, loudest first. Everyone in it speaks unless
 * muted; the loudest who speaks is the active speaker.
 */
export const speakers =
  (loudestFirst: ReadonlyArray<string>): Change =>
  (s) => {
    const muted = new Set([...s.remotes.filter((r) => r.muted).map((r) => r.attendeeId), ...(s.local.muted && s.local.attendeeId !== undefined ? [s.local.attendeeId] : [])])
    const speaking = new Set(loudestFirst.filter((id) => !muted.has(id)))
    return {
      ...s,
      local: { ...s.local, speaking: s.local.attendeeId !== undefined && speaking.has(s.local.attendeeId) },
      remotes: s.remotes.map((r) => ({ ...r, speaking: speaking.has(r.attendeeId) })),
      activeSpeaker: loudestFirst.find((id) => speaking.has(id)),
    }
  }

/** The user's share runs, or no longer: `ended` says why it stopped, unless another took its place or its call ended. */
export const setLocalShare =
  (share: LocalShare | undefined, ended?: { readonly kind: ShareSource['kind']; readonly reason: ShareEndReason }): Change =>
  (s) => ({
    ...s,
    localShare: share,
    ...(ended === undefined ? {} : { shareEnded: { seq: (s.shareEnded?.seq ?? 0) + 1, ...ended } }),
  })
