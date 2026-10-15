/**
 * The 2026-10-16 design-review harness: drives the built app against the
 * fake Slack (and the fake model for Juno) through the surfaces that landed
 * on 10-15 and had no design pass: ⌘K, privacy mode, the send checks, and
 * Settings › Juno with its sheets and Connections. Writes each shot in light
 * and dark to ../<REVIEW_SET>/, and boxes, Tab walks, focus and contrast to
 * ./out-<REVIEW_SET>/. Review tooling only; it asserts nothing about the product.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import type { Juno } from '../../../../../apps/desktop/e2e/driver/juno'
import { expect, hooks, test as base } from '../../../../../apps/desktop/e2e/fixtures'
import { test as agentTest } from '../../../../../apps/desktop/e2e/juno-agent/chat'
import { contrastSweep } from '../../2026-10-15/harness/contrast'

const SET = process.env.REVIEW_SET ?? 'before'
const shots = resolve(__dirname, '..', SET)
const out = resolve(__dirname, `out-${SET}`)
mkdirSync(shots, { recursive: true })
mkdirSync(out, { recursive: true })

const log: string[] = []
const save = (name: string, data: unknown) => writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2))
const flushLog = (name: string) => writeFileSync(join(out, `${name}.log.md`), log.join('\n') + '\n')

const pages = new WeakMap<ElectronApplication, Page>()
const setDark = (app: ElectronApplication, dark: boolean) => pages.get(app)!.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })

const settle = async (win: Page, ms = 300) => {
  await win.evaluate(() => document.fonts.ready)
  await win.waitForTimeout(ms)
}

const setSize = (app: ElectronApplication, width: number, height: number) =>
  app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height)
  }, { width, height })

/** The window (or a box around `clip`) in light, then dark. */
async function both(juno: Juno, name: string, clip?: Locator) {
  for (const theme of ['light', 'dark'] as const) {
    await setDark(juno.app, theme === 'dark')
    await settle(juno.win)
    const path = join(shots, `${name}-${theme}.png`)
    const box = clip === undefined ? null : await clip.boundingBox()
    if (box) {
      const pad = 24
      await juno.win.screenshot({ path, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } })
    } else {
      await juno.win.screenshot({ path })
    }
  }
  await setDark(juno.app, false)
  await settle(juno.win, 150)
  log.push(`- shot ${name}`)
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (error) {
    log.push(`- FAILED ${name}: ${String(error).split('\n')[0]}`)
  }
}

const measure = (win: Page, selector: string) =>
  win.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        padding: s.padding,
        radius: s.borderRadius,
        font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`,
        color: s.color,
        bg: s.backgroundColor,
      }
    }),
  selector)

/** What has focus: its name, role and ring. */
const focused = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return { tag: 'body' }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      name: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 50),
      inDialog: el.closest('[role=dialog]')?.getAttribute('aria-label') ?? null,
      ring: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    }
  })

const tabWalk = async (win: Page, presses: number, key = 'Tab') => {
  const stops = []
  for (let i = 0; i < presses; i++) {
    await win.keyboard.press(key)
    stops.push(await focused(win))
  }
  return stops
}

/** The animations running on what matches `selector`, for open and close motion and reduced motion. */
const animations = (win: Page, selector: string) =>
  win.evaluate((sel) =>
    [...document.querySelectorAll(sel)].flatMap((el) =>
      el.getAnimations({ subtree: true }).map((a) => ({ name: (a as CSSAnimation).animationName ?? a.id, duration: a.effect?.getTiming().duration })),
    ),
  selector)

const sweep = async (juno: Juno, name: string, root: string) => {
  const result: Record<string, unknown> = {}
  for (const theme of ['light', 'dark'] as const) {
    await setDark(juno.app, theme === 'dark')
    await settle(juno.win)
    const rows = await contrastSweep(juno.win, root)
    result[theme] = rows.filter((row) => row.ratio < 4.5).sort((a, b) => a.ratio - b.ratio)
  }
  await setDark(juno.app, false)
  save(`contrast-${name}`, result)
}

base.describe.configure({ timeout: 600_000 })

base('slack surfaces', async ({ juno }) => {
  log.length = 0
  pages.set(juno.app, juno.win)
  await setSize(juno.app, 1400, 900)
  await juno.signIn()
  await juno.waitForSync()
  const { win, sidebar, topic, palette } = juno
  const dialog = palette.root

  await step('palette recent', async () => {
    await win.mouse.move(1300, 850)
    await palette.open()
    await palette.expectResults()
    save('palette-open-animations', await animations(win, '[role=dialog][aria-label="Search and commands"]'))
    await both(juno, '01-palette-recent')
    save('measure-palette', await measure(win, '[aria-label="Search and commands"], [aria-label="Search and commands"] :is(label, input, kbd, [role=option], [role=group] > div:first-child)'))
    await sweep(juno, 'palette-recent', '[aria-label="Search and commands"]')
    save('tab-palette', await tabWalk(win, 3))
    save('shift-tab-palette', await tabWalk(win, 3, 'Shift+Tab'))
    await palette.input.focus()
    await palette.press('Escape')
    await palette.expectClosed()
    save('focus-after-palette-escape', await focused(win))
  })

  await step('palette from the Search button', async () => {
    await sidebar.searchButton.focus()
    await win.keyboard.press('Enter')
    await palette.expectOpen()
    await palette.press('Escape')
    await palette.expectClosed()
    save('focus-after-palette-from-button', await focused(win))
  })

  await step('palette results', async () => {
    await palette.open()
    await palette.type('eng')
    await palette.expectResults()
    await win.waitForTimeout(800)
    await both(juno, '02-palette-results')
    await palette.press('ArrowDown')
    await both(juno, '02b-palette-results-second', dialog)
    await palette.clear()
    await palette.type('maya')
    await palette.expectResults()
    await win.waitForTimeout(800)
    await both(juno, '03-palette-people')
    await palette.clear()
    await palette.type('tell maya the wednesday slot works')
    await win.waitForTimeout(1500)
    await both(juno, '04-palette-command')
    await sweep(juno, 'palette-command', '[aria-label="Search and commands"]')
    await palette.clear()
    await palette.type('zebra crossing quartz')
    await win.waitForTimeout(1500)
    await both(juno, '05-palette-no-matches', dialog)
    await palette.press('Escape')
  })

  await step('palette reduced motion', async () => {
    await win.emulateMedia({ reducedMotion: 'reduce' })
    await palette.open()
    save('palette-open-animations-reduced', await animations(win, '[role=dialog][aria-label="Search and commands"]'))
    await palette.press('Escape')
    await win.emulateMedia({ reducedMotion: 'no-preference' })
  })

  await step('palette narrow window', async () => {
    await setSize(juno.app, 720, 600)
    await settle(win, 400)
    await palette.open()
    await palette.type('eng')
    await win.waitForTimeout(800)
    await both(juno, '06-palette-720')
    await palette.press('Escape')
    await setSize(juno.app, 1400, 900)
    await settle(win, 400)
  })

  await step('account menu privacy item', async () => {
    await juno.accountMenu.open()
    await both(juno, '10-account-menu')
    save('measure-account-menu', await measure(win, '[role=dialog][aria-label="Account"] [role=menuitem]'))
    save('tab-account-menu', await tabWalk(win, 4))
    await juno.accountMenu.close()
  })

  await step('privacy footer', async () => {
    await juno.privacy.toggleWithMenu()
    await expect(juno.privacy.footer).toBeVisible()
    await win.mouse.move(1300, 850)
    await both(juno, '11-privacy-on')
    await both(juno, '11b-privacy-footer', juno.privacy.footer)
    save('measure-privacy-footer', await measure(win, '[role=complementary][aria-label="Sidebar"] [role=status], [role=complementary][aria-label="Sidebar"] [role=status] *'))
    await sweep(juno, 'privacy-footer', '[role=complementary][aria-label="Sidebar"] [role=status]')
    await juno.privacy.showButton.focus()
    await win.keyboard.press('Shift+Tab')
    await win.keyboard.press('Tab')
    await both(juno, '11c-privacy-show-focus', juno.privacy.footer)
    await juno.accountMenu.open()
    await both(juno, '11d-account-menu-privacy-on', juno.accountMenu.root)
    await juno.accountMenu.close()
    await juno.privacy.showButton.click()
    await expect(juno.privacy.footer).toHaveCount(0)
  })

  const checks = async (suffix: string) => {
    await sidebar.row('#eng').open()
    await topic.expectTitle('Main')
    await topic.composer.fill('The offer for the new backend hire goes out Friday, can you recieve the the signed letter')
    await expect(topic.audienceWarning).toBeVisible()
    await win.mouse.move(1300, 850)
    await both(juno, `20-audience-line${suffix}`, topic.composerField)
    await topic.composer.press('Enter')
    await expect(topic.checkBar.bar).toBeVisible()
    await both(juno, `21-clarity-bar${suffix}`, topic.composerField)
    save(`measure-check-bar${suffix}`, await measure(win, '[data-send-check], [data-send-check] > *, [data-audience-warning], [data-composer-field]'))
    save(`tab-check-bar${suffix}`, await tabWalk(win, 3))
    await sweep(juno, `check-bar${suffix}`, '[data-composer-field]')
    await topic.composer.press('Escape')
    await topic.composer.fill('the preview environments reaper should cut the staging bill')
    await win.waitForTimeout(1000)
    await topic.composer.press('Enter')
    await expect(topic.checkBar.bar).toBeVisible()
    await both(juno, `22-route-bar${suffix}`, topic.composerField)
    await topic.composer.press('Escape')
    await topic.composer.fill('')
  }

  await step('send checks', () => checks(''))
  await step('send checks narrow', async () => {
    await setSize(juno.app, 720, 600)
    await settle(win, 400)
    await checks('-720')
    await setSize(juno.app, 1400, 900)
  })

  flushLog('slack')
})

agentTest('juno settings', async ({ juno }) => {
  log.length = 0
  pages.set(juno.app, juno.win)
  await setSize(juno.app, 1400, 900)
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  const { win } = juno
  const main = win.locator('main')

  const openPage = async (label: string) => {
    await win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
    await win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
    await win.getByRole('menuitem', { name: label }).click()
    await juno.tabs.expectActive(label)
    await win.mouse.move(1300, 850)
    await settle(win, 600)
  }

  await step('settings juno backup and this mac', async () => {
    await openPage('Settings › Juno')
    await main.getByRole('heading', { name: 'Backup' }).scrollIntoViewIfNeeded()
    await settle(win)
    await both(juno, '30-settings-backup')
    save('measure-backup', await measure(win, 'main [data-backup] *:is(button, [data-backup-folder], [data-last-backup]), main [data-ownership] *:is(button, [data-owner-chip], [data-owner-line])'))
    await sweep(juno, 'settings-backup', 'main')
  })

  const sheet = async (button: string, name: string) => {
    const opener = main.getByRole('button', { name: button, exact: true })
    // From the keyboard: a click on macOS does not focus a button, so only a keyboard open has an opener to return to.
    await opener.focus()
    await win.keyboard.press('Enter')
    const dialog = win.getByRole('dialog').last()
    await expect(dialog).toBeVisible()
    await win.mouse.move(1300, 850)
    await both(juno, name)
    save(`measure-${name}`, await measure(win, '[data-sheet], [data-sheet] *:is(h2, p, button, input, label, [data-recovery-phrase])'))
    save(`focus-${name}`, await focused(win))
    await sweep(juno, name, '[data-sheet]')
    await win.keyboard.press('Escape')
    await settle(win)
    save(`focus-after-${name}`, await focused(win))
    await opener.click()
    await expect(dialog).toBeVisible()
    save(`tab-${name}`, await tabWalk(win, 8))
    await win.keyboard.press('Escape')
    await settle(win)
  }

  await step('phrase sheet', () => sheet('Export recovery phrase', '31-phrase-sheet'))
  await step('restore sheet', () => sheet('Restore', '32-restore-sheet'))
  await step('move sheet', () => sheet('Move', '33-move-sheet'))

  await step('connections', async () => {
    await openPage('Connections')
    await both(juno, '40-connections')
    save('measure-connections', await measure(win, 'main [data-connection] *:is(button, label, [data-tool])'))
    await sweep(juno, 'connections', 'main')
    await main.locator('[data-add-server]').scrollIntoViewIfNeeded()
    await settle(win)
    await both(juno, '41-connections-bottom')
    await main.locator('[data-add-server]').getByRole('textbox').first().focus()
    save('tab-add-server', await tabWalk(win, 4))
  })

  await step('connections narrow', async () => {
    await setSize(juno.app, 720, 600)
    await settle(win, 400)
    await both(juno, '42-connections-720')
    await setSize(juno.app, 1400, 900)
  })

  flushLog('juno')
})
