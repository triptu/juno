import type { MicrophoneAccess } from '../types.ts'

/**
 * Why the microphone would not start, from the error Chime's `startAudioInput`
 * throws (its `handleGetUserMediaError` names them) and how many microphones
 * Chromium lists. Without any, the user has no microphone, whatever the error.
 */
export function microphoneProblem(error: unknown, microphones: number): MicrophoneAccess {
  const name = error instanceof Error ? error.name : ''
  if (name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || microphones === 0) return 'unavailable'
  return 'failed'
}
