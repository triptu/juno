// Break pass, the parts that need main: a launch.json that is malformed or
// names a display that is gone, and the window: swipes, minimize and zoom.
// Interrupted and odd input in a topic is in the DOM lane (`dom/break-pass.test.ts`).
import type { ElectronApplication, Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, launchApp, syncedTest, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

test('a malformed launch.json still opens a usable window, and a window saved on a display that is gone opens on screen', { tag: '@electron' }, async ({ running, userData }) => {
  await running.close()
  await writeFile(join(userData, 'launch.json'), '{"theme":')
  const again = await launchApp(userData)
  try {
    await expect(again.win.getByRole('button', { name: "Use the Slack app's session" })).toBeVisible()
    await again.win.getByRole('radio', { name: 'Dark' }).click()
    await expect(again.win.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  } finally {
    await again.close()
  }
  // Its saved window is on a display that is gone.
  await writeFile(join(userData, 'launch.json'), JSON.stringify({ theme: 'light', bounds: { x: -6000, y: -6000, width: 1100, height: 760 } }))
  const moved = await launchApp(userData)
  try {
    const placed = await moved.app.evaluate(({ BrowserWindow, screen }) => {
      const bounds = BrowserWindow.getAllWindows()[0]!.getBounds()
      const { workArea } = screen.getPrimaryDisplay()
      return { bounds, inside: bounds.x >= workArea.x && bounds.y >= workArea.y && bounds.x + bounds.width <= workArea.x + workArea.width && bounds.y + bounds.height <= workArea.y + workArea.height }
    })
    expect(placed.inside).toBe(true)
    expect(placed.bounds.width).toBe(1100)
    expect(placed.bounds.height).toBe(760)
  } finally {
    await moved.close()
  }
})

// A deactivated sender and a live rename of them: the engine's live-events flow test.

// What main does to the window, in one launch: swipes, minimize, and zoom last, since it leaves the window at its minimum size.
syncedTest('window swipes move back and forward, repeated minimize and restore keeps the draft, and zooming in keeps the whole sidebar inside the window', { tag: '@electron' }, async ({ juno, app, win }) => {
  await test.step('window swipe events move back and forward', () => swipes(juno))
  await test.step('repeated window minimize and restore keeps the draft', async () => {
    await juno.sidebar.row('#eng').open()
    await juno.topic.composer.fill('Draft through window changes')
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      for (let i = 0; i < 5; i++) {
        window.minimize()
        window.restore()
      }
      window.show()
      window.focus()
    })
    await expect(juno.topic.composer).toHaveValue('Draft through window changes')
    await juno.topic.composer.press('Enter')
    await juno.topic.expectSent('Draft through window changes')
  })
  await test.step('zooming in from the View menu keeps the whole sidebar inside the window', () => zoom(juno, app, win))
})

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'

async function swipes(juno: Juno): Promise<void> {
  await juno.sidebar.row(RINA).open()
  await juno.sidebar.row(ROADMAP).open()
  await juno.nav.swipe('left')
  await juno.topic.expectTitle(RINA)
  await juno.nav.swipe('right')
  await juno.topic.expectTitle(ROADMAP)
}

// Zoom is main's: the View menu's items and the window's minimum size.
async function zoom(juno: Juno, app: ElectronApplication, win: Page): Promise<void> {
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
}
