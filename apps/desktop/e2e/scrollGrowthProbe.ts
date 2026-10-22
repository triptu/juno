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

