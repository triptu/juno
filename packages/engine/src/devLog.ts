/**
 * The developer log (`docs/architecture.md`, "Developer log"): the newest
 * `DEV_LOG_CAPACITY` things the engine did, in a ring buffer in memory.
 *
 * - Every Slack Web API and edge call, through `SlackTrace`: method, lane,
 *   reason, params, start, duration, time spent waiting, attempts, outcome,
 *   response size and a summary of the response's top level.
 * - Every socket event: its type and channel, the connects and drops.
 * - The sync's phase changes and its timed steps (boot, catch-up, sweep,
 *   follow pass), with failures and their cause.
 *
 * Recording is synchronous and cheap: one object per entry, the params and
 * summary cleaned once (`devLogText.ts`), a slot overwritten, and the open
 * panels told. With no panel open there is nobody to tell.
 *
 * In memory only. Nothing here is logged, written to disk, put in Copy log
 * or crash reports, or sent anywhere; the only reader is the `devLog.*`
 * routes, which the renderer shows on the local developer log page.
 */
import { DEV_LOG_CAPACITY, type DevLogDetail, type DevLogFilter, type DevLogRow, type DevLogSection } from '@juno/contract'
import type { SlackCallEnd, SlackCallOutcome, SlackCallStart, SlackTraceShape, SocketEvent } from '@juno/slack'
import type { SyncPhase, SyncStep } from '@juno/sync'
import { Context, Effect, Layer, Queue, Stream } from 'effect'
import { capLines, clean, cleanLine, cleanParam, summarise, type Line } from './devLogText'

interface Entry {
  row: DevLogRow
  sections: ReadonlyArray<DevLogSection>
}

export interface DevLogShape {
  /** For the Slack client of each session. */
  readonly slack: SlackTraceShape
  readonly socket: (event: SocketEvent) => void
  readonly phase: (phase: SyncPhase) => void
  readonly step: (step: SyncStep) => void
  /** Up to `limit` rows that pass `filter`, newest first, and how many pass in all. */
  readonly rows: (filter: DevLogFilter, limit: number) => { readonly rows: ReadonlyArray<DevLogRow>; readonly total: number }
  readonly detail: (id: string) => DevLogDetail | null
  /** A tick at once, then one after changes. Ticks that arrive while the reader is busy fold into one. */
  readonly changes: Stream.Stream<void>
}

const ms = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`
const bytes = (chars: number) => (chars < 1024 ? `${chars} B` : `${(chars / 1024).toFixed(1)} KB`)

/** The outcome column and whether it counts as an error. */
export function outcomeText(outcome: SlackCallOutcome): { readonly text: string; readonly failed: boolean } {
  switch (outcome._tag) {
    case 'ok':
      return { text: 'ok', failed: false }
    case 'rejected':
    case 'auth':
      return { text: clean(outcome.error, 80), failed: true }
    case 'rate-limited':
      return { text: `rate limited, retry after ${Math.round(outcome.retryAfterMillis / 1000)} s`, failed: true }
    case 'decode':
      return { text: clean(`decode error${outcome.path === undefined ? '' : ` at ${outcome.path}`}${outcome.issue === undefined ? '' : ` (${outcome.issue})`}`, 120), failed: true }
    case 'transport':
      return { text: clean(`transport: ${outcome.message}${outcome.status === undefined ? '' : ` (HTTP ${outcome.status})`}`, 120), failed: true }
    case 'stopped':
      return { text: 'not sent', failed: false }
    case 'interrupted':
      return { text: 'interrupted', failed: false }
  }
}

/** A frame's type, with its subtype (`message.message_changed`), and the channel it names. */
function frameName(frame: unknown): { readonly type: string; readonly channel: string } {
  const record = frame as { readonly type?: unknown; readonly raw?: unknown }
  const source = (record.type === 'unknown' && typeof record.raw === 'object' && record.raw !== null ? record.raw : record) as Record<string, unknown>
  const type = typeof source.type === 'string' ? source.type : 'unknown'
  const subtype = typeof source.subtype === 'string' ? `.${source.subtype}` : ''
  const channel = source.channel ?? (source.item as Record<string, unknown> | undefined)?.channel ?? source.channel_id
  const id = typeof channel === 'string' ? channel : typeof channel === 'object' && channel !== null && typeof (channel as { id?: unknown }).id === 'string' ? (channel as { id: string }).id : ''
  return { type: clean(`${type}${subtype}`, 80), channel: clean(id, 40) }
}

const section = (title: string, lines: ReadonlyArray<Line>): DevLogSection => ({ title, lines: capLines(lines) })

function matches(row: DevLogRow, filter: DevLogFilter, text: string): boolean {
  if (filter.kinds.length > 0 && !filter.kinds.includes(row.kind)) return false
  if (filter.errorsOnly && !row.failed) return false
  if (text === '') return true
  return row.name.toLowerCase().includes(text) || row.context.toLowerCase().includes(text) || row.outcome.toLowerCase().includes(text)
}

/** The ring itself: entries by sequence number, the newest `capacity` kept. */
class Ring {
  private readonly slots: Array<Entry | undefined>
  private readonly capacity: number
  private next = 0
  private readonly listeners = new Set<() => void>()

  constructor(capacity: number) {
    this.capacity = capacity
    this.slots = Array.from({ length: capacity })
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  add(row: Omit<DevLogRow, 'id' | 'rev'>, sections: ReadonlyArray<DevLogSection>): Entry {
    const entry: Entry = { row: { id: String(this.next), rev: 0, ...row }, sections }
    this.slots[this.next % this.capacity] = entry
    this.next += 1
    this.changed()
    return entry
  }

  update(entry: Entry, row: Partial<DevLogRow>, sections: ReadonlyArray<DevLogSection>): void {
    entry.row = { ...entry.row, ...row, rev: entry.row.rev + 1 }
    entry.sections = sections
    this.changed()
  }

  rows(filter: DevLogFilter, limit: number): { readonly rows: ReadonlyArray<DevLogRow>; readonly total: number } {
    const text = filter.text.trim().toLowerCase()
    const out: Array<DevLogRow> = []
    let total = 0
    for (let at = this.next - 1; at >= Math.max(0, this.next - this.capacity); at--) {
      const entry = this.slots[at % this.capacity]!
      if (!matches(entry.row, filter, text)) continue
      total += 1
      if (out.length < limit) out.push(entry.row)
    }
    return { rows: out, total }
  }

  detail(id: string): DevLogDetail | null {
    const index = Number(id)
    if (!Number.isInteger(index) || index < Math.max(0, this.next - this.capacity) || index >= this.next) return null
    const entry = this.slots[index % this.capacity]!
    return { row: entry.row, sections: entry.sections }
  }

  listen(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** One entry per call, added as it starts and completed as it ends. */
const slackTrace = (ring: Ring): SlackTraceShape => ({
  enabled: true,
  started: (call: SlackCallStart) => {
    const context = clean(call.reason === undefined ? call.lane : `${call.lane} · ${call.reason}`, 80)
    const request = section('Request', [
      { label: 'lane', value: call.lane },
      ...(call.reason === undefined ? [] : [cleanLine('reason', call.reason)]),
      ...call.params.map(([name, value]) => cleanParam(name, value)),
    ])
    const entry = ring.add({ at: call.startedAt, kind: 'slack', name: clean(call.method, 80), context, durationMs: null, outcome: 'running', failed: false }, [request])
    return (end: SlackCallEnd) => {
      const { text, failed } = outcomeText(end.outcome)
      const timing = section('Timing', [
        { label: 'duration', value: ms(end.durationMs) },
        { label: 'waiting', value: ms(end.waitMs) },
        { label: 'attempts', value: String(end.attempts) },
        ...(end.retryAfterMillis > 0 ? [{ label: 'retry-after', value: ms(end.retryAfterMillis) }] : []),
        ...(end.size > 0 ? [{ label: 'response size', value: bytes(end.size) }] : []),
      ])
      const response = end.response === undefined ? [] : [section('Response', summarise(end.response))]
      ring.update(entry, { durationMs: end.durationMs, outcome: text, failed }, [request, timing, ...response])
    }
  },
})

const socketRecorder = (ring: Ring) => (event: SocketEvent): void => {
  const at = Date.now()
  switch (event._tag) {
    case 'Connected':
      ring.add({ at, kind: 'socket', name: 'connected', context: event.fast ? 'reconnect url' : '', durationMs: null, outcome: 'ok', failed: false }, [])
      return
    case 'Disconnected':
      ring.add({ at, kind: 'socket', name: 'disconnected', context: `retry in ${Math.round(event.retryInMillis / 1000)} s`, durationMs: null, outcome: clean(event.reason, 120), failed: true },
        [section('Drop', [cleanLine('reason', event.reason), { label: 'retry in', value: ms(event.retryInMillis) }])])
      return
    case 'Frame': {
      const { type, channel } = frameName(event.frame)
      // From arrival to the end of the sync's write.
      const handled = Math.max(0, at - event.receivedAt)
      ring.add({ at: event.receivedAt, kind: 'socket', name: type, context: channel, durationMs: handled, outcome: 'ok', failed: false }, [])
    }
  }
}

/** A phase is logged when its kind changes, not for each step of a catch-up's progress. */
const phaseRecorder = (ring: Ring) => {
  let last: string | undefined
  return (next: SyncPhase): void => {
    if (next._tag === last) return
    last = next._tag
    const first = 'first' in next && next.first === true ? 'first sync' : ''
    const reason = next._tag === 'failed' ? clean([next.reason.error, next.reason.method, next.reason.detail].filter((part) => part !== undefined).join(' · '), 120) : undefined
    ring.add({ at: Date.now(), kind: 'sync', name: `phase ${next._tag}`, context: first, durationMs: null, outcome: reason ?? 'ok', failed: next._tag === 'offline' || next._tag === 'failed' },
      reason === undefined ? [] : [section('Failure', [cleanLine('reason', reason)])])
  }
}

const stepRecorder = (ring: Ring) => {
  const running = new Map<string, Entry>()
  return (event: SyncStep): void => {
    if (event.event === 'started') {
      running.set(event.name, ring.add({ at: Date.now(), kind: 'sync', name: event.name, context: '', durationMs: null, outcome: 'running', failed: false }, []))
      return
    }
    const entry = running.get(event.name)
    running.delete(event.name)
    const cause = event.cause === undefined ? [] : [section('Failure', [cleanLine('cause', event.cause)])]
    const outcome = event.event === 'failed' ? clean(event.cause ?? 'failed', 120) : event.event === 'finished' ? 'ok' : 'interrupted'
    const row = { durationMs: event.durationMs, outcome, failed: event.event === 'failed' }
    if (entry === undefined) ring.add({ at: Date.now() - event.durationMs, kind: 'sync', name: event.name, context: '', ...row }, cause)
    else ring.update(entry, row, cause)
  }
}

/** The buffer and its recorders, outside Effect so tests and benchmarks can drive it directly. */
export function makeDevLog(capacity = DEV_LOG_CAPACITY): Omit<DevLogShape, 'changes'> & { readonly listen: (listener: () => void) => () => void } {
  const ring = new Ring(capacity)
  return {
    slack: slackTrace(ring),
    socket: socketRecorder(ring),
    phase: phaseRecorder(ring),
    step: stepRecorder(ring),
    rows: (filter, limit) => ring.rows(filter, limit),
    detail: (id) => ring.detail(id),
    listen: (listener) => ring.listen(listener),
  }
}

export class DevLog extends Context.Service<DevLog, DevLogShape>()('juno/engine/DevLog') {
  static readonly layer: Layer.Layer<DevLog> = Layer.sync(DevLog, () => {
    const log = makeDevLog()
    const changes = Stream.callback<void>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          Queue.offerUnsafe(queue, undefined)
          return log.listen(() => { Queue.offerUnsafe(queue, undefined) })
        }),
        (stop) => Effect.sync(stop),
      ), { bufferSize: 1, strategy: 'sliding' })
    return DevLog.of({ ...log, changes })
  })
}
