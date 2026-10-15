import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

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

test('answers app.getInfo over the typed IPC bridge', async ({ juno, app }) => {
  await juno.signIn()
  const version = await app.evaluate((electronModule) => electronModule.app.getVersion())
  const electron = await app.evaluate(() => process.versions.electron)
  // The build line lives in the account menu's diagnostics block.
  await juno.accountMenu.open()
  await expect(juno.accountMenu.root.getByText(`Juno ${version} on ${process.platform}, Electron ${electron}`)).toBeVisible()
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
      app: Object.keys(window.juno.app),
      engine: Object.keys(window.juno.engine),
      agent: Object.keys(window.juno.agent),
      launch: Object.keys(window.juno.launch),
      contextMenu: Object.keys(window.juno.contextMenu),
      shell: Object.keys(window.juno.shell),
      clipboard: Object.keys(window.juno.clipboard),
      menu: Object.keys(window.juno.menu),
    }
  })
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    juno: ['app', 'engine', 'agent', 'launch', 'contextMenu', 'shell', 'clipboard', 'menu'],
    app: ['getInfo'],
    engine: ['requestPort', 'restart'],
    agent: ['requestPort', 'setOpenRouterKey'],
    launch: ['setTheme', 'setAccent', 'setSidebar'],
    contextMenu: ['popup'],
    shell: ['openExternal', 'openInSlack', 'editUndo'],
    clipboard: ['writeText'],
    menu: ['onCommand'],
  })
})
