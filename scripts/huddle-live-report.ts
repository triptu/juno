/**
 * What `huddle-live.ts` prints: field-name paths, id shapes, safe error
 * lines, and the running report of what the Chime page sees. Shapes and
 * counts only, never a value.
 */

export const log = (line: string) => console.log(`huddle-live: ${line}`)

const ID_KEY = /^([A-Z][A-Z0-9]{4,}|[0-9a-f-]{16,}|[0-9A-F-]{16,})$/

/** `a.b[].c: string` for every leaf. Arrays show their first three items merged; keys that look like ids become `ID`. */
export function keyPaths(value: unknown, prefix = ''): Array<string> {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]: empty`]
    return [...new Set(value.slice(0, 3).flatMap((item) => keyPaths(item, `${prefix}[]`)))]
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return [`${prefix}: {}`]
    return [...new Set(entries.flatMap(([k, v]) => keyPaths(v, `${prefix === '' ? '' : `${prefix}.`}${ID_KEY.test(k) ? 'ID' : k}`)))]
  }
  return [`${prefix}: ${value === null ? 'null' : typeof value}`]
}

export function printPaths(title: string, value: unknown) {
  log(`${title}, field names:`)
  for (const path of keyPaths(value)) console.log(`    ${path}`)
}

/** `U + 10 chars '#' 36 chars`: the first letter when it is a capital, then lengths and separators. */
export function idShape(value: string): string {
  if (value === '') return '(empty)'
  return value
    .split(/([^A-Za-z0-9])/)
    .filter((part) => part !== '')
    .map((part) => (/^[^A-Za-z0-9]$/.test(part) ? `'${part}'` : /^[A-Z]/.test(part) && part.length > 1 ? `${part[0]} + ${part.length - 1} chars` : `${part.length} chars`))
    .join(' ')
}

/** An error from outside the Slack client: its name and a first line with urls and long tokens removed. */
export const safeError = (error: unknown) =>
  error instanceof Error
    ? `${error.name}: ${(error.message.split('\n')[0] ?? '').replace(/\b\w+:\/\/\S+/g, '<url>').replace(/[A-Za-z0-9+/=_-]{24,}/g, '<redacted>').slice(0, 160)}`
    : 'unknown error'

/** What the page sends through `junoReport`. */
export type HuddleEvent =
  | { readonly kind: 'lifecycle'; readonly name: string; readonly detail?: string }
  | { readonly kind: 'presence'; readonly attendeeId: string; readonly present: boolean; readonly externalUserId: string; readonly dropped: boolean }
  | { readonly kind: 'volume'; readonly attendeeId: string; readonly volume: number; readonly muted: boolean }
  | { readonly kind: 'health'; readonly missedPongs: number; readonly noPacketsStats: number; readonly noAudioSentStats: number }
  | { readonly kind: 'error'; readonly where: string; readonly name: string }

export interface RoomFrameCounts {
  readonly roomFrames: number
  readonly aboutThisRoom: number
}

/** Chime's volume indicator is 0 to 1; below this counts as silence. */
const SILENCE = 0.05

/** Folds the page's events into log lines and a status line every 10 s. Holds `ExternalUserId` values in memory only. */
export class MediaReport {
  started = false
  stopped = false
  readonly #self: string
  readonly #selfUser: string
  readonly #onStop: () => void
  readonly #present = new Map<string, string>()
  readonly #shapes = new Set<string>()
  #remotePeak = 0
  #ownPeak = 0
  #everHeard = false
  #everSent = false
  #lastHealth = ''

  constructor(selfAttendee: string, selfUser: string, onStop: () => void) {
    this.#self = selfAttendee
    this.#selfUser = selfUser
    this.#onStop = onStop
  }

  on(event: HuddleEvent) {
    switch (event.kind) {
      case 'lifecycle':
        if (event.name === 'audioVideoDidStart') this.started = true
        log(`chime ${event.name}${event.detail === undefined ? '' : ` ${event.detail}`}`)
        if (event.name === 'audioVideoDidStop') {
          this.stopped = true
          this.#onStop()
        }
        return
      case 'presence':
        return this.#presence(event)
      case 'volume':
        if (event.attendeeId === this.#self) {
          this.#ownPeak = Math.max(this.#ownPeak, event.volume)
          this.#everSent ||= event.volume > SILENCE
        } else {
          this.#remotePeak = Math.max(this.#remotePeak, event.volume)
          this.#everHeard ||= event.volume > SILENCE
        }
        return
      case 'health': {
        const line = `missed pongs ${event.missedPongs}, stats without packets ${event.noPacketsStats}, without audio sent ${event.noAudioSentStats}`
        if (line !== this.#lastHealth && (event.missedPongs > 0 || event.noPacketsStats > 2 || event.noAudioSentStats > 2)) log(`chime health: ${line}`)
        this.#lastHealth = line
        return
      }
      case 'error':
        log(`page error in ${event.where}: ${event.name}`)
    }
  }

  #presence(event: Extract<HuddleEvent, { kind: 'presence' }>) {
    const who = event.attendeeId === this.#self ? 'this page' : event.attendeeId.endsWith('#content') ? 'a content share' : 'remote'
    if (event.present) this.#present.set(event.attendeeId, event.externalUserId)
    else this.#present.delete(event.attendeeId)
    const shape = idShape(event.externalUserId)
    this.#shapes.add(shape)
    const user = event.externalUserId.split('#')[0] ?? ''
    log(
      `chime attendee ${event.present ? 'joined' : event.dropped ? 'dropped' : 'left'}: ${who}, ExternalUserId ${shape}, ` +
        `its part before '#' is ${user === this.#selfUser ? 'your user id' : 'not your user id'}, remote attendees now ${this.#remoteCount()}`,
    )
  }

  #remoteCount() {
    return [...this.#present.keys()].filter((id) => id !== this.#self && !id.endsWith('#content')).length
  }

  status(elapsed: number, socket: RoomFrameCounts | undefined): string {
    const s = Math.round(elapsed / 1000)
    const line =
      `  [${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}] connected ${this.started && !this.stopped ? 'yes' : 'no'}` +
      ` | remote attendees ${this.#remoteCount()}` +
      ` | remote audio ${this.#remotePeak > SILENCE ? 'above silence' : 'silent'} (peak ${this.#remotePeak.toFixed(2)})` +
      ` | own audio at Chime ${this.#ownPeak > SILENCE ? 'yes' : 'no'} (peak ${this.#ownPeak.toFixed(2)})` +
      ` | room frames ${socket === undefined ? 'socket off' : `${socket.aboutThisRoom} for this room, ${socket.roomFrames} in all`}`
    this.#remotePeak = 0
    this.#ownPeak = 0
    return line
  }

  summary() {
    log(
      `summary: media started ${this.started ? 'yes' : 'no'}, heard remote audio ${this.#everHeard ? 'yes' : 'no'}, sent own audio ${this.#everSent ? 'yes' : 'no'}, ` +
        `ExternalUserId shapes seen: ${[...this.#shapes].join(' | ') || 'none'}`,
    )
  }
}
