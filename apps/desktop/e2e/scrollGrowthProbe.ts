import { expect, type Locator, type Page } from '@playwright/test'

/** Repeated late DOM layout, without a message-data commit, during the start of a real upward gesture. */
export async function expectScrollEscapesGrowth(win: Page, scroller: Locator, row: Locator): Promise<void> {
  const box = (await scroller.boundingBox())!
  const start = await scroller.evaluate((node) => node.scrollTop)
  const distance = Math.min(900, start)
  expect(distance).toBeGreaterThan(100)
  const cdp = await win.context().newCDPSession(win)
  try {
    const growing = row.evaluate((row) => new Promise<void>((resolve) => {
      let frame = 0
      const grow = () => {
        row.style.paddingBottom = `${++frame * 12}px`
        if (frame < 45) requestAnimationFrame(grow)
        else resolve()
      }
      requestAnimationFrame(grow)
    }))
    await Promise.all([
      growing,
      cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, yDistance: distance, speed: 900, gestureSourceType: 'mouse', preventFling: false }),
    ])
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(start - distance * 2 / 3)
  } finally {
    await cdp.detach()
  }
}

/** A coalesced programmatic/user scrollend, followed by growth before the deferred rest check. */
export async function expectRestSurvivesGrowth(scroller: Locator, rowSelector: string): Promise<void> {
  for (const gap of [0, 16]) {
    const result = await scroller.evaluate(async (node, { rowSelector, gap }) => {
      const row = [...node.querySelectorAll<HTMLElement>(rowSelector)].at(-1)!
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      node.scrollTop = node.scrollHeight
      node.dispatchEvent(new Event('scrollend'))
      await frame()
      await new Promise<void>((resolve) => {
        let changed = false
        const observer = new ResizeObserver(() => {
          if (!changed) {
            changed = true
            row.style.paddingBottom = '12px'
            return
          }
          observer.disconnect()
          // The list's resize observer has scrolled, but its scrollend has not been delivered yet.
          node.scrollTop -= 16
          node.dispatchEvent(new Event('scroll'))
          if (gap === 0) node.scrollTop = node.scrollHeight
          node.dispatchEvent(new Event('scrollend'))
          row.style.paddingBottom = '160px'
          resolve()
        })
        observer.observe(row, { box: 'border-box' })
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight
      row.style.paddingBottom = ''
      return distance
    }, { rowSelector, gap })
    expect(result, `resting ${gap}px from the end survives growth during the rest check`).toBeLessThanOrEqual(1)
  }
}
