/** The snapshot's starting value and the changes both sessions make to it. */
import { CONTENT_SUFFIX, slackUserIdOf } from './externalUserId.ts'
import type { Change } from './store.ts'
import type { Connection, Devices, MediaSnapshot, RemoteAttendee } from './types.ts'

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
  local: { attendeeId: undefined, muted: false, speaking: false },
  remotes: [],
  activeSpeaker: undefined,
  devices: NO_DEVICES,
  microphoneAccess: 'unknown',
  noiseSuppression: 'unsupported',
  shares: [],
  localShare: undefined,
}

/** A new call: what the last one left is cleared; devices and access carry over. */
export const startCall =
  (attendeeId: string): Change =>
  (s) => ({
    ...INITIAL_SNAPSHOT,
    devices: s.devices,
    microphoneAccess: s.microphoneAccess,
    noiseSuppression: s.noiseSuppression,
    connection: { state: 'connecting' },
    local: { attendeeId, muted: false, speaking: false },
  })

export const setConnection =
  (connection: Connection): Change =>
  (s) => {
    if (s.connection.state === 'ended') return s
    if (connection.state !== 'ended') return { ...s, connection }
    return { ...s, connection, remotes: [], shares: [], localShare: undefined, activeSpeaker: undefined, local: { ...s.local, speaking: false } }
  }

/**
 * Someone joined or left. The call's own attendee is `local`, never a remote.
 * A `#content` attendee is a screen share (phase 4), not a person.
 */
export const presence =
  (attendeeId: string, present: boolean, externalUserId: string): Change =>
  (s) => {
    if (attendeeId === s.local.attendeeId) return s
    if (attendeeId.endsWith(CONTENT_SUFFIX)) {
      const shares = s.shares.filter((share) => share.attendeeId !== attendeeId)
      return { ...s, shares: present ? [...shares, { attendeeId, userId: slackUserIdOf(externalUserId) }] : shares }
    }
    const known = s.remotes.some((r) => r.attendeeId === attendeeId)
    if (present === known) return s
    if (!present) return { ...s, remotes: s.remotes.filter((r) => r.attendeeId !== attendeeId), activeSpeaker: s.activeSpeaker === attendeeId ? undefined : s.activeSpeaker }
    const remote: RemoteAttendee = { attendeeId, externalUserId, userId: slackUserIdOf(externalUserId), muted: false, speaking: false }
    return { ...s, remotes: [...s.remotes, remote] }
  }

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
