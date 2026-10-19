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

/** Whether the test channel has a huddle running and whether it still lists this user: counts, booleans and ages only. */
export function printHuddles(answer: unknown, self: string) {
  if (answer === undefined) return
  const huddles = ((answer as { huddles?: unknown }).huddles ?? []) as ReadonlyArray<{ active_members?: ReadonlyArray<string>; dropped_members?: ReadonlyArray<string>; start_date?: number; expiration?: number }>
  log(`huddles running in the test channel: ${huddles.length}`)
  const now = Date.now() / 1000
  for (const huddle of huddles) {
    const active = huddle.active_members ?? []
    const dropped = huddle.dropped_members ?? []
    log(
      `  active members ${active.length} (you ${active.includes(self) ? 'among them' : 'not among them'}), dropped members ${dropped.length} (you ${dropped.includes(self) ? 'among them' : 'not among them'})` +
        `, started ${huddle.start_date === undefined ? '?' : `${Math.round((now - huddle.start_date) / 60)} min ago`}` +
        `, expiration ${huddle.expiration === undefined ? '?' : huddle.expiration === 0 ? '0' : `${Math.round(huddle.expiration - now)} s from now`}`,
    )
  }
}

/** What the page sends through `junoReport`. */
export type HuddleEvent =
  | { readonly kind: 'lifecycle'; readonly name: string; readonly detail?: string }
  | { readonly kind: 'presence'; readonly attendeeId: string; readonly present: boolean; readonly externalUserId: string; readonly dropped: boolean }
  /** Chime's active speaker detection started or stopped counting this attendee as speaking. */
  | { readonly kind: 'speaking'; readonly attendeeId: string; readonly speaking: boolean }
  | { readonly kind: 'error'; readonly where: string; readonly name: string }

export interface RoomFrameCounts {
  readonly roomFrames: number
  readonly aboutThisRoom: number
}

/** Folds the page's events into log lines and a status line every 10 s. Holds `ExternalUserId` values in memory only. */
export class MediaReport {
  started = false
  stopped = false
  readonly #self: string
  readonly #selfUser: string
  readonly #onStop: () => void
  readonly #present = new Map<string, string>()
  readonly #shapes = new Set<string>()
  /** Who speaks now. A steady tone stays in here, so the status line reads it as well as the starts. */
  readonly #speakingNow = new Set<string>()
  /** Spoke since the last status line. */
  #remoteSpoke = false
  #ownSpoke = false
  #everHeard = false
  #everSent = false

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
      case 'speaking':
        if (!event.speaking) {
          this.#speakingNow.delete(event.attendeeId)
          return
        }
        this.#speakingNow.add(event.attendeeId)
        if (event.attendeeId === this.#self) {
          this.#ownSpoke = true
          this.#everSent = true
        } else {
          this.#remoteSpoke = true
          this.#everHeard = true
        }
        return
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
    const parts = event.externalUserId.split(/[-#]/)
    const yours = parts.indexOf(this.#selfUser)
    log(
      `chime attendee ${event.present ? 'joined' : event.dropped ? 'dropped' : 'left'}: ${who}, ExternalUserId ${shape}, ` +
        `${yours === -1 ? 'no part is your user id' : `part ${yours + 1} of ${parts.length} is your user id`}, remote attendees now ${this.#remoteCount()}`,
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
      ` | remote speaking ${this.#remoteSpoke || [...this.#speakingNow].some((id) => id !== this.#self) ? 'yes' : 'no'}` +
      ` | own audio at Chime ${this.#ownSpoke || this.#speakingNow.has(this.#self) ? 'yes' : 'no'}` +
      ` | room frames ${socket === undefined ? 'socket off' : `${socket.aboutThisRoom} for this room, ${socket.roomFrames} in all`}`
    this.#remoteSpoke = false
    this.#ownSpoke = false
    return line
  }

  summary() {
    log(
      `summary: media started ${this.started ? 'yes' : 'no'}, heard remote audio ${this.#everHeard ? 'yes' : 'no'}, sent own audio ${this.#everSent ? 'yes' : 'no'}, ` +
        `ExternalUserId shapes seen: ${[...this.#shapes].join(' | ') || 'none'}`,
    )
  }
}

/** The unit an epoch time is in, judged by its size: `seconds` (10 digits), `milliseconds` (13), else `unknown`. Prints no value. */
export function timeUnit(value: unknown): 'seconds' | 'milliseconds' | 'unknown' | 'absent' {
  if (value === undefined || value === null) return 'absent'
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'unknown'
  if (n >= 1e9 && n < 1e10) return 'seconds'
  if (n >= 1e12 && n < 1e13) return 'milliseconds'
  return 'unknown'
}

/**
 * The identity and time facts the engine relies on (docs/research/slack-huddles.md
 * section 6): booleans and units only, never an id or a time.
 */
export interface IdentityFacts {
  joinFrameRoomId?: string
  joinFrameDateStart?: unknown
  infoCallId?: string
  infoStartDate?: unknown
  externalUserIdRoom?: string
}

/** From the join answer's attendee: the room part of `ExternalUserId` (team id, room id, user id, as recorded). */
export function factsFromJoin(facts: IdentityFacts, attendee: Readonly<Record<string, unknown>> | undefined) {
  const external = attendee?.['ExternalUserId']
  if (typeof external === 'string') facts.externalUserIdRoom = external.split('-')[1]
}

/** From the first `sh_room_join` of the test channel. */
export function factsFromFrame(facts: IdentityFacts, frame: unknown) {
  if (facts.joinFrameRoomId !== undefined) return
  const room = (frame as { room?: { id?: unknown; date_start?: unknown } }).room
  if (typeof room?.id === 'string') facts.joinFrameRoomId = room.id
  facts.joinFrameDateStart = room?.date_start
}

/** From the test channel's running huddle in a `huddles/info` answer. */
export function factsFromInfo(facts: IdentityFacts, answer: unknown, channel: string | undefined) {
  const huddles = (answer as { huddles?: ReadonlyArray<{ channel_id?: unknown; call_id?: unknown; start_date?: unknown }> } | undefined)?.huddles ?? []
  const mine = huddles.find((h) => h.channel_id === channel)
  if (mine === undefined) return
  if (typeof mine.call_id === 'string') facts.infoCallId = mine.call_id
  facts.infoStartDate = mine.start_date
}

export function printIdentityFacts(facts: IdentityFacts, callId: string | undefined) {
  const same = (other: string | undefined) => (other === undefined || callId === undefined ? 'unknown' : String(other === callId))
  log(`fact: sh_room_join room.id equals rooms.join call.call_id: ${same(facts.joinFrameRoomId)}`)
  log(`fact: sh_room_join room.date_start unit: ${timeUnit(facts.joinFrameDateStart)}`)
  log(`fact: huddles/info call_id equals rooms.join call.call_id: ${same(facts.infoCallId)}`)
  log(`fact: huddles/info start_date unit: ${timeUnit(facts.infoStartDate)}`)
  log(`fact: attendee ExternalUserId room part equals rooms.join call.call_id: ${same(facts.externalUserIdRoom)}`)
}
