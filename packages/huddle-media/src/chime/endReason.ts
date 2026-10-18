import { MeetingSessionStatusCode as Code } from 'amazon-chime-sdk-js'
import type { EndReason } from '../types.ts'

/** Codes for a dropped connection. Chime retries these itself; it stops with one only when the reconnect window runs out. */
const CONNECTION = new Set<Code>([
  Code.AudioDisconnected,
  Code.AudioDisconnectAudio,
  Code.AudioInternalServerError,
  Code.AudioServiceUnavailable,
  Code.ConnectionHealthReconnect,
  Code.ICEGatheringTimeoutWorkaround,
  Code.SignalingChannelClosedUnexpectedly,
  Code.SignalingInternalServerError,
  Code.SignalingRequestFailed,
  Code.NoAttendeePresent,
])

/**
 * Why a call ended, from the status code of Chime's `audioVideoDidStop`.
 * `leaving`: Juno asked for the stop, so any code reads as `left`.
 * `everConnected`: a dropped connection before the call ever connected is a
 * failed join, not a lost connection.
 */
export function endReasonOf(code: Code, options: { readonly leaving: boolean; readonly everConnected: boolean }): EndReason {
  if (options.leaving) return 'left'
  switch (code) {
    case Code.OK:
    case Code.Left:
      return 'left'
    case Code.AudioJoinedFromAnotherDevice:
      return 'another-device'
    case Code.MeetingEnded:
      return 'meeting-ended'
    case Code.AudioAttendeeRemoved:
      return 'removed'
    case Code.AudioCallAtCapacity:
      return 'full'
  }
  return CONNECTION.has(code) && options.everConnected ? 'connection-lost' : 'failed'
}

export const codeName = (code: Code): string => Code[code] ?? String(code)
