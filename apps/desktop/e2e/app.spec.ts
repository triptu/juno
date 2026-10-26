import type { ElectronApplication, Locator, Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import { expect, syncedTest, test } from './fixtures'
import type { Juno } from './driver/juno'
import { expectStableAnchor } from './shiftProbe'
import { longerThanView } from './stickBottomLists'

/** Resolves a CSS custom property to the colour Chromium computes for it. */
async function resolveColorVar(win: Page, name: string): Promise<string> {
  return win.evaluate((variable) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${variable})`
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, name)
}

function brightness(rgb: string): number {
  const [r = 0, g = 0, b = 0] = rgb.match(/\d+/g)?.map(Number) ?? []
  return (r + g + b) / 3
}

// Signed out, on the sign-in page. The theme switch goes after the fonts, so they see the light theme. The shift
// probe's own check replaces the page, so it goes last.
test('the signed-out shell uses bundled fonts, token colours and the chosen theme, and the shift probe sees a one-pixel move', async ({ win }) => {
  await test.step('renders the shell with bundled fonts and token colours', () => shellFontsAndColours(win))
  await test.step('switches to the dark theme in place', () => darkThemeInPlace(win))
  // Every layout check in this lane trusts the probe: one that missed a move would pass them all.
  await test.step('the shift probe rejects a one-pixel movement that returns before the action ends', async () => {
    await win.setContent('<div id="anchor">Anchor</div>')
    await expect(expectStableAnchor(win, '#anchor', async () => {
      await win.evaluate(async () => {
        const anchor = document.getElementById('anchor')!
        anchor.style.transform = 'translateY(1px)'
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        anchor.style.transform = ''
      })
    })).rejects.toThrow('anchor must move by exactly 0 px')
  })
})

async function shellFontsAndColours(win: Page): Promise<void> {
  await expect(win).toHaveTitle('Juno')

  const title = win.getByRole('heading', { name: "Hi, I'm Juno", level: 1, exact: true })
  await expect(title).toBeVisible()

  const button = win.getByRole('button', { name: "Use the Slack app's session" })
  await expect(button).toBeVisible()

  // Fonts come from @fontsource, not the system or the network.
  await win.evaluate(() => document.fonts.ready)
  await expect(title).toHaveCSS('font-family', /Instrument Serif/)
  await expect(button).toHaveCSS('font-family', /Figtree Variable/)
  const loaded = await win.evaluate(() => ({
    serif: document.fonts.check('24px "Instrument Serif"'),
    sans: document.fonts.check('16px "Figtree Variable"'),
  }))
  expect(loaded).toEqual({ serif: true, sans: true })

  // The page background is the --background token, and the button uses the
  // arrow cursor, never the pointer.
  const main = win.getByRole('main')
  await expect(main).toHaveCSS('background-color', await resolveColorVar(win, '--background'))
  await expect(button).toHaveCSS('cursor', 'default')
}

async function darkThemeInPlace(win: Page): Promise<void> {
  const main = win.getByRole('main')
  const lightBackground = await resolveColorVar(win, '--background')
  await expect(main).toHaveCSS('background-color', lightBackground)

  const dark = win.getByRole('radio', { name: 'Dark' })
  await expect(dark).toHaveAttribute('aria-checked', 'false')
  await dark.click()

  await expect(dark).toHaveAttribute('aria-checked', 'true')
  const darkBackground = await resolveColorVar(win, '--background')
  expect(darkBackground).not.toBe(lightBackground)
  expect(brightness(darkBackground)).toBeLessThan(brightness(lightBackground))
  await expect(main).toHaveCSS('background-color', darkBackground)

  await win.getByRole('radio', { name: 'Light' }).click()
  await expect(main).toHaveCSS('background-color', lightBackground)
}

/**
 * A surface that can open over a title bar must opt out of its drag region on
 * its own root, or a real Mac drags the window instead of delivering the
 * press (the avatar menu bug of 10-16). Playwright sends events to the page
 * directly, so this reads the region instead: the nearest absolute or fixed
 * box holding the surface must be no-drag, and nothing inside may drag.
 */
async function expectOptsOut(surface: Locator, name: string): Promise<void> {
  await expect(surface, name).toBeVisible()
  const found = await surface.evaluate((node) => {
    const region = (element: Element) => getComputedStyle(element).getPropertyValue('-webkit-app-region')
    let root: Element | null = node
    while (root !== null && !['absolute', 'fixed'].includes(getComputedStyle(root).position)) root = root.parentElement
    if (root === null) return { root: 'none', region: '', drags: 0 }
    return { root: `${root.tagName.toLowerCase()} ${root.className}`.slice(0, 80), region: region(root), drags: [...root.querySelectorAll('*')].filter((element) => region(element) === 'drag').length }
  })
  expect(found.region, `${name}: its root (${found.root}) must be no-drag`).toBe('no-drag')
  expect(found.drags, `${name}: nothing inside may drag`).toBe(0)
}

// Signed in. The drag regions are counted first, before any surface has opened.
test.describe.configure({ timeout: 120_000 })
syncedTest('the window: its image policy, drag regions, surfaces over the title bars, the build line with updates off, the test notification and permission line, swipes, minimize, the bottom at 2x, full screen and zoom', { tag: '@electron' }, async ({ juno, fake, app, win }) => {
  await test.step('images load only from the app and Slack; unfurls go through main (src/main/publicImage.ts)', async () => {
    const policy = await juno.win.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(policy).toContain("img-src 'self' juno: https://*.slack-edge.com https://secure.gravatar.com data:")
    expect(policy).not.toContain('slack-imgs.com')
    expect(policy).not.toContain('twimg.com')
  })
  await test.step('only the title bars drag the window, and every control on them opts out', () => dragRegions(juno))
  await test.step('every surface that can open over a title bar opts out of its drag region', () => surfacesOptOut(juno, fake))
  await test.step('answers app.getInfo over the typed IPC bridge', () => buildLine(juno))
  await test.step('Settings › About keeps updates off in tests', () => updatesOff(juno))
  await test.step('Send test notification posts one notification, and a line shows when macOS does not let Juno notify', () => testNotificationAndPermission(juno))
  await test.step('window swipe events move back and forward', () => swipes(juno))
  await test.step('repeated window minimize and restore keeps the draft', () => minimizeKeepsDraft(juno, app))
  await test.step('the bottom survives shrinking content and fractional offsets at 2x', () => bottomAt2x(juno, fake, app, win))
  // Zoom leaves the window at its minimum size, and full screen hides the sidebar: both go last.
  await test.step('zooming in from the View menu keeps the whole sidebar inside the window', () => zoom(juno, app, win))
  // Settings is a tab: the title bars stay as they are.
  await test.step('in full screen the title bars drop the traffic lights’ room, and keep it again after', () => fullScreenInsets(juno))
})

// Main posts the test notification and reads macOS's permission (`junoTest.notificationPermission` fakes it).
async function testNotificationAndPermission(juno: Juno): Promise<void> {
  await juno.openNotifications()
  const page = juno.notifications
  const line = page.root.getByRole('status', { name: 'Notification permission' })
  const sample = { title: 'Juno', body: 'Notifications from Juno look like this.' }

  // Allowed: no line, and the button posts one notification the way a message's is posted.
  await expect(line).toHaveCount(0)
  await page.root.getByRole('button', { name: 'Send test notification' }).click()
  await expect.poll(async () => (await juno.osNotifications()).filter((shown) => shown.title === sample.title && shown.body === sample.body)).toHaveLength(1)

  // Denied: the line and Open Notification Settings, read again when the window regains focus.
  await juno.setNotificationPermission({ authorization: 'denied', badges: 'disabled' })
  await juno.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await line.getByRole('button', { name: 'Open Notification Settings' }).click()
  await expect.poll(() => juno.notificationSettingsOpened()).toBe(1)

  // Alerts may be allowed while app icon badges alone are off.
  await juno.setNotificationPermission({ authorization: 'allowed', badges: 'disabled' })
  await juno.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await line.getByRole('button', { name: 'Open Notification Settings' }).click()
  await expect.poll(() => juno.notificationSettingsOpened()).toBe(2)

  // Turned on in System Settings: back in Juno, the line goes.
  await juno.setNotificationPermission({ authorization: 'allowed', badges: 'enabled' })
  await juno.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(line).toHaveCount(0)

  // Not asked yet: the action asks macOS instead, and the line goes once allowed.
  await juno.setNotificationPermission({ authorization: 'notDetermined', badges: 'unknown' })
  await juno.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await line.getByRole('button', { name: 'Allow notifications' }).click()
  await expect(line).toHaveCount(0)
  expect(await juno.notificationSettingsOpened()).toBe(2)
  await juno.tabs.close('Settings')
}

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

async function minimizeKeepsDraft(juno: Juno, app: ElectronApplication): Promise<void> {
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
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
}

// Real Electron zoom: a device scale factor alone does not exercise it (README, "Electron tests in a browser file").
async function bottomAt2x(juno: Juno, fake: FakeSlack, app: ElectronApplication, win: Page): Promise<void> {
  for (let i = 0; i < 30; i++) fake.injectMessage({ channel: 'C0ENG', user: i % 2 === 0 ? 'U0MAYA' : 'U0LEO', text: `Earlier message ${i}` })
  await juno.topic.expectMessage('Earlier message 29')
  // The draft step's send left the list at the end; it follows the new messages there.
  await juno.topic.scroller.evaluate((node) => { node.scrollTop = node.scrollHeight })
  await juno.topic.expectAtBottom()
  await expect.poll(() => longerThanView(juno.topic.scroller)).toBe(true)
  const zoom = 2 / await win.evaluate(() => devicePixelRatio)
  await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom), zoom)
  await expect.poll(() => win.evaluate(() => devicePixelRatio)).toBe(2)
  const result = await juno.topic.scroller.evaluate(async (node) => {
    const row = [...node.querySelectorAll<HTMLElement>('[data-message-row]')].at(-1)!
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    row.style.paddingBottom = '160px'
    await frame()
    await frame()
    node.scrollTop = Math.floor(node.scrollTop) - 0.5
    const fractional = node.scrollTop % 1
    row.style.paddingBottom = '80px'
    await frame()
    await frame()
    const shrunk = node.scrollHeight - node.scrollTop - node.clientHeight
    row.style.paddingBottom = '160px'
    await frame()
    await frame()
    const grown = node.scrollHeight - node.scrollTop - node.clientHeight
    row.style.paddingBottom = ''
    return { fractional, shrunk, grown }
  })
  expect(result.fractional).toBe(0.5)
  expect(result.shrunk).toBeLessThanOrEqual(1)
  expect(result.grown).toBeLessThanOrEqual(1)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1))
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

async function dragRegions(juno: Juno): Promise<void> {
  const { win } = juno
  await juno.sidebar.expectRows()
  const report = await win.evaluate(() => {
    const region = (node: Element) => getComputedStyle(node).getPropertyValue('-webkit-app-region')
    const all = [...document.querySelectorAll('*')]
    const drags = all.filter((node) => region(node) === 'drag')
    const overlaps = (a: DOMRect, b: DOMRect) => a.width > 0 && a.height > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const uncovered: string[] = []
    for (const control of document.querySelectorAll('button, a[href], input, textarea, select, [role="tab"], [role="row"], [tabindex]')) {
      const box = control.getBoundingClientRect()
      if (!drags.some((drag) => overlaps(box, drag.getBoundingClientRect()))) continue
      let covered = false
      for (let node: Element | null = control; node !== null && region(node) !== 'drag'; node = node.parentElement) {
        if (region(node) === 'no-drag') covered = true
      }
      if (!covered) uncovered.push(control.getAttribute('aria-label') ?? control.textContent?.slice(0, 40) ?? control.tagName)
    }
    // The property is inherited: count where a region starts.
    const holders = all.filter((node) => (region(node) === 'no-drag' || region(node) === 'drag') && (node.parentElement === null || region(node.parentElement) !== region(node))).map((node) => `${node.tagName.toLowerCase()}${node.getAttribute('role') === null ? '' : `[${node.getAttribute('role')}]`} ${node.getAttribute('aria-label') ?? ''}`.trim())
    return { drags: drags.length, regions: holders.length, holders, uncovered }
  })
  // The sidebar's top bar and the tab strip at least.
  expect(report.drags).toBeGreaterThanOrEqual(2)
  expect(report.uncovered).toEqual([])
  // Regions sit on the title bars' groups, not on every control: each one is redrawn every frame it moves (performance.md 8.5).
  expect(report.regions, report.holders.join(', ')).toBeLessThan(20)
}

async function surfacesOptOut(juno: Juno, fake: FakeSlack): Promise<void> {
  const { sidebar, topic, palette, tabs, write, win } = juno
  await win.locator('aside [aria-label="Account and settings"]').click()
  await expectOptsOut(win.getByRole('menu', { name: 'Account' }), 'avatar menu')
  await win.keyboard.press('Escape')

  await sidebar.root.getByRole('button', { name: 'New view', exact: true }).click()
  await expectOptsOut(sidebar.viewSheet, 'view sheet')
  await sidebar.viewSheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sidebar.viewSheet).toHaveCount(0)

  await palette.open()
  await expectOptsOut(win.getByRole('dialog', { name: 'Search and commands' }), 'palette')
  await win.keyboard.press('Escape')

  await sidebar.row('#eng').open()
  await topic.expectTitle('Main')
  await topic.openSwitcher()
  await expectOptsOut(win.locator('[data-topic-switcher]'), 'topic switcher')
  await win.keyboard.press('Escape')

  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Drag region check' })
  const menu = await topic.messageMenu('Drag region check')
  await expectOptsOut(menu.root, 'message menu')
  await menu.more.click()
  await expectOptsOut(menu.root, 'emoji picker in the message menu')
  await win.keyboard.press('Escape')

  await tabs.newTabButton.click()
  await tabs.expectActive('Home')
  await write.chip.click()
  await expectOptsOut(write.list, 'destination list')
  await win.keyboard.press('Escape')
  await write.composer.pressSequentially('@ma')
  await expectOptsOut(write.sendTo, 'Send to list')
  await win.keyboard.press('Escape')
  await write.composer.fill('')
  await write.pickConversation('eng', 'eng')
  await write.composer.pressSequentially('Ask @ma')
  await expectOptsOut(write.suggestions, 'mention suggestions')
}

async function buildLine(juno: Juno): Promise<void> {
  const { app, win, write } = juno
  // Close the mention suggestions and empty the field the step above left.
  await win.keyboard.press('Escape')
  await write.composer.fill('')
  const version = await app.evaluate((electronModule) => electronModule.app.getVersion())
  const electron = await app.evaluate(() => process.versions.electron)
  // The build line is in Settings › About.
  await juno.openSettings('About')
  await expect(juno.settings.root.getByText(`Juno ${version} on ${process.platform}, Electron ${electron}`)).toBeVisible()
}

/** Without a releases repository, updates are unavailable (updates.spec.ts has the repository). About is open. */
async function updatesOff(juno: Juno): Promise<void> {
  await expect(juno.settings.root.getByText(/Juno 0\./)).toBeVisible()
  const updates = juno.settings.root.getByRole('checkbox', { name: 'Download updates automatically' })
  await expect(updates).not.toBeChecked()
  await expect(updates).toBeDisabled()
  await expect(juno.win.evaluate(() => window.juno.updates.set(true))).resolves.toEqual({ kind: 'unavailable' })
  await expect(juno.settings.root.getByRole('button', { name: 'Restart to update' })).toHaveCount(0)
  await expect(juno.settings.root.getByRole('button', { name: "What's new" })).toHaveCount(0)
  await expect(juno.settings.root.getByRole('button', { name: 'Check for updates' })).toHaveCount(0)
}

async function fullScreenInsets(juno: Juno): Promise<void> {
  const { app } = juno
  const fullScreen = (on: boolean) => app.evaluate(({ BrowserWindow }, on) => BrowserWindow.getAllWindows()[0]!.setFullScreen(on), on)
  // A button's left edge from the left of the pane it sits in.
  const leftOf = (pane: string, name: RegExp) =>
    juno.win.locator(pane).getByRole('button', { name }).evaluate((button, pane) => button.getBoundingClientRect().left - button.closest(pane)!.getBoundingClientRect().left, pane)
  const hide = () => leftOf('aside[aria-label="Sidebar"]', /^Hide sidebar/)
  const show = () => leftOf('[data-tab-strip]', /^Show sidebar/)

  // The 78px after the lights, then the sidebar's 10px inset in full screen.
  await expect.poll(hide).toBe(78)
  await fullScreen(true)
  await expect.poll(hide).toBe(10)
  await fullScreen(false)
  await expect.poll(hide).toBe(78)

  // With the sidebar hidden, the tab strip does the same, from its own 10px padding.
  await juno.frame.toggleWithButton()
  await juno.frame.expectHidden()
  await expect.poll(show).toBe(78)
  await fullScreen(true)
  await expect.poll(show).toBe(10)
  await fullScreen(false)
  await expect.poll(show).toBe(78)
}
