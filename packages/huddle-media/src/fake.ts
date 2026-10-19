/**
 * A media session with no network and no WebRTC, for e2e tests and the
 * gallery (`@juno/huddle-media/fake`). It does what it is told: `join`
 * connects at once unless `autoConnect` is off, and everything else that
 * happens in a call is a control method below.
 */
import { inUse } from './devices.ts'
import { CONTENT_SUFFIX } from './externalUserId.ts'
import { watchFirstFrame } from './firstFrame.ts'
import { OwnPreviews } from './ownPreview.ts'
import { INITIAL_SNAPSHOT, patchAttendee, presence, setConnection, setLocalShare, shareReady, speakers, startCall } from './snapshot.ts'
import { SnapshotStore } from './store.ts'
import { createTestPattern, type TestPattern } from './testPattern.ts'
import type { Devices, EndReason, HuddleSound, JoinInfo, MediaDevice, MediaSession, MicrophoneAccess, ShareSource } from './types.ts'

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

/** An element `showShare` was given, and the pattern playing in it while its share runs. */
interface Shown {
  readonly element: HTMLVideoElement
  readonly unwatch: () => void
  pattern: TestPattern | undefined
}

const FAKE_TEAM = 'T0FAKETEAM0'
const FAKE_ROOM = 'R0FAKEROOM0'

export class FakeMediaSession implements MediaSession {
  readonly #store = new SnapshotStore(INITIAL_SNAPSHOT)
  readonly #autoConnect: boolean
  readonly #noiseSupported: boolean
  /** Who speaks now, loudest first. */
  #speaking: ReadonlyArray<string> = []
  readonly #shown = new Map<string, Shown>()
  /** The user's own share: a test pattern standing in for the capture. */
  #own: { readonly source: ShareSource; readonly pattern: TestPattern } | undefined
  readonly #previews = new OwnPreviews()
  /** The next `shareScreen` fails, as a capture macOS refuses. */
  failNextShare = false
  /** The sounds `playSound` was asked for, in order, for a test to read. */
  readonly played: Array<HuddleSound> = []

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
    // As the real session: without a microphone it can use, the call starts muted.
    const blocked = ['denied', 'unavailable', 'failed'].includes(this.getSnapshot().microphoneAccess)
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

  playSound(sound: HuddleSound): void {
    this.played.push(sound)
  }

  /** Plays a drawn test pattern in `element` while the share runs. */
  showShare(attendeeId: string, element: HTMLVideoElement): () => void {
    this.#hide(attendeeId)
    const shown: Shown = { element, unwatch: watchFirstFrame(element, (ready) => this.#store.update(shareReady(attendeeId, ready))), pattern: undefined }
    this.#shown.set(attendeeId, shown)
    this.#playShares()
    return () => {
      if (this.#shown.get(attendeeId) === shown) this.#hide(attendeeId)
    }
  }

  /** Shares a drawn test pattern named for the source; live at once. */
  async shareScreen(source: ShareSource): Promise<void> {
    const { state } = this.getSnapshot().connection
    if (state === 'idle' || state === 'ended') return
    this.#endOwn()
    if (this.failNextShare) {
      this.failNextShare = false
      this.#store.update(setLocalShare(undefined, { sourceId: source.sourceId, kind: source.kind, reason: 'failed' }))
      return
    }
    const pattern = createTestPattern(source.name)
    this.#own = { source, pattern }
    this.#previews.set(pattern.stream)
    this.#store.update(setLocalShare({ ...source, live: true }))
  }

  stopSharing(): void {
    const own = this.#endOwn()
    this.#store.update(setLocalShare(undefined, own === undefined ? undefined : { sourceId: own.sourceId, kind: own.kind, reason: 'stopped' }))
  }

  showOwnShare(element: HTMLVideoElement): () => void {
    return this.#previews.show(element)
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

  /** `connected` also starts sending; the others stop it. */
  setConnection(state: 'connecting' | 'connected' | 'reconnecting'): void {
    if (this.getSnapshot().local.attendeeId === undefined) return
    this.#store.update(setConnection({ state }))
    this.setSending(state === 'connected')
  }

  /** The uplink stops or starts carrying audio, as `local.sending` reports it. */
  setSending(sending: boolean): void {
    const { connection } = this.getSnapshot()
    if (connection.state === 'idle' || connection.state === 'ended') return
    this.#store.update((s) => ({ ...s, local: { ...s.local, sending } }))
  }

  /** Ends the call as Chime would, for example with `another-device` or `connection-lost`. */
  end(reason: EndReason): void {
    const { connection, local } = this.getSnapshot()
    if (connection.state === 'idle' || connection.state === 'ended') return
    this.#speaking = []
    this.#endOwn()
    this.#store.update(setConnection({ state: 'ended', reason, attendeeId: local.attendeeId ?? '', code: `fake:${reason}` }))
    this.#playShares()
  }

  /** The shared window closes, or the user stops the capture from macOS. */
  endOwnSource(): void {
    const own = this.#endOwn()
    if (own !== undefined) this.#store.update(setLocalShare(undefined, { sourceId: own.sourceId, kind: own.kind, reason: 'source-ended' }))
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

  /** Someone starts sharing their screen. Returns the share's attendee id. A shown share plays a test pattern. */
  startShare(userId: string, attendeeId = `fake-${userId}`): string {
    const share = `${attendeeId}${CONTENT_SUFFIX}`
    this.#store.update(presence(share, true, `${FAKE_TEAM}-${FAKE_ROOM}-${userId}`))
    this.#playShares()
    return share
  }

  stopShare(userId: string, attendeeId = `fake-${userId}`): void {
    this.#store.update(presence(`${attendeeId}${CONTENT_SUFFIX}`, false, ''))
    this.#playShares()
  }

  /** Starts the pattern in each shown element whose share runs, and stops it where the share has gone. */
  #playShares(): void {
    const running = new Set(this.getSnapshot().shares.map((share) => share.attendeeId))
    for (const [attendeeId, shown] of this.#shown) {
      if (running.has(attendeeId) && shown.pattern === undefined) {
        shown.pattern = createTestPattern(attendeeId)
        shown.element.muted = true
        shown.element.srcObject = shown.pattern.stream
        void shown.element.play().catch(() => {})
      } else if (!running.has(attendeeId) && shown.pattern !== undefined) {
        shown.pattern.stop()
        shown.pattern = undefined
        shown.element.srcObject = null
      }
    }
  }

  /** Stops the user's share's pattern; returns what it shared. */
  #endOwn(): ShareSource | undefined {
    const own = this.#own
    if (own === undefined) return undefined
    this.#own = undefined
    own.pattern.stop()
    this.#previews.set(undefined)
    return own.source
  }

  #hide(attendeeId: string): void {
    const shown = this.#shown.get(attendeeId)
    if (shown === undefined) return
    this.#shown.delete(attendeeId)
    shown.unwatch()
    shown.pattern?.stop()
    shown.element.srcObject = null
    this.#store.update(shareReady(attendeeId, false))
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
