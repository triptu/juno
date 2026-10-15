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

/** Samples screen coordinates on every frame, including shifts hidden by Chromium's recent-input grace period. */
export async function expectStableAnchor(page: Page, selector: string, action: () => Promise<unknown>): Promise<void> {
  await waitForLayoutReady(page)
  await page.evaluate((target) => {
    if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) throw new Error('layout-shift observer unavailable')
    const shifts: Array<{ value: number; sources: string[] }> = []
    const collect = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        if ('hadRecentInput' in entry && entry.hadRecentInput === false && 'value' in entry && typeof entry.value === 'number') {
          const shift = entry as PerformanceEntry & { sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }
          shifts.push({ value: entry.value, sources: (shift.sources ?? []).map(({ node, previousRect, currentRect }) => `${node instanceof Element ? node.outerHTML.slice(0, 240) : node?.parentElement?.outerHTML.slice(0, 240)}: ${previousRect.x},${previousRect.y} → ${currentRect.x},${currentRect.y}`) })
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
        const { x, y } = anchor.getBoundingClientRect()
        samples.push({ x, y })
      }
    }
    const tick = () => {
      sample()
      frame = requestAnimationFrame(tick)
    }
    window.junoShiftProbe = { shifts, observer, drain: () => collect(observer.takeRecords()), samples, sample, stop: () => cancelAnimationFrame(frame) }
    tick()
  }, selector)
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
