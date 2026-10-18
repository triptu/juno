/**
 * The browser side of `huddle-live.ts`: Juno's own Chime media session
 * (`@juno/huddle-media/chime`), with Chromium's fake microphone. The script
 * bundles this file with Bun, serves it from localhost and opens it in
 * Playwright's Chromium.
 *
 * `junoJoin(meeting, attendee)` starts the session; `junoLeave()` stops it.
 * Snapshot changes go back to the script through `junoReport`, which the
 * script exposes.
 */
import type { MediaSnapshot } from '@juno/huddle-media'
import { createChimeMediaSession } from '@juno/huddle-media/chime'
import type { HuddleEvent } from './huddle-live-report.ts'

declare global {
  interface Window {
    junoReport(event: HuddleEvent): void
    junoJoin(meeting: unknown, attendee: unknown, noiseSuppression: boolean): Promise<string>
    junoLeave(): Promise<void>
  }
}

const report = (event: HuddleEvent) => window.junoReport(event)
const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown')

const session = createChimeMediaSession()
let last: MediaSnapshot = session.getSnapshot()

/** Turns one snapshot change into the events the report reads. */
function changed(next: MediaSnapshot) {
  const prev = last
  last = next
  const c = next.connection
  if (c.state !== prev.connection.state) {
    if (c.state === 'connecting') report({ kind: 'lifecycle', name: 'audioVideoDidStartConnecting', detail: 'first' })
    if (c.state === 'reconnecting') report({ kind: 'lifecycle', name: 'audioVideoDidStartConnecting', detail: 'reconnecting' })
    if (c.state === 'connected') report({ kind: 'lifecycle', name: 'audioVideoDidStart' })
    if (c.state === 'ended') report({ kind: 'lifecycle', name: 'audioVideoDidStop', detail: `${c.code} (${c.reason})` })
  }
  if (next.microphoneAccess !== prev.microphoneAccess) report({ kind: 'lifecycle', name: 'microphone', detail: next.microphoneAccess })
  if (next.local.sending !== prev.local.sending) report({ kind: 'lifecycle', name: 'sending', detail: next.local.sending ? 'yes' : 'no' })
  if (next.noiseSuppression !== prev.noiseSuppression) report({ kind: 'lifecycle', name: 'voiceFocus', detail: next.noiseSuppression })
  const before = new Map(prev.remotes.map((r) => [r.attendeeId, r]))
  const after = new Map(next.remotes.map((r) => [r.attendeeId, r]))
  for (const r of next.remotes) if (!before.has(r.attendeeId)) report({ kind: 'presence', attendeeId: r.attendeeId, present: true, externalUserId: r.externalUserId, dropped: false })
  for (const r of prev.remotes) if (!after.has(r.attendeeId)) report({ kind: 'presence', attendeeId: r.attendeeId, present: false, externalUserId: r.externalUserId, dropped: false })
  for (const r of next.remotes) if (r.speaking !== (before.get(r.attendeeId)?.speaking ?? false)) report({ kind: 'speaking', attendeeId: r.attendeeId, speaking: r.speaking })
  if (next.local.speaking !== prev.local.speaking && next.local.attendeeId !== undefined) report({ kind: 'speaking', attendeeId: next.local.attendeeId, speaking: next.local.speaking })
}
session.subscribe(() => changed(session.getSnapshot()))

window.junoJoin = async (meeting, attendee, noiseSuppression) => {
  await session.join({ meeting, attendee, noiseSuppression })
  return session.getSnapshot().local.attendeeId ?? ''
}

window.junoLeave = () => session.leave()

window.addEventListener('unhandledrejection', (event) => report({ kind: 'error', where: 'unhandledrejection', name: errorName(event.reason) }))
