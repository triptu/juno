import { expect, test } from '@playwright/test'
import { openState, type Route } from './support'

const route = { component: 'JunoChatList', id: 'hostile/long-chat', route: 'JunoChatList/hostile/long-chat', group: 'Hostile', groupId: 'hostile', state: 'long-chat', frame: {} } satisfies Route

test.describe('Juno chat geometry', () => {
  test('a long chat scrolled up from the bottom keeps the bubbles of one answer 2px apart in every frame', async ({ page }) => {
    await openState(page, route)
    const scroller = page.locator('[data-fixture-frame] [data-scroll]')
    const box = (await scroller.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    // Every frame, just before paint, the gaps between bubbles of one run in view. Rows out of view are not read
    // inside, so the browser keeps skipping them as it would.
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-fixture-frame] [data-scroll]')!
      const off: string[] = []
      let pairs = 0
      const sample = () => {
        const view = scroller.getBoundingClientRect()
        let above: { run: string; bottom: number } | undefined
        for (const row of scroller.querySelectorAll<HTMLElement>('[data-chat-juno], [data-chat-owner]')) {
          const r = row.getBoundingClientRect()
          if (r.bottom <= view.top || r.top >= view.bottom) continue
          const bubble = row.querySelector<HTMLElement>('[data-chat-run]')
          if (bubble === null) {
            above = undefined
            continue
          }
          const b = bubble.getBoundingClientRect()
          const run = bubble.dataset['chatRun']!
          if (above?.run === run) {
            pairs++
            const gap = b.top - above.bottom
            if (Math.abs(gap - 2) > 0.5) off.push(`${row.dataset['chatJuno']}: ${gap.toFixed(1)}px`)
          }
          above = { run, bottom: b.bottom }
        }
      }
      const tick = () => {
        const observer = new ResizeObserver(() => {
          observer.disconnect()
          sample()
          requestAnimationFrame(tick)
        })
        observer.observe(scroller)
      }
      requestAnimationFrame(tick)
      ;(window as unknown as { gaps: () => { off: string[]; pairs: number } }).gaps = () => ({ off, pairs })
      scroller.scrollTop = scroller.scrollHeight
    })
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, -300)
      await page.waitForTimeout(30)
    }
    const { off, pairs } = await page.evaluate(() => (window as unknown as { gaps: () => { off: string[]; pairs: number } }).gaps())
    expect(pairs).toBeGreaterThan(100)
    expect(off).toEqual([])
  })
})
