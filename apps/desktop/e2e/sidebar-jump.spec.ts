// A jump of more than a screen in the sidebar draws the rows it lands on in the
// frame it paints, never a row's fill without its text (performance.md 3.2).
// End and Home on a focused row jump; a scrollbar thumb dragged to an end does the same.
import { expect, test } from './fixtures'

test.use({ synced: true, syncedSeed: 'conversations300' })

interface Jumps {
  readonly blank: string[]
  longest: number
  at: number
}

test('End and Home in the sidebar draw every row they land on in the frame they paint', async ({ juno, win }) => {
  await juno.sidebar.expectRows()
  const list = juno.sidebar.list
  // A scroll event runs before the frame that shows the scroll is drawn, so it sees which rows that frame skips.
  await list.evaluate((scroller) => {
    const jumps: Jumps = { blank: [], longest: 0, at: scroller.scrollTop }
    Object.assign(globalThis, { __jumps: jumps })
    scroller.addEventListener('scroll', () => {
      jumps.longest = Math.max(jumps.longest, Math.abs(scroller.scrollTop - jumps.at) / scroller.clientHeight)
      jumps.at = scroller.scrollTop
      const view = scroller.getBoundingClientRect()
      for (const row of scroller.querySelectorAll<HTMLElement>('[data-topic-row]')) {
        const box = row.getBoundingClientRect()
        if (box.bottom <= view.top || box.top >= view.bottom) continue
        if (row.firstElementChild?.checkVisibility({ contentVisibilityAuto: true }) === false) jumps.blank.push(row.dataset['topicId'] ?? '')
      }
    })
  })
  const jumps = () => win.evaluate(() => (globalThis as unknown as { __jumps: Jumps }).__jumps)

  await juno.sidebar.rows.first().focus()
  await win.keyboard.press('End')
  await expect.poll(async () => (await jumps()).at).toBeGreaterThan(0)
  await win.keyboard.press('Home')
  // The scroll event that saw the jump back has run once the listener has recorded the top.
  await expect.poll(async () => (await jumps()).at).toBe(0)

  const { blank, longest } = await jumps()
  expect(longest, 'a jump of more than two screens, past what Chromium draws ahead').toBeGreaterThan(2)
  expect(blank, 'rows in view drawn without their contents').toEqual([])
})
