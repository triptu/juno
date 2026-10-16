import type { Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { expect, launchApp, test } from './fixtures'

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

test('renders the shell with bundled fonts and token colours', async ({ win }) => {
  await expect(win).toHaveTitle('Juno')

  const title = win.getByRole('heading', { name: "Hi, I'm Juno", level: 1, exact: true })
  await expect(title).toBeVisible()

  const button = win.getByRole('button', { name: 'Sign in to Slack' })
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
})

test('only the title bars drag the window, and every control on them opts out', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('answers app.getInfo over the typed IPC bridge', async ({ juno, app }) => {
  await juno.signIn()
  const version = await app.evaluate((electronModule) => electronModule.app.getVersion())
  const electron = await app.evaluate(() => process.versions.electron)
  // The build line is in Settings › About.
  await juno.openSettings('About')
  await expect(juno.settings.root.getByText(`Juno ${version} on ${process.platform}, Electron ${electron}`)).toBeVisible()
})

test('switches to the dark theme in place', async ({ win }) => {
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
})

test('exposes only the bridge to the page', async ({ win }) => {
  await expect(win.getByRole('heading', { name: "Hi, I'm Juno", exact: true })).toBeVisible()
  const exposed = await win.evaluate(() => {
    const globals = window as unknown as Record<string, unknown>
    return {
      require: typeof globals['require'],
      process: typeof globals['process'],
      juno: Object.keys(window.juno),
      updates: Object.keys(window.juno.updates),
      app: Object.keys(window.juno.app),
      engine: Object.keys(window.juno.engine),
      agent: Object.keys(window.juno.agent),
      launch: Object.keys(window.juno.launch),
      contextMenu: Object.keys(window.juno.contextMenu),
      shell: Object.keys(window.juno.shell),
      clipboard: Object.keys(window.juno.clipboard),
      menu: Object.keys(window.juno.menu),
      notifications: Object.keys(window.juno.notifications),
    }
  })
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    juno: ['updates', 'app', 'engine', 'agent', 'launch', 'contextMenu', 'shell', 'clipboard', 'menu', 'notifications'],
    updates: ['get', 'set', 'restart', 'onChange'],
    app: ['getInfo'],
    engine: ['requestPort', 'restart'],
    agent: ['requestPort', 'setOpenRouterKey', 'provider', 'setProvider', 'codex', 'codexSignIn', 'onProvider', 'chooseFolder', 'recoveryPhrase', 'typeRecoveryPhrase'],
    launch: ['setTheme', 'setAccent', 'setDensity', 'setPrivacy', 'setSidebar'],
    contextMenu: ['popup'],
    shell: ['openExternal', 'openInSlack', 'editUndo', 'downloadFile'],
    clipboard: ['writeText'],
    menu: ['onCommand'],
    notifications: ['setViewing', 'onOpen'],
  })
})

test('a second launch on the same data hands over to the open window', async ({ app: electronApp, win, userData }, testInfo) => {
  // Two process launches can take longer on the shared Mac.
  test.slow()
  await expect(win.getByRole('button', { name: 'Sign in to Slack' })).toBeVisible()
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
  await expect(win.getByRole('button', { name: 'Sign in to Slack' })).toBeVisible()
})

test('a window saved on a display that is gone opens on screen', async ({ running, userData }) => {
  await running.close()
  await writeFile(join(userData, 'launch.json'), JSON.stringify({ theme: 'light', bounds: { x: -6000, y: -6000, width: 1100, height: 760 } }))
  const again = await launchApp(userData)
  try {
    const placed = await again.app.evaluate(({ BrowserWindow, screen }) => {
      const bounds = BrowserWindow.getAllWindows()[0]!.getBounds()
      const { workArea } = screen.getPrimaryDisplay()
      return { bounds, inside: bounds.x >= workArea.x && bounds.y >= workArea.y && bounds.x + bounds.width <= workArea.x + workArea.width && bounds.y + bounds.height <= workArea.y + workArea.height }
    })
    expect(placed.inside).toBe(true)
    expect(placed.bounds.width).toBe(1100)
    expect(placed.bounds.height).toBe(760)
  } finally {
    await again.close()
  }
})
