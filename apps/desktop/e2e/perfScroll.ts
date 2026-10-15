import { loadavg } from 'node:os'
import { contention } from './perfStats'
import { Worker } from 'node:worker_threads'
import type { Page } from '@playwright/test'
import { expect } from './fixtures'
import { traced, type FrameWork } from './perfTrace'

/** Diagnostic only: keep two cores busy without changing the renderer's workload. */
async function holdClock(): Promise<() => Promise<void>> {
  const workers = Array.from({ length: 2 }, () => new Worker(`
    const { parentPort } = require('node:worker_threads')
    parentPort.postMessage('ready')
    for (;;) Math.sqrt(Math.random())
  `, { eval: true }))
  try {
    await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve())
      worker.once('error', reject)
    })))
  } catch (error) {
    await Promise.all(workers.map((worker) => worker.terminate()))
    throw error
  }
  return async () => { await Promise.all(workers.map((worker) => worker.terminate())) }
}

const percentile = (values: ReadonlyArray<number>, q: number): number => values.toSorted((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? 0

/** Two ordinary sweeps are the gate. The same two sweeps held-clock are diagnostic. */
export async function scrollReading(win: Page, name: string, options: {
  readonly steps: number
  readonly direction: 1 | -1
  readonly interval: number
  readonly layoutLimit: number
  readonly placeholders?: boolean
}): Promise<void> {
  const sweep = async (label: string) => {
    let result = { frames: [] as number[], loaf: 0, placeholders: 0 }
    const trace = await traced(win, `${name}-${label}`, async () => {
      await win.evaluate((checkPlaceholders) => {
        const state = { frames: [] as number[], loaf: 0, placeholders: 0, sampling: true }
        const observer = new PerformanceObserver((entries) => { state.loaf += entries.getEntries().length })
        observer.observe({ type: 'long-animation-frame' })
        let last: number | undefined
        const grid = checkPlaceholders ? document.querySelector('[data-all-topics-table]') : null
        const tick = (now: number) => {
          if (!state.sampling) return
          if (last !== undefined) state.frames.push(now - last)
          last = now
          if (grid !== null) {
            const rows = grid.querySelectorAll('[aria-busy="true"]')
            if (rows.length > 0) {
              const view = grid.getBoundingClientRect()
              for (const row of rows) {
                const rect = row.getBoundingClientRect()
                if (rect.bottom > view.top && rect.top < view.bottom) state.placeholders++
              }
            }
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        Object.assign(window, { __scrollSample: () => {
          state.sampling = false
          state.loaf += observer.takeRecords().length
          observer.disconnect()
          return { frames: state.frames, loaf: state.loaf, placeholders: state.placeholders }
        } })
      }, options.placeholders ?? false)
      for (const direction of [options.direction, -options.direction]) {
        for (let step = 0; step < options.steps; step++) {
          await win.mouse.wheel(0, direction * 200)
          await win.waitForTimeout(100)
        }
      }
      result = await win.evaluate(() => (window as unknown as { __scrollSample: () => typeof result }).__scrollSample())
    })
    return { ...trace, ...result }
  }
  type Sweep = Awaited<ReturnType<typeof sweep>>
  const ordinary: Sweep[] = []
  const held: Sweep[] = []
  for (let pass = 0; pass < 2; pass++) {
    await win.waitForTimeout(3_000)
    ordinary.push(await sweep(`ordinary-${pass + 1}`))
    const stop = await holdClock()
    try {
      await win.waitForTimeout(500)
      held.push(await sweep(`held-${pass + 1}`))
    } finally {
      await stop()
    }
  }
  const work = ordinary.flatMap((s) => s.work)
  const heldWork = held.flatMap((s) => s.work)
  const frames = ordinary.flatMap((s) => s.frames)
  const dropped = frames.filter((f) => f > options.interval * 1.5).length
  const heavy = (runs: ReadonlyArray<FrameWork>) => runs.flatMap((s) => s.work.flatMap((ms, i) => ms > 8.3 ? [{ layout: s.layouts[i]!, styled: s.styled[i]! }] : []))
  const heavyFrames = heavy(ordinary)
  const layout = heavyFrames.map((f) => f.layout)
  const allLayouts = ordinary.flatMap((s) => s.layouts)
  console.log(`${name}: pooled p95 ${percentile(work, 0.95).toFixed(1)} ms, held-clock p95 ${percentile(heldWork, 0.95).toFixed(1)} ms, n=${work.length}/${heldWork.length}, load ${loadavg()[0]!.toFixed(1)}${contention()}, dropped ${dropped}/${frames.length}, LoAF ${ordinary.reduce((n, s) => n + s.loaf, 0)}`)
  console.log(`${name}: ${heavyFrames.length} heavy frames, dirty layout objects p95/max ${percentile(layout, 0.95)}/${Math.max(0, ...layout)}, all-frame layout max ${Math.max(0, ...allLayouts)}, styled elements p95/max ${percentile(heavyFrames.map((f) => f.styled), 0.95)}/${Math.max(0, ...heavyFrames.map((f) => f.styled))}`)
  expect(work.length, 'trace must contain measured frames').toBeGreaterThan(100)
  expect(heldWork.length, 'held-clock trace must contain measured frames').toBeGreaterThan(100)
  expect.soft(Math.max(0, ...allLayouts), `${name}: dirty layout objects per frame`).toBeLessThanOrEqual(options.layoutLimit)
  expect.soft(ordinary.reduce((n, s) => n + s.placeholders, 0), 'visible placeholders').toBe(0)
  expect.soft(ordinary.reduce((n, s) => n + s.loaf, 0), 'long animation frames').toBe(0)
  expect.soft(dropped / frames.length, 'dropped frames').toBeLessThan(0.01)
  expect.soft(percentile(work, 0.95), `${name}: pooled frame work p95, budget 8.3 ms`).toBeLessThanOrEqual(8.3)
}
