/**
 * The real Chime session against the browser's device API as a fake: the
 * microphone that macOS grants after the user has left (HUD-3). Chime's
 * session objects construct under bun with a happy-dom window and the few
 * WebRTC classes they look up; nothing here connects.
 */
import { afterAll, beforeAll, expect, it } from 'bun:test'
import { Window } from 'happy-dom'
import { createChimeMediaSession } from '../src/chime/session.ts'
import type { JoinInfo } from '../src/types.ts'

class FakeTrack extends EventTarget {
  readonly kind = 'audio'
  readonly muted = false
  readyState: 'live' | 'ended' = 'live'
  getSettings(): { deviceId: string } {
    return { deviceId: 'mic-1' }
  }
  stop(): void {
    this.readyState = 'ended'
  }
}

class FakeStream {
  readonly id = 'stream-1'
  readonly #tracks: ReadonlyArray<FakeTrack>
  constructor(tracks: ReadonlyArray<FakeTrack>) {
    this.#tracks = tracks
  }
  getTracks(): ReadonlyArray<FakeTrack> {
    return this.#tracks
  }
  getAudioTracks(): ReadonlyArray<FakeTrack> {
    return this.#tracks
  }
  getVideoTracks(): ReadonlyArray<never> {
    return []
  }
}

/** `getUserMedia` as the macOS prompt holds it: `asked` once the call wants the microphone, `grant` as the user's Allow. */
let grant: (stream: FakeStream) => void = () => {}
let asked: () => void = () => {}
const prompt = new Promise<void>((resolve) => (asked = resolve))
const mediaDevices = {
  enumerateDevices: () => Promise.resolve([]),
  getUserMedia: () =>
    new Promise<FakeStream>((resolve) => {
      grant = resolve
      asked()
    }),
  addEventListener: () => {},
  removeEventListener: () => {},
}

/** The WebRTC classes Chime's session looks up as it constructs; no call here gets as far as using one. */
function WebRtcUnavailable(): never {
  throw new Error('huddle-media test: WebRTC is not available under bun')
}

const window = new Window()
const globals: Record<string, unknown> = {
  window,
  document: window.document,
  navigator: { userAgent: 'Mozilla/5.0 Chrome/130.0.0.0', mediaDevices },
  RTCRtpSender: WebRtcUnavailable,
  RTCRtpReceiver: WebRtcUnavailable,
  RTCPeerConnection: WebRtcUnavailable,
}
const saved = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
beforeAll(() => {
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
})
afterAll(async () => {
  for (const [name, descriptor] of saved) {
    if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name]
    else Object.defineProperty(globalThis, name, descriptor)
  }
  await window.happyDOM.close()
})

const JOIN: JoinInfo = {
  meeting: { MeetingId: 'm1', MediaPlacement: { AudioHostUrl: 'wss://audio.example/x', SignalingUrl: 'wss://signal.example/control', TurnControlUrl: 'https://turn.example' } },
  attendee: { AttendeeId: 'A1', JoinToken: 'join-token', ExternalUserId: 'T1-R1-U1' },
}

it('a microphone granted after the user left is stopped, and the call stays ended', async () => {
  const session = createChimeMediaSession()
  const joining = session.join(JOIN)
  await prompt
  expect(session.getSnapshot().connection.state).toBe('connecting')

  await session.leave()
  expect(session.getSnapshot().connection).toMatchObject({ state: 'ended', reason: 'left', attendeeId: 'A1' })

  const track = new FakeTrack()
  grant(new FakeStream([track]))
  // The join resolves once the session has dealt with the microphone it was given.
  await joining

  expect(track.readyState).toBe('ended')
  const snapshot = session.getSnapshot()
  expect(snapshot.connection).toMatchObject({ state: 'ended', reason: 'left' })
  expect(snapshot.devices.microphoneInUse).toBeNull()
  expect(snapshot.microphoneAccess).toBe('unknown')
})
