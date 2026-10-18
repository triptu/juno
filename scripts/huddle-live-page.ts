/**
 * The browser side of `huddle-live.ts`: one Chime meeting session, audio
 * only, with Chromium's fake microphone. The script bundles this file with
 * Bun, serves it from localhost and opens it in Playwright's Chromium.
 *
 * `junoJoin(meeting, attendee)` starts the session; `junoLeave()` stops it.
 * Events go back to the script through `junoReport`, which the script
 * exposes. The Chime logger is off, since its lines carry urls and tokens.
 */
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  MeetingSessionStatusCode,
  type AudioVideoObserver,
  type MeetingSession,
} from 'amazon-chime-sdk-js'
import type { HuddleEvent } from './huddle-live-report.ts'

declare global {
  interface Window {
    junoReport(event: HuddleEvent): void
    junoJoin(meeting: unknown, attendee: unknown): Promise<string>
    junoLeave(): Promise<void>
  }
}

const report = (event: HuddleEvent) => window.junoReport(event)
const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown')

let session: MeetingSession | undefined

window.junoJoin = async (meeting, attendee) => {
  const logger = new ConsoleLogger('huddle', LogLevel.OFF)
  const devices = new DefaultDeviceController(logger)
  const configuration = new MeetingSessionConfiguration(meeting, attendee)
  session = new DefaultMeetingSession(configuration, logger, devices)
  const av = session.audioVideo

  const observer: AudioVideoObserver = {
    audioVideoDidStartConnecting: (reconnecting) => report({ kind: 'lifecycle', name: 'audioVideoDidStartConnecting', detail: reconnecting ? 'reconnecting' : 'first' }),
    audioVideoDidStart: () => report({ kind: 'lifecycle', name: 'audioVideoDidStart' }),
    audioVideoDidStop: (status) => {
      const code = status.statusCode()
      report({ kind: 'lifecycle', name: 'audioVideoDidStop', detail: `${code} ${MeetingSessionStatusCode[code] ?? ''}`.trim() })
    },
    connectionDidBecomePoor: () => report({ kind: 'lifecycle', name: 'connectionDidBecomePoor' }),
    connectionDidBecomeGood: () => report({ kind: 'lifecycle', name: 'connectionDidBecomeGood' }),
    connectionHealthDidChange: (health) =>
      report({
        kind: 'health',
        missedPongs: health.consecutiveMissedPongs,
        noPacketsStats: health.consecutiveStatsWithNoPackets,
        noAudioSentStats: health.consecutiveStatsWithNoAudioPacketsSent,
      }),
  }
  av.addObserver(observer)

  const watched = new Set<string>()
  av.realtimeSubscribeToAttendeeIdPresence((attendeeId, present, externalUserId, dropped) => {
    report({ kind: 'presence', attendeeId, present, externalUserId: externalUserId ?? '', dropped: dropped === true })
    if (present && !watched.has(attendeeId)) {
      watched.add(attendeeId)
      av.realtimeSubscribeToVolumeIndicator(attendeeId, (id, volume, muted) => {
        if (volume !== null || muted !== null) report({ kind: 'volume', attendeeId: id, volume: volume ?? 0, muted: muted === true })
      })
    }
  })

  const inputs = await av.listAudioInputDevices()
  report({ kind: 'lifecycle', name: 'audioInputs', detail: `${inputs.length} device(s)` })
  await av.startAudioInput(inputs[0]?.deviceId ?? 'default')
  const element = document.querySelector('audio')
  if (element !== null) await av.bindAudioElement(element)
  av.start()
  av.realtimeUnmuteLocalAudio()
  return configuration.credentials?.attendeeId ?? ''
}

window.junoLeave = async () => {
  if (session === undefined) return
  try {
    await session.audioVideo.stopAudioInput()
  } catch (error) {
    report({ kind: 'error', where: 'stopAudioInput', name: errorName(error) })
  }
  session.audioVideo.stop()
}

window.addEventListener('unhandledrejection', (event) => report({ kind: 'error', where: 'unhandledrejection', name: errorName(event.reason) }))
