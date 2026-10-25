// The sidebar in the browser: rows that scroll under a still pointer are not
// warmed, and zooming keeps the sidebar in the window. What it shows after
// sign-in, live updates, the filters, the keyboard and the Unread hold are in
// the DOM lane (`dom/sidebar.test.ts`).
import { expect, syncedTest, test } from './fixtures'

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

test.describe.configure({ timeout: 60_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'

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

// Zoom is main's: the View menu's items and the window's minimum size.
syncedTest('zooming in from the View menu keeps the whole sidebar inside the window', { tag: '@electron' }, async ({ juno, app, win }) => {
  await juno.sidebar.row(POSTGRES).expectVisible()

  // The smallest window, then View > Zoom In eight times (about 200%).
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(720, 480)
    const zoomIn = Menu.getApplicationMenu()!.getMenuItemById('zoom-in')!
    for (let step = 0; step < 8; step++) zoomIn.click(undefined, window)
  })
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBeGreaterThan(1.9)
  const right = (selector: string) => win.evaluate((query) => ({ right: document.querySelector(query)!.getBoundingClientRect().right, width: window.innerWidth }), selector)
  await expect.poll(async () => { const { right: edge, width } = await right('aside'); return edge <= width }).toBe(true)
  const account = await right('aside [aria-label="Account and settings"]')
  expect(account.right).toBeLessThanOrEqual(account.width)

  // The account menu ends inside the window; what does not fit scrolls inside it.
  await win.evaluate(() => document.querySelector<HTMLElement>('aside [aria-label="Account and settings"]')!.click())
  const menu = () => win.evaluate(() => ({ bottom: document.querySelector('[role="dialog"][aria-label="Account"]')?.getBoundingClientRect().bottom ?? Infinity, height: window.innerHeight }))
  await expect.poll(async () => { const { bottom, height } = await menu(); return bottom <= height }).toBe(true)
  await win.keyboard.press('Escape')

  // Actual Size brings the 720 × 480 minimum back.
  await app.evaluate(({ BrowserWindow, Menu }) => Menu.getApplicationMenu()!.getMenuItemById('zoom-reset')!.click(undefined, BrowserWindow.getAllWindows()[0]!))
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())).toEqual([720, 480])
})

