import { loadavg } from 'node:os'
import type { Locator, Page } from '@playwright/test'
import { contention } from './perfStats'
import { frameWork, recordTrace } from './perfTrace'

const percentile = (values: ReadonlyArray<number>, q: number): number => values.toSorted((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? 0

export interface DragReading {
  /** Main-thread work per frame, ms. */
  readonly work: ReadonlyArray<number>
  readonly p95: number
  readonly loaf: number
  /** Frames longer than one and a half refresh intervals, as a share of all frames. */
  readonly dropped: number
  /** The page's `selectionchange` listeners: how many events, their time in all and the longest, ms. */
  readonly handlers: { readonly count: number; readonly total: number; readonly longest: number }
  /** The page's `pointermove` listeners, where the message rows place their hover toolbar: their time in all and the longest, ms. */
  readonly pointerMoves: { readonly count: number; readonly total: number; readonly longest: number }
  /** The page's animation frame callbacks, where work a listener puts off to the next frame runs: their time in all and the longest, ms. */
  readonly frameCallbacks: { readonly total: number; readonly longest: number }
}

type Event = { readonly name: string; readonly ph: string; readonly dur?: number; readonly args?: { readonly data?: { readonly type?: string } } }

/** The `selectionchange` events the trace dispatched, with the time their listeners took, and the time in animation frame callbacks. */
function listenerTime(json: string): Pick<DragReading, 'handlers' | 'pointerMoves' | 'frameCallbacks'> {
  const events = (JSON.parse(json) as { readonly traceEvents: ReadonlyArray<Event> }).traceEvents
  const ms = (list: ReadonlyArray<Event>) => list.map((e) => (e.dur ?? 0) / 1000)
  const dispatched = (type: string) => ms(events.filter((e) => e.name === 'EventDispatch' && e.ph === 'X' && e.args?.data?.type === type))
  const times = dispatched('selectionchange')
  const moves = dispatched('pointermove')
  const frames = ms(events.filter((e) => e.name === 'FireAnimationFrame' && e.ph === 'X'))
  return {
    handlers: { count: times.length, total: times.reduce((a, b) => a + b, 0), longest: Math.max(0, ...times) },
    pointerMoves: { count: moves.length, total: moves.reduce((a, b) => a + b, 0), longest: Math.max(0, ...moves) },
    frameCallbacks: { total: frames.reduce((a, b) => a + b, 0), longest: Math.max(0, ...frames) },
  }
}

/**
 * Drags a text selection down a topic's message list, as the owner
 * highlights a long stretch of a thread: mouse down in the text of the first
 * row on screen, one move a frame down to the list's bottom edge, then past
 * it, where the list scrolls under the selection, and mouse up. Answers with
 * the main thread's work per frame over the drag, from a trace, and the long
 * animation frames.
 */
export async function selectionDragReading(win: Page, scroller: Locator, name: string, interval: number): Promise<DragReading> {
  const box = (await scroller.boundingBox())!
  // Rows above the view settle from their size estimates after a jump; start once the text under the pointer holds still.
  const start = await scroller.evaluate(async (list) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const pick = () => {
      const view = list.getBoundingClientRect()
      for (const text of list.querySelectorAll<HTMLElement>('[data-msg-text]')) {
        const rect = text.getBoundingClientRect()
        if (rect.top > view.top + 80 && rect.bottom < view.bottom) return { text, x: rect.left + 4, y: rect.top + Math.min(8, rect.height / 2) }
      }
      throw new Error('no message text on screen')
    }
    let at = pick()
    for (let tries = 0; tries < 60; tries++) {
      await frame()
      await frame()
      const again = pick()
      if (again.text === at.text && again.y === at.y && document.elementFromPoint(again.x, again.y)?.closest('[data-msg-text]') === again.text) return { x: again.x, y: again.y }
      at = again
    }
    throw new Error('the message text under the pointer did not hold still')
  })
  let sample = { frames: [] as number[], loaf: 0 }
  const json = await recordTrace(win, name, async () => {
    await win.evaluate(() => {
      const state = { frames: [] as number[], loaf: 0, sampling: true }
      const observer = new PerformanceObserver((entries) => (state.loaf += entries.getEntries().length))
      observer.observe({ type: 'long-animation-frame' })
      let last: number | undefined
      const tick = (now: number) => {
        if (!state.sampling) return
        if (last !== undefined) state.frames.push(now - last)
        last = now
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      Object.assign(window, { __dragSample: () => {
        state.sampling = false
        state.loaf += observer.takeRecords().length
        observer.disconnect()
        return { frames: state.frames, loaf: state.loaf }
      } })
    })
    await win.mouse.move(start.x, start.y)
    await win.mouse.down()
    const inside = box.y + box.height - 4
    for (let step = 1; step <= 60; step++) {
      await win.mouse.move(start.x + 200 * (step / 60), start.y + (inside - start.y) * (step / 60))
      await win.waitForTimeout(interval)
    }
    // Past the bottom edge: Chromium scrolls the list under the selection while the button is held.
    for (let step = 0; step < 60; step++) {
      await win.mouse.move(start.x + 200 + (step % 2), box.y + box.height + 12)
      await win.waitForTimeout(interval)
    }
    await win.mouse.up()
    await win.waitForTimeout(200)
    sample = await win.evaluate(() => (window as unknown as { __dragSample: () => { frames: number[]; loaf: number } }).__dragSample())
  })
  const trace = frameWork(json)
  const { handlers, pointerMoves, frameCallbacks } = listenerTime(json)
  const dropped = sample.frames.filter((f) => f > interval * 1.5).length / Math.max(1, sample.frames.length)
  const reading = { work: trace.work, p95: percentile(trace.work, 0.95), loaf: sample.loaf, dropped, handlers, pointerMoves, frameCallbacks }
  console.log(`${name}: frame work p95 ${reading.p95.toFixed(1)} ms, median ${percentile(trace.work, 0.5).toFixed(1)} ms, max ${Math.max(0, ...trace.work).toFixed(1)} ms, ${trace.work.reduce((a, b) => a + b, 0).toFixed(0)} ms in all, n=${trace.work.length}, load ${loadavg()[0]!.toFixed(1)}${contention()}, dropped ${(dropped * 100).toFixed(1)} %, LoAF ${sample.loaf}; selectionchange: ${handlers.count} events, ${handlers.total.toFixed(1)} ms in all, longest ${handlers.longest.toFixed(2)} ms; pointermove: ${pointerMoves.count} events, ${pointerMoves.total.toFixed(1)} ms in all, longest ${pointerMoves.longest.toFixed(2)} ms; frame callbacks ${frameCallbacks.total.toFixed(1)} ms in all, longest ${frameCallbacks.longest.toFixed(2)} ms`)
  return reading
}
