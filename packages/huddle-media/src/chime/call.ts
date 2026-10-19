/** One call's Chime objects and the state the session keeps for it. */
import { DefaultDeviceController, DefaultMeetingSession, type AudioVideoFacade, type Logger, type MeetingSessionConfiguration } from 'amazon-chime-sdk-js'
import { ContentTiles } from './contentTiles.ts'
import type { VoiceFocus } from './voiceFocus.ts'

const noop = () => {}

export interface Call {
  readonly attendeeId: string
  readonly av: AudioVideoFacade
  /** Others' shared screens. */
  readonly tiles: ContentTiles
  readonly voiceFocusSupported: boolean
  voiceFocus: VoiceFocus | undefined
  started: boolean
  leaving: boolean
  everConnected: boolean
  ended: boolean
  watchingAccess: boolean
  /** The microphone track Chime sends, and the stop of its listeners. */
  track: MediaStreamTrack | undefined
  unwatchTrack: () => void
  /** Chime's server-side signal strength for us, 0 to 1; null until it reports. */
  signal: number | null
  readonly stopped: Promise<void>
  readonly resolveStopped: () => void
  readonly cleanups: Array<() => void>
}

export function newCall(configuration: MeetingSessionConfiguration, withVoiceFocus: boolean, logger: Logger, onShareReady: (attendeeId: string, ready: boolean) => void): Call {
  // Voice Focus runs in Web Audio; without it, the plain path has less latency.
  const devices = new DefaultDeviceController(logger, { enableWebAudio: withVoiceFocus })
  const av = new DefaultMeetingSession(configuration, logger, devices).audioVideo
  let resolveStopped: () => void = noop
  const stopped = new Promise<void>((resolve) => (resolveStopped = resolve))
  return {
    attendeeId: configuration.credentials?.attendeeId ?? '',
    av,
    tiles: new ContentTiles(av, onShareReady),
    voiceFocusSupported: withVoiceFocus,
    voiceFocus: undefined,
    started: false,
    leaving: false,
    everConnected: false,
    ended: false,
    watchingAccess: false,
    track: undefined,
    unwatchTrack: noop,
    signal: null,
    stopped,
    resolveStopped,
    cleanups: [],
  }
}
