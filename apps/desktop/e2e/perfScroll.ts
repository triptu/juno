import { loadavg } from 'node:os'
import { absolute, budget } from './perfBaseline'
import { contention, holdClock } from './perfStats'
import type { Page } from '@playwright/test'
import { expect } from './fixtures'
import { traced, type FrameWork } from './perfTrace'

const percentile = (values: ReadonlyArray<number>, q: number): number => values.toSorted((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? 0

/**
 * The continuous sweep's speed: a brisk trackpad scroll, one gesture with a
 * delta every frame (about 17 px a frame at 120 Hz, 33 px at 60 Hz).
 */
const GESTURE_SPEED = 2_000

/**
 * Gates three readings of the list scrolled the same distance, down and back
 * (performance.md 7.3). The ordinary 8.3 ms gate is on two continuous
 * sweeps: one scroll gesture with a delta every frame, as a trackpad sends.
 * Two stepped sweeps (200 px wheel steps 100 ms apart, each its own gesture)
 * are reported beside it, and their held-clock repeats keep the 7 ms gate.
 * The continuous and stepped sweeps must show no placeholder, no long
 * animation frame and under 1 % dropped frames.
 *
 * On the laptop (not `absolute`) only one continuous sweep runs, its frame
 * work p95 checked against the baseline: the stepped sweep is reported, not
 * gated, and the held clock answers Apple silicon's power management.
 */
export async function scrollReading(win: Page, name: string, options: {
  readonly steps: number
  readonly direction: 1 | -1
  readonly interval: number
  readonly layoutLimit: number
  readonly placeholders?: boolean
  /** Where the pointer rests over the list; the continuous gesture starts there. */
  readonly at: { readonly x: number; readonly y: number }
}): Promise<void> {
  const { at } = options
  const sweep = async (label: string, mode: 'steps' | 'gesture' = 'steps') => {
    let result = { frames: [] as number[], loaf: 0, placeholders: 0, longFrames: [] as unknown[] }
    const trace = await traced(win, `${name}-${label}`, async () => {
      await win.evaluate((checkPlaceholders) => {
        const state = { frames: [] as number[], loaf: 0, placeholders: 0, sampling: true, longFrames: [] as unknown[] }
        const record = (entries: PerformanceEntry[]) => {
          state.loaf += entries.length
          state.longFrames.push(...entries.map((entry) => entry.toJSON()))
        }
        const observer = new PerformanceObserver((entries) => record(entries.getEntries()))
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
          record(observer.takeRecords())
          observer.disconnect()
          return { frames: state.frames, loaf: state.loaf, placeholders: state.placeholders, longFrames: state.longFrames }
        } })
      }, options.placeholders ?? false)
      for (const direction of [options.direction, -options.direction]) {
        if (mode === 'gesture') {
          const cdp = await win.context().newCDPSession(win)
          try {
            // yDistance is positive to scroll up. Mouse source: precise wheel deltas every frame in one gesture.
            await cdp.send('Input.synthesizeScrollGesture', { x: at.x, y: at.y, yDistance: -direction * options.steps * 200, speed: GESTURE_SPEED, gestureSourceType: 'mouse', preventFling: true })
          } finally {
            await cdp.detach()
          }
          await win.waitForTimeout(100)
          continue
        }
        for (let step = 0; step < options.steps; step++) {
          await win.mouse.wheel(0, direction * 200)
          await win.waitForTimeout(100)
        }
      }
      result = await win.evaluate(() => (window as unknown as { __scrollSample: () => typeof result }).__scrollSample())
    })
    if (result.longFrames.length > 0) console.log(`${name}-${label}: long animation frames ${JSON.stringify(result.longFrames)}`)
    return { ...trace, ...result }
  }
  type Sweep = Awaited<ReturnType<typeof sweep>>
  const ordinary: Sweep[] = []
  const gesture: Sweep[] = []
  const held: Sweep[] = []
  for (let pass = 0; pass < (absolute ? 2 : 1); pass++) {
    if (absolute) {
      await win.waitForTimeout(3_000)
      ordinary.push(await sweep(`ordinary-${pass + 1}`))
    }
    await win.waitForTimeout(absolute ? 3_000 : 1_000)
    gesture.push(await sweep(`gesture-${pass + 1}`, 'gesture'))
    if (!absolute) continue
    const stop = await holdClock()
    try {
      await win.waitForTimeout(500)
      held.push(await sweep(`held-${pass + 1}`))
    } finally {
      await stop()
    }
  }
  const p95 = (runs: ReadonlyArray<Sweep>) => percentile(runs.flatMap((s) => s.work), 0.95)
  const unheld = [...ordinary, ...gesture]
  const frames = (runs: ReadonlyArray<Sweep>) => runs.flatMap((s) => s.frames)
  const dropped = (runs: ReadonlyArray<Sweep>) => frames(runs).filter((f) => f > options.interval * 1.5).length / Math.max(1, frames(runs).length)
  const loaf = (runs: ReadonlyArray<Sweep>) => runs.reduce((n, s) => n + s.loaf, 0)
  const heavy = (runs: ReadonlyArray<FrameWork>) => runs.flatMap((s) => s.work.flatMap((ms, i) => ms > 8.3 ? [{ layout: s.layouts[i]!, styled: s.styled[i]! }] : []))
  const heavyFrames = heavy(gesture)
  const layout = heavyFrames.map((f) => f.layout)
  const allLayouts = unheld.flatMap((s) => s.layouts)
  console.log(`${name}: continuous p95 ${p95(gesture).toFixed(1)} ms (gated), stepped p95 ${p95(ordinary).toFixed(1)} ms, held-clock stepped p95 ${p95(held).toFixed(1)} ms, n=${gesture.flatMap((s) => s.work).length}/${ordinary.flatMap((s) => s.work).length}/${held.flatMap((s) => s.work).length}, load ${loadavg()[0]!.toFixed(1)}${contention()}, dropped ${(dropped(gesture) * 100).toFixed(1)}/${(dropped(ordinary) * 100).toFixed(1)} %, LoAF ${loaf(gesture)}/${loaf(ordinary)}`)
  console.log(`${name}: continuous ${heavyFrames.length} heavy frames, dirty layout objects p95/max ${percentile(layout, 0.95)}/${Math.max(0, ...layout)}, all-frame layout max ${Math.max(0, ...allLayouts)}, styled elements p95/max ${percentile(heavyFrames.map((f) => f.styled), 0.95)}/${Math.max(0, ...heavyFrames.map((f) => f.styled))}`)
  for (const [label, runs] of [['continuous', gesture], ['stepped', ordinary], ['held-clock', held]] as const) {
    if (runs.length > 0) expect(runs.flatMap((s) => s.work).length, `${label} trace must contain measured frames`).toBeGreaterThan(absolute ? 100 : 50)
  }
  expect.soft(Math.max(0, ...allLayouts), `${name}: dirty layout objects per frame`).toBeLessThanOrEqual(options.layoutLimit)
  expect.soft(unheld.reduce((n, s) => n + s.placeholders, 0), 'visible placeholders').toBe(0)
  expect.soft(loaf(unheld), 'long animation frames').toBe(0)
  expect.soft(dropped(gesture), 'dropped frames, continuous').toBeLessThan(0.01)
  if (absolute) {
    expect.soft(dropped(ordinary), 'dropped frames, stepped').toBeLessThan(0.01)
    expect.soft(p95(held), `${name}: held-clock frame work p95, budget 7 ms`).toBeLessThanOrEqual(7)
  }
  const work = gesture.flatMap((s) => s.work)
  budget({ name: `${name}: continuous scroll frame work`, median: percentile(work, 0.5), p95: p95(gesture), n: work.length, unit: 'ms' }, 8.3, { compare: 'p95', floor: 1 })
}
