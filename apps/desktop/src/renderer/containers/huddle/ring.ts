/**
 * The incoming huddle's ring (SPEC 20, "Incoming huddles"): one soft ring
 * every few seconds until the engine's `ringUntil`, a join, a dismiss or the
 * huddle's end. The file holds one ring and the silence after it, so a
 * looped element keeps the pace with no timer; one timer stops it. It plays
 * on the speaker picked for huddles, at the call sounds' volume.
 *
 * Under JUNO_E2E nothing plays: the page records it in
 * `window.__junoHuddleRing` for the test.
 */
import ringSound from './sounds/huddle-ring.wav?url'
import { fakeMedia, pickedSpeaker } from './media'

/** As the join and leave sounds (`@juno/huddle-media`'s chime sounds). */
const VOLUME = 0.5

interface RingRecord {
  ringing: boolean
  /** How many times a ring started. */
  starts: number
}

let audio: HTMLAudioElement | undefined
let until: number | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let record: RingRecord | undefined

function stop(): void {
  until = null
  clearTimeout(timer)
  audio?.pause()
  audio = undefined
  if (record !== undefined) record.ringing = false
}

async function start(): Promise<void> {
  if (await fakeMedia()) {
    record ??= Object.assign(window, { __junoHuddleRing: { ringing: false, starts: 0 } }).__junoHuddleRing
    record.ringing = until !== null
    if (until !== null) record.starts += 1
    return
  }
  const element = new Audio(ringSound)
  element.loop = true
  element.volume = VOLUME
  audio = element
  await element.setSinkId(pickedSpeaker() ?? '').catch(() => element.setSinkId('')).catch(() => {})
  // Stopped while the speaker was set.
  if (audio === element) await element.play().catch(() => {})
}

/** Rings until `next` (epoch milliseconds); null or a time past stops it. */
export function ringUntil(next: number | null): void {
  const left = next === null ? 0 : next - Date.now()
  if (left <= 0) return stop()
  if (next === until) return
  const ringing = until !== null
  until = next
  clearTimeout(timer)
  timer = setTimeout(stop, left)
  if (!ringing) void start()
}
