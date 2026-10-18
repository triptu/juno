/**
 * A media session with no network and no WebRTC, for e2e tests and the
 * gallery (`@juno/huddle-media/fake`). It does what it is told: `join`
 * connects at once unless `autoConnect` is off, and everything else that
 * happens in a call is a control method below.
 */
import { inUse } from './devices.ts'
import { CONTENT_SUFFIX } from './externalUserId.ts'
import { INITIAL_SNAPSHOT, patchAttendee, presence, setConnection, speakers, startCall } from './snapshot.ts'
import { SnapshotStore } from './store.ts'
import type { Devices, EndReason, JoinInfo, MediaDevice, MediaSession, MicrophoneAccess } from './types.ts'

export interface FakeMediaOptions {
  /** `join` connects at once. Default true; when false, call `setConnection('connected')`. */
  readonly autoConnect?: boolean
  readonly microphones?: ReadonlyArray<MediaDevice>
  readonly speakers?: ReadonlyArray<MediaDevice>
  readonly microphoneAccess?: MicrophoneAccess
  readonly noiseSuppression?: boolean
}

export interface FakeRemote {
  readonly userId: string
  /** Default `fake-<userId>`. */
  readonly attendeeId?: string
  readonly muted?: boolean
}

const FAKE_TEAM = 'T0FAKETEAM0'
const FAKE_ROOM = 'R0FAKEROOM0'

export class FakeMediaSession implements MediaSession {
  readonly #store = new SnapshotStore(INITIAL_SNAPSHOT)
  readonly #autoConnect: boolean
  readonly #noiseSupported: boolean
  /** Who speaks now, loudest first. */
  #speaking: ReadonlyArray<string> = []

  constructor(options: FakeMediaOptions = {}) {
    this.#autoConnect = options.autoConnect ?? true
    this.#noiseSupported = options.noiseSuppression ?? true
    this.setDevices({ microphones: options.microphones ?? [], speakers: options.speakers ?? [] })
    this.#store.update((s) => ({ ...s, microphoneAccess: options.microphoneAccess ?? 'granted' }))
  }

  subscribe = this.#store.subscribe
  getSnapshot = this.#store.getSnapshot

  async join(info: JoinInfo): Promise<void> {
    const state = this.getSnapshot().connection.state
    if (state === 'connecting' || state === 'connected' || state === 'reconnecting') throw new Error('huddle-media: a call is already running')
    const attendee = info.attendee as { AttendeeId?: unknown } | null
    this.#speaking = []
    this.#store.update(startCall(typeof attendee?.AttendeeId === 'string' ? attendee.AttendeeId : 'fake-self'))
    const blocked = this.getSnapshot().microphoneAccess === 'denied'
    this.#store.update((s) => ({
      ...s,
      local: { ...s.local, muted: blocked },
      noiseSuppression: this.#noiseSupported ? (info.noiseSuppression === false ? 'off' : 'on') : 'unsupported',
      devices: { ...s.devices, microphone: info.microphone ?? null, speaker: info.speaker ?? null },
    }))
    this.#useDevices()
    if (this.#autoConnect) this.setConnection('connected')
  }

  async leave(): Promise<void> {
    this.end('left')
  }

  setMuted(muted: boolean): void {
    const { connection, local, microphoneAccess } = this.getSnapshot()
    if (local.attendeeId === undefined || connection.state === 'idle' || connection.state === 'ended') return
    if (!muted && microphoneAccess !== 'granted') return
    this.#store.update(patchAttendee(local.attendeeId, { muted }))
  }

  async setNoiseSuppression(on: boolean): Promise<void> {
    if (this.#noiseSupported) this.#store.update((s) => ({ ...s, noiseSuppression: on ? 'on' : 'off' }))
  }

  async listDevices(): Promise<Devices> {
    return this.getSnapshot().devices
  }

  async chooseMicrophone(id: string | null): Promise<void> {
    this.#store.update((s) => ({ ...s, devices: { ...s.devices, microphone: id } }))
    this.#useDevices()
  }

  async chooseSpeaker(id: string | null): Promise<void> {
    this.#store.update((s) => ({ ...s, devices: { ...s.devices, speaker: id } }))
    this.#useDevices()
  }

  // The timeline, driven by the test.

  /** Someone joins. Returns their attendee id. */
  addRemote(remote: FakeRemote): string {
    const attendeeId = remote.attendeeId ?? `fake-${remote.userId}`
    this.#store.update(presence(attendeeId, true, `${FAKE_TEAM}-${FAKE_ROOM}-${remote.userId}`))
    if (remote.muted === true) this.setRemoteMuted(attendeeId, true)
    return attendeeId
  }

  removeRemote(attendeeId: string): void {
    this.#speaking = this.#speaking.filter((id) => id !== attendeeId)
    this.#store.update(presence(attendeeId, false, ''))
  }

  /** `attendeeId` may be the local attendee's. The latest to start speaking is the active speaker. */
  setSpeaking(attendeeId: string, speaking: boolean): void {
    const others = this.#speaking.filter((id) => id !== attendeeId)
    this.#speaking = speaking ? [attendeeId, ...others] : others
    this.#store.update(speakers(this.#speaking))
  }

  setRemoteMuted(attendeeId: string, muted: boolean): void {
    this.#store.update(patchAttendee(attendeeId, { muted }))
  }

  setConnection(state: 'connecting' | 'connected' | 'reconnecting'): void {
    if (this.getSnapshot().local.attendeeId !== undefined) this.#store.update(setConnection({ state }))
  }

  /** Ends the call as Chime would, for example with `another-device` or `connection-lost`. */
  end(reason: EndReason): void {
    const { connection, local } = this.getSnapshot()
    if (connection.state === 'idle' || connection.state === 'ended') return
    this.#speaking = []
    this.#store.update(setConnection({ state: 'ended', reason, attendeeId: local.attendeeId ?? '', code: `fake:${reason}` }))
  }

  setMicrophoneAccess(access: MicrophoneAccess): void {
    const { local } = this.getSnapshot()
    this.#store.update((s) => ({ ...s, microphoneAccess: access }))
    // As the real session: a blocked microphone mutes, and access coming back does not unmute.
    if (access !== 'granted' && local.attendeeId !== undefined) this.#store.update(patchAttendee(local.attendeeId, { muted: true }))
  }

  /** Plugs in or unplugs devices. A pick that goes away stays the pick; the system's is used meanwhile. */
  setDevices(devices: { readonly microphones: ReadonlyArray<MediaDevice>; readonly speakers: ReadonlyArray<MediaDevice> }): void {
    this.#store.update((s) => ({
      ...s,
      devices: { ...s.devices, ...devices, systemMicrophone: devices.microphones[0]?.label ?? '', systemSpeaker: devices.speakers[0]?.label ?? '' },
    }))
    this.#useDevices()
  }

  /** Phase 4: someone starts sharing their screen. */
  startShare(userId: string, attendeeId = `fake-${userId}`): void {
    this.#store.update(presence(`${attendeeId}${CONTENT_SUFFIX}`, true, `${FAKE_TEAM}-${FAKE_ROOM}-${userId}`))
  }

  stopShare(userId: string, attendeeId = `fake-${userId}`): void {
    this.#store.update(presence(`${attendeeId}${CONTENT_SUFFIX}`, false, ''))
  }

  #useDevices(): void {
    this.#store.update((s) => ({
      ...s,
      devices: { ...s.devices, microphoneInUse: inUse(s.devices.microphone, s.devices.microphones), speakerInUse: inUse(s.devices.speaker, s.devices.speakers) },
    }))
  }
}

export function createFakeMediaSession(options?: FakeMediaOptions): FakeMediaSession {
  return new FakeMediaSession(options)
}
