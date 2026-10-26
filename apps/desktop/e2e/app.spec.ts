import type { Locator, Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FakeSlack } from '@juno/fake-slack'
import { expect, syncedTest, test } from './fixtures'
import type { Juno } from './driver/juno'
import { expectStableAnchor } from './shiftProbe'

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

/** Names that would hand the page Electron's raw IPC rather than one route of the bridge. */
const RAW_IPC = ['ipcRenderer', 'send', 'sendSync', 'invoke', 'on', 'once', 'postMessage', 'removeAllListeners']

// The method names are JunoBridge's, which the compiler checks; this checks what
// only a running preload shows: no Node globals, and only functions cross.
async function onlyTheBridge(win: Page): Promise<void> {
  await expect(win.getByRole('heading', { name: "Hi, I'm Juno", exact: true })).toBeVisible()
  const exposed = await win.evaluate(() => {
    const globals = window as unknown as Record<string, unknown>
    const members = Object.entries(window.juno as unknown as Record<string, unknown>).flatMap(([group, value]) =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).map(([name, member]) => ({ group, name, type: typeof member }))
        : [{ group, name: '', type: typeof value }])
    return { require: typeof globals['require'], process: typeof globals['process'], ipcRenderer: typeof globals['ipcRenderer'], members }
  })
  expect(exposed.require).toBe('undefined')
  expect(exposed.process).toBe('undefined')
  expect(exposed.ipcRenderer).toBe('undefined')
  expect(exposed.members.length).toBeGreaterThan(0)
  // Each group holds functions only: no nested object, such as ipcRenderer itself, and no value.
  expect(exposed.members.filter((member) => member.type !== 'function')).toEqual([])
  expect(exposed.members.filter((member) => RAW_IPC.includes(member.name))).toEqual([])
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
syncedTest('the signed-in shell: its image policy, drag regions, surfaces over the title bars, the build line with updates off, and the title bars in full screen', { tag: '@electron' }, async ({ juno, fake }) => {
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
  // Settings is a tab: the title bars stay as they are.
  await test.step('in full screen the title bars drop the traffic lights’ room, and keep it again after', () => fullScreenInsets(juno))
})

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
  expect(await hide()).toBe(78)
  await fullScreen(true)
  await expect.poll(hide).toBe(10)
  await fullScreen(false)
  await expect.poll(hide).toBe(78)

  // With the sidebar hidden, the tab strip does the same, from its own 10px padding.
  await juno.frame.toggleWithButton()
  await juno.frame.expectHidden()
  expect(await show()).toBe(78)
  await fullScreen(true)
  await expect.poll(show).toBe(10)
  await fullScreen(false)
  await expect.poll(show).toBe(78)
}

test('the preload exposes only the isolated bridge, and a second launch on the same data hands over to the open window', { tag: '@electron' }, async ({ app: electronApp, win, userData }, testInfo) => {
  // Two process launches can take longer on the shared Mac.
  test.slow()
  await test.step('the preload exposes only the isolated bridge', () => onlyTheBridge(win))
  await expect(win.getByRole('button', { name: "Use the Slack app's session" })).toBeVisible()
  const launch = await electronApp.evaluate(({ app }) => ({ executable: process.execPath, path: app.getAppPath(), userData: app.getPath('userData') }))
  expect(launch.userData).toBe(userData)
  const handover = await electronApp.evaluateHandle(({ app }) => {
    const received = { count: 0 }
    app.on('second-instance', () => { received.count += 1 })
    return received
  })
  const mainWindow = await electronApp.browserWindow(win)
  // Xvfb has no window manager to handle minimize on the Linux runner.
  if (process.platform === 'darwin') {
    await mainWindow.evaluate((window) => window.minimize())
    await expect.poll(() => mainWindow.evaluate((window) => window.isMinimized())).toBe(true)
  }

  // This process should exit before opening a window. Playwright's launcher
  // waits for debugging endpoints, so use a normal launch and require exit 0.
  const env: NodeJS.ProcessEnv = { ...process.env, JUNO_USER_DATA: userData, JUNO_E2E: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  // Match Playwright's Linux launch flags for the remote container.
  const args = process.platform === 'linux' ? ['--no-sandbox', launch.path] : [launch.path]
  const result = await promisify(execFile)(launch.executable, args, { env, timeout: 30_000 })
  await testInfo.attach('second-launch.log', { body: result.stdout + result.stderr, contentType: 'text/plain' })
  await expect.poll(() => handover.evaluate((received) => received.count)).toBe(1)
  await expect.poll(() => mainWindow.evaluate((window) => window.isMinimized())).toBe(false)
  expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await expect(win.getByRole('button', { name: "Use the Slack app's session" })).toBeVisible()
})
