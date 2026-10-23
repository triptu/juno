import { expect, type Page } from '@playwright/test'
import { waitForLayoutReady } from '@juno/testing/layout-shift'

interface AnchorProbe {
  readonly shifts: Array<{ value: number; sources: string[] }>
  readonly observer: PerformanceObserver
  readonly drain: () => void

  readonly samples: Array<{ x: number; y: number }>
  readonly sample: () => void
  stop: () => void
}

declare global {
  interface Window {
    junoShiftProbe?: AnchorProbe
  }
}

/**
 * Samples screen coordinates on every frame, including shifts hidden by Chromium's recent-input grace period.
 * `edge: 'bottom'` samples the anchor's bottom-left corner instead of its top-left: a row that grows while the list
 * holds its bottom (stick to bottom) keeps its bottom edge.
 * `outside` skips a shift whose every moved node is inside that element: for a region whose movement during the
 * action is intended and checked by its own test. `within` skips a shift whose every moved node is outside that
 * element: for a test about one region while another fills with content. A shift that also moves anything else still fails, but Chromium
 * names at most five nodes per shift, so the anchor's samples and the test's own boxes guard the region under test.
 * A shift counts only if a source outside that region has a different box before and after, as in the feel suite: Chromium
 * reports some text changes as a shift whose every box stays where it was.
 */
export async function expectStableAnchor(page: Page, selector: string, action: () => Promise<unknown>, options: { readonly edge?: 'top' | 'bottom'; readonly outside?: string; readonly within?: string } = {}): Promise<void> {
  await waitForLayoutReady(page)
  await page.evaluate(({ target, edge, outside, within }) => {
    if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) throw new Error('layout-shift observer unavailable')
    const shifts: Array<{ value: number; sources: string[] }> = []
    const collect = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        if ('hadRecentInput' in entry && entry.hadRecentInput === false && 'value' in entry && typeof entry.value === 'number') {
          const shift = entry as PerformanceEntry & { sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }
          const region = outside === undefined ? null : document.querySelector(outside)
          const scope = within === undefined ? null : document.querySelector(within)
          const sources = shift.sources ?? []
          const others = sources.filter(({ node }) => (region === null || node === null || !region.contains(node)) && (scope === null || node === null || scope.contains(node)))
          // Chromium reports a text that moves inside a box that stays (a right-aligned count going from 9 to 10) with only
          // that box as its source, the same before and after. Nothing on screen moved a box, so it does not count. An
          // entry without sources cannot be told apart from a real one, so it counts.
          const moved = ({ previousRect: a, currentRect: b }: { previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }) => a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height
          if (sources.length > 0 && !others.some(moved)) continue
          shifts.push({ value: entry.value, sources: (shift.sources ?? []).map(({ node, previousRect, currentRect }) => `${node instanceof Element ? node.outerHTML.slice(0, 240) : node?.parentElement?.outerHTML.slice(0, 240)}: ${JSON.stringify(previousRect)} → ${JSON.stringify(currentRect)}`) })
        }
      }
    }
    const observer = new PerformanceObserver((list) => collect(list.getEntries()))
    observer.observe({ type: 'layout-shift' })
    const samples: Array<{ x: number; y: number }> = []
    let frame = 0
    let anchor: Element | undefined
    const sample = () => {
      anchor ??= Array.from(document.querySelectorAll(target)).find((node) => node.getClientRects().length > 0 && node.getBoundingClientRect().bottom > 0 && node.getBoundingClientRect().top < innerHeight)
      if (anchor !== undefined) {
        if (!anchor.isConnected) throw new Error('The anchor was removed')
        const { x, y, bottom } = anchor.getBoundingClientRect()
        samples.push({ x, y: edge === 'bottom' ? bottom : y })
      }
    }
    const tick = () => {
      sample()
      frame = requestAnimationFrame(tick)
    }
    window.junoShiftProbe = { shifts, observer, drain: () => collect(observer.takeRecords()), samples, sample, stop: () => cancelAnimationFrame(frame) }
    tick()
  }, { target: selector, edge: options.edge ?? 'top', outside: options.outside, within: options.within })
  try {
    await action()
    await waitForLayoutReady(page)
    const { samples, shifts } = await page.evaluate(() => {
      window.junoShiftProbe?.sample()
      window.junoShiftProbe?.drain()
      return { samples: window.junoShiftProbe?.samples ?? [], shifts: window.junoShiftProbe?.shifts ?? [] }
    })
    expect(shifts).toEqual([])
    expect(samples.length, 'anchor must appear in multiple frames').toBeGreaterThan(1)
    expect(samples.filter((sample) => sample.x !== samples[0]?.x || sample.y !== samples[0]?.y), `anchor must move by exactly 0 px from ${JSON.stringify(samples[0])}`).toEqual([])
  } finally {
    await page.evaluate(() => {
      window.junoShiftProbe?.stop()
      window.junoShiftProbe?.observer.disconnect()
      delete window.junoShiftProbe
    })
  }
}

type Box = { x: number; y: number; width: number; height: number }

/**
 * Records the boxes of the visible elements matching `selector` on every frame, until the returned function stops it
 * and returns them, one list per frame. A frame is what the user saw, where one `boundingBox()` read can fall between
 * two steps of a change that no frame shows.
 */
export async function recordBoxes(page: Page, selector: string): Promise<() => Promise<Box[][]>> {
  const key = `junoBoxes${Math.random().toString(36).slice(2)}`
  await page.evaluate(({ selector, key }) => {
    const frames: Box[][] = []
    let frame = 0
    const tick = () => {
      frames.push([...document.querySelectorAll<HTMLElement>(selector)].filter((node) => node.checkVisibility()).map((node) => {
        const { x, y, width, height } = node.getBoundingClientRect()
        return { x, y, width, height }
      }))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    Object.assign(window, { [key]: { frames, stop: () => cancelAnimationFrame(frame) } })
  }, { selector, key })
  return () => page.evaluate((key) => {
    const probe = (window as unknown as Record<string, { frames: Box[][]; stop: () => void }>)[key]!
    probe.stop()
    delete (window as unknown as Record<string, unknown>)[key]
    return probe.frames
  }, key)
}
