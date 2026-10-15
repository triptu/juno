import type { Locator, Page } from '@playwright/test'
import { recordTrace } from './perfTrace'

interface TypingProbe {
  readonly events: number[]
  count: number
  valid: boolean
  stop(): void
}

declare global {
  interface Window {
    __typingProbe?: TypingProbe
  }
}

/** The frame containing each input's value, linked to Chromium's presentation feedback. */
export async function typingReading(win: Page, input: Locator, name: string, type: () => Promise<void>) {
  await input.evaluate((node) => {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) throw new Error('Typing probe needs a text field')
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (entry instanceof PerformanceEventTiming && entry.target === node && (entry.name === 'keydown' || entry.name === 'keypress')) probe.events.push(entry.duration)
      }
    })
    const onInput = (event: Event) => {
      const id = probe.count++
      const value = node.value
      performance.mark(`perf.key.input.${id}`, { startTime: event.timeStamp })
      requestAnimationFrame(() => {
        // Later keys may share this frame. Every earlier character must still be there.
        probe.valid &&= node.isConnected && node.value.startsWith(value)
        performance.mark(`perf.key.frame.${id}`)
      })
    }
    const probe: TypingProbe = {
      events: [], count: 0, valid: true,
      stop: () => { observer.disconnect(); node.removeEventListener('input', onInput) },
    }
    window.__typingProbe = probe
    const options = { type: 'event', durationThreshold: 16 }
    observer.observe(options)
    node.addEventListener('input', onInput)
  })
  try {
    const json = await recordTrace(win, name, async () => {
      await type()
      // Presentation feedback is asynchronous; include it before stopping the trace.
      await win.waitForTimeout(200)
    })
    const result = await win.evaluate(() => {
      const probe = window.__typingProbe
      if (probe === undefined) throw new Error('Typing probe missing')
      return { events: probe.events, count: probe.count, valid: probe.valid }
    })
    if (!result.valid || result.count === 0) throw new Error('The typed characters did not reach their frame')
    const presented = inputPresentations(json)
    if (presented.length !== result.count) throw new Error(`Presentation feedback for ${presented.length} of ${result.count} inputs`)
    return { ...result, presented }
  } finally {
    await win.evaluate(() => { window.__typingProbe?.stop(); delete window.__typingProbe })
  }
}

interface InputTraceEvent {
  readonly name: string
  readonly ph: string
  readonly pid: number
  readonly tid: number
  readonly ts: number
  readonly frameId?: string
}

/** Parse only the trace fields this measurement uses. Never substitute a timer for missing feedback. */
export function inputPresentations(json: string): number[] {
  const raw: unknown = JSON.parse(json)
  if (typeof raw !== 'object' || raw === null || !('traceEvents' in raw) || !Array.isArray(raw.traceEvents)) throw new Error('Invalid trace')
  const events: InputTraceEvent[] = []
  const values: readonly unknown[] = raw.traceEvents
  for (const value of values) {
    if (!isRecord(value)) continue
    const { name, ph, pid, tid, ts, args } = value
    if (typeof name !== 'string' || typeof ph !== 'string' || typeof pid !== 'number' || typeof tid !== 'number' || typeof ts !== 'number') continue
    if (!name.startsWith('perf.key.') && name !== 'AnimationFrame' && name !== 'AnimationFrame::Presentation') continue
    const frameId = isRecord(args) && typeof args.id === 'string' ? args.id : undefined
    events.push({ name, ph, pid, tid, ts, ...(frameId === undefined ? {} : { frameId }) })
  }
  events.sort((a, b) => a.ts - b.ts)
  const active = new Map<string, InputTraceEvent>()
  const frames: Array<{ start: InputTraceEvent; end: number }> = []
  const feedback = new Map<string, number>()
  const inputs = new Map<string, InputTraceEvent>()
  const marks: InputTraceEvent[] = []
  for (const event of events) {
    const thread = `${event.pid}:${event.tid}`
    if (event.name === 'AnimationFrame' && event.ph === 'b') active.set(thread, event)
    if (event.name === 'AnimationFrame' && event.ph === 'e') {
      const start = active.get(thread)
      if (start !== undefined) frames.push({ start, end: event.ts })
      active.delete(thread)
    }
    if (event.name === 'AnimationFrame::Presentation' && event.frameId !== undefined) feedback.set(`${event.pid}:${event.frameId}`, event.ts)
    if (event.name.startsWith('perf.key.input.')) inputs.set(event.name.slice('perf.key.input.'.length), event)
    if (event.name.startsWith('perf.key.frame.')) marks.push(event)
  }
  return marks.map((mark) => {
    const input = inputs.get(mark.name.slice('perf.key.frame.'.length))
    const frame = frames.find(({ start, end }) => start.pid === mark.pid && start.tid === mark.tid && start.ts <= mark.ts && mark.ts <= end)
    const end = frame === undefined ? undefined : feedback.get(`${frame.start.pid}:${frame.start.frameId}`)
    if (input === undefined || end === undefined || end < mark.ts) throw new Error(`Missing presentation for ${mark.name}`)
    return (end - input.ts) / 1000
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
