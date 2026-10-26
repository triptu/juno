// The sidebar in the browser: rows that scroll under a still pointer are not
// warmed. Zooming, which keeps the sidebar in the window, is main's
// (`break-pass.spec.ts`). What it shows after
// sign-in, live updates, the filters, the keyboard and the Unread hold are in
// the DOM lane (`dom/sidebar.test.ts`).
import { expect, syncedTest, test } from './fixtures'

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

test.describe.configure({ timeout: 60_000 })

syncedTest('rows that scroll under a still pointer are not warmed; moving onto a row warms it', async ({ juno, win }) => {
  const { sidebar } = juno
  const list = sidebar.list
  await sidebar.hoverList()
  const before = await juno.lastMark('juno.prefetch')

  type Watched = HTMLElement & { scrollEnded?: Promise<void> }
  /** Turns the wheel over the list and waits for its scroll to end. The listener is in place before the wheel turns. */
  const wheel = async () => {
    const room = await list.evaluate((node: Watched) => {
      node.scrollEnded = new Promise((resolve) => node.addEventListener('scrollend', () => resolve(), { once: true }))
      return node.scrollHeight - node.clientHeight - node.scrollTop
    })
    await win.mouse.wheel(0, 300)
    // At the end of the list the wheel scrolls nothing, and no scrollend comes.
    if (room >= 1) await list.evaluate((node: Watched) => node.scrollEnded)
  }
  await wheel()
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await wheel()
  // The hover moves to the row now under the pointer on a frame after the scroll.
  await win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await juno.lastMark('juno.prefetch')).toBe(before)

  // A real move onto another row warms it, as before.
  const box = (await list.boundingBox())!
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
  await expect.poll(() => juno.lastMark('juno.prefetch')).not.toBe(before)
})

