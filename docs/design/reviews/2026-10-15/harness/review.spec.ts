/**
 * The 2026-10-15 design-review harness: drives the built app against the
 * fake Slack (and the fake model for Juno) through every surface that landed
 * on 10-15, and writes each one in light and dark to ../<REVIEW_SET>/, with
 * measurements, tab walks and contrast sweeps in ./out-<REVIEW_SET>/.
 * Review tooling only; it asserts nothing about the product.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { Juno } from '../../../../../apps/desktop/e2e/driver/juno'
import { expect, hooks, test as base } from '../../../../../apps/desktop/e2e/fixtures'
import { JunoChatPane, test as agentTest } from '../../../../../apps/desktop/e2e/juno-agent/chat'
import { contrastSweep } from './contrast'

const SET = process.env.REVIEW_SET ?? 'before'
const shots = resolve(__dirname, '..', SET)
const out = resolve(__dirname, `out-${SET}`)
mkdirSync(shots, { recursive: true })
mkdirSync(out, { recursive: true })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'
const ENG_MAIN = '#eng'

const log: string[] = []
const save = (name: string, data: unknown) => writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2))
const flushLog = (name: string) => writeFileSync(join(out, `${name}.log.md`), log.join('\n') + '\n')

// Playwright pins prefers-color-scheme to light, so the system theme is switched through it.
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

/** The window in light, then dark, as `<name>-light.png` and `<name>-dark.png`. */
async function both(juno: Juno, name: string, clip?: Locator) {
  const take = async (theme: 'light' | 'dark') => {
    await setDark(juno.app, theme === 'dark')
    await settle(juno.win)
    const path = join(shots, `${name}-${theme}.png`)
    if (clip) {
      const box = await clip.boundingBox()
      if (box) {
        const pad = 24
        await juno.win.screenshot({ path, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } })
        return
      }
    }
    await juno.win.screenshot({ path })
  }
  await take('light')
  await take('dark')
  await setDark(juno.app, false)
  await settle(juno.win, 150)
  log.push(`- shot ${name}`)
}

/** Runs one step; a failure is logged and the walk goes on. */
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (error) {
    log.push(`- FAILED ${name}: ${String(error).split('\n')[0]}`)
  }
}

/** Boxes and computed styles of every element matching `selector`, with its direct children. */
const measure = (win: Page, selector: string) =>
  win.evaluate((sel) => {
    const pick = (el: Element) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40),
        rect: { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 },
        padding: s.padding,
        gap: s.gap,
        radius: s.borderRadius,
        font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight} ${s.fontFamily.split(',')[0]}`,
        color: s.color,
        bg: s.backgroundColor,
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        shadow: s.boxShadow,
        outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} offset ${s.outlineOffset}`,
      }
    }
    return [...document.querySelectorAll(sel)].map((el) => ({ ...pick(el), children: [...el.children].map(pick) }))
  }, selector)

/** Tab `presses` times from the current focus and record each stop's name, role and ring. */
const tabWalk = async (win: Page, presses: number) => {
  const stops = []
  for (let i = 0; i < presses; i++) {
    await win.keyboard.press('Tab')
    stops.push(
      await win.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return { tag: 'body' }
        const cs = getComputedStyle(el)
        const labelled = el.getAttribute('aria-labelledby')
        const name = el.getAttribute('aria-label') ?? (labelled ? labelled.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : (el.textContent ?? '').trim().slice(0, 50))
        const r = el.getBoundingClientRect()
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role'),
          name,
          ring: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} +${cs.outlineOffset}`,
          shadow: cs.boxShadow,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        }
      }),
    )
  }
  return stops
}

/** Each field's, button's and row text's distance from the left and right of the card it sits in, by the card's own edges. */
const insets = (win: Page, root: string) =>
  win.evaluate((sel) => {
    const card = (el: Element): Element | null => {
      for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).boxShadow !== 'none' && getComputedStyle(p).borderRadius !== '0px') return p
      return null
    }
    const out: Array<Record<string, unknown>> = []
    for (const el of document.querySelectorAll(`${sel} label, ${sel} button, ${sel} [role=listitem] > span > span, ${sel} [data-provider-key]`)) {
      const c = card(el)
      if (!c) continue
      const r = el.getBoundingClientRect()
      const k = c.getBoundingClientRect()
      if (r.width === 0) continue
      out.push({ what: `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`, left: Math.round(r.left - k.left), right: Math.round(k.right - r.right), width: Math.round(r.width), cardWidth: Math.round(k.width) })
    }
    return out
  }, root)

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

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

const test = base
test.describe.configure({ timeout: 600_000 })

test('slack surfaces', async ({ juno, slack }) => {
  log.length = 0
  pages.set(juno.app, juno.win)
  await setSize(juno.app, 1400, 900)
  await juno.signIn()
  await juno.waitForSync()
  const { win, sidebar, topic, tabs, home, newChat, allTopics } = juno

  await step('home', async () => {
    await home.expectShown()
    await win.mouse.move(1300, 850)
    await both(juno, '01-home')
    // Each quick filter's box and its icon's box, for the insets of the icon pills.
    save('measure-quick-filters', await win.evaluate(() => [...document.querySelectorAll('[aria-label="Quick filters"] button')].map((b) => {
      const r = b.getBoundingClientRect()
      const i = b.querySelector('svg')?.getBoundingClientRect()
      return { name: b.getAttribute('aria-label'), box: [r.x, r.y, r.width, r.height], icon: i ? [i.x - r.x, i.y - r.y, i.width, i.height, r.right - i.right, r.bottom - i.bottom] : null }
    })))
    await win.getByRole('button', { name: /^Unread only$|^Show unread only$/ }).hover()
    await both(juno, '01b-unread-hover', sidebar.root.getByRole('group', { name: 'Quick filters' }))
    await win.getByRole('button', { name: /^Unread only$|^Show unread only$/ }).click()
    await win.mouse.move(1300, 850)
    await both(juno, '01c-unread-on', sidebar.root)
    await win.getByRole('button', { name: /^Unread only$|^Show unread only$/ }).click()
    await win.mouse.move(1300, 850)
    save('measure-home', await measure(win, '[data-home] *:is(h1,h2,[data-home-item],[data-home-scene])'))
    await sweep(juno, 'home', '[data-home]')
  })

  await step('topic thread', async () => {
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await win.mouse.move(1300, 850)
    await both(juno, '02-topic-thread')
    save('measure-header-thread', await measure(win, '[data-topic-view] [data-island], [data-topic-view] [data-header-band]'))
    save('measure-composer-thread', await measure(win, '[data-topic-view] [data-composer], [data-topic-view] [data-composer-field]'))
    await sweep(juno, 'topic-thread', '[data-topic-view]')
  })

  await step('topic scrolled', async () => {
    // The driver waits for a scroll to end, which never comes when the thread fits the window.
    const scrolls = await topic.scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 240)
    if (!scrolls) throw new Error('the thread fits the window; nothing to scroll under the header')
    await topic.scrollUp(240)
    await both(juno, '03-topic-scrolled-under-header')
    await topic.scrollToBottom()
  })

  await step('header focus walk', async () => {
    await topic.titleButton.focus()
    await win.keyboard.press('Shift+Tab')
    save('tab-topic', await tabWalk(win, 10))
    await topic.titleButton.focus()
    await both(juno, '04-header-title-focus', topic.header)
    await win.keyboard.press('Tab')
    await both(juno, '04b-header-next-focus', topic.header)
  })

  await step('rename in header', async () => {
    await juno.topic.chooseInMenu('rename')
    await expect(juno.renameField).toBeFocused()
    await both(juno, '05-header-rename', topic.header)
    await juno.renameField.press('Escape')
  })

  await step('composer', async () => {
    await topic.composer.click()
    await topic.composer.fill('Thursday works for the cutover. I will post the runbook in the doc before noon.')
    await both(juno, '06-composer-typed')
    save('measure-composer-typed', await measure(win, '[data-topic-view] [data-composer] *'))
    await topic.composer.fill('')
    await topic.composer.press('Shift+Tab')
    await topic.composer.press('Tab')
    await both(juno, '06b-composer-keyboard-focus', topic.composerField)
  })

  await step('hover toolbar', async () => {
    const row = topic.message('Draft plan is in the doc')
    await row.hover()
    await settle(win)
    await both(juno, '07-message-hover-toolbar')
    save('measure-hover-toolbar', await measure(win, '[data-row-actions], [data-row-actions] *'))
  })

  await step('emoji picker', async () => {
    const row = topic.message('Draft plan is in the doc')
    await row.hover()
    await row.getByRole('button', { name: 'More reactions' }).click()
    await expect(win.locator('[data-floating="picker"]')).toBeVisible()
    await both(juno, '08-emoji-picker')
    save('measure-emoji-picker', await measure(win, '[data-floating="picker"], [data-floating="picker"] > * > *'))
    await win.keyboard.press('Escape')
  })

  await step('own message edit and delete', async () => {
    await topic.send('Shiping the fix today')
    await topic.expectSent('Shiping the fix today')
    await topic.composer.press('ArrowUp')
    const row = topic.message('Shiping the fix today')
    await expect(row).toBeFocused()
    await both(juno, '09-message-selected')
    await row.press('e')
    await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
    await both(juno, '10-message-edit')
    await win.keyboard.press('Escape')
    await row.focus()
    await row.press('Delete')
    await expect(row.locator('[data-delete-confirm]')).toBeVisible()
    await both(juno, '11-message-delete-confirm')
    await row.press('Escape')
  })

  await step('resolve toast', async () => {
    await topic.header.getByRole('button', { name: 'Resolve' }).click()
    await juno.expectToast('Resolved')
    await both(juno, '12-toast-resolved')
    save('measure-toast', await measure(win, '[role="status"]:has(button), [role="status"]:has(button) *'))
    await juno.undoFromToast()
  })

  await step('main and threads', async () => {
    await sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    await win.mouse.move(1300, 850)
    await both(juno, '13-main')
    save('measure-header-main', await measure(win, '[data-topic-view] [data-island], [data-topic-view] [data-island] > *'))
    await topic.openThreads()
    await both(juno, '14-threads-popover')
    await win.keyboard.press('Escape')
  })

  await step('dm', async () => {
    await sidebar.row('Maya', { exact: true }).open()
    await win.mouse.move(1300, 850)
    await both(juno, '15-dm')
  })

  await step('narrow topic', async () => {
    await setSize(juno.app, 720, 600)
    await settle(win, 500)
    await sidebar.row(POSTGRES).open()
    await both(juno, '16-topic-720')
    // The hover toolbar on a narrow row, mid-list and on the first row under the header.
    await topic.message('I can own the dry run').hover()
    await both(juno, '16c-topic-720-hover')
    save('measure-720-hover', await measure(win, '[data-message-row]:hover, [data-message-row]:hover [data-sender], [data-message-row]:hover time, [data-message-row]:hover [role=toolbar]'))
    await topic.scrollToTop()
    await topic.message('Draft plan is in the doc').hover()
    await both(juno, '16e-topic-720-hover-first')
    await sidebar.row(ENG_MAIN).open()
    await both(juno, '16b-main-720')
    await setSize(juno.app, 1400, 900)
    await settle(win, 500)
  })

  await step('section labels', async () => {
    await sidebar.row(RINA).chooseInMenu('pin')
    await win.mouse.move(1300, 850)
    await both(juno, '17b-sidebar-pinned-recent', sidebar.root)
    await sidebar.row(RINA).chooseInMenu('pin')
  })

  await step('peek', async () => {
    await sidebar.row(POSTGRES).open()
    await sidebar.row(RINA).hover()
    await win.keyboard.down('Alt')
    await juno.peek.expectShowing(RINA)
    await both(juno, '17-peek')
    save('measure-peek', await measure(win, '[data-peek], [data-peek] > *'))
    await juno.peek.release()
  })

  await step('new chat', async () => {
    await tabs.newTabButton.click()
    await tabs.expectActive('New chat')
    await newChat.expectEmpty()
    await both(juno, '18-new-chat')
    save('measure-new-chat', await measure(win, '[data-new-chat] *:is(button,h1,h2,[data-composer])'))
    await sweep(juno, 'new-chat', '[data-new-chat]')
    await newChat.conversationButton.click()
    await expect(newChat.list).toBeVisible()
    await both(juno, '19-new-chat-picker')
    await newChat.search.fill('eng')
    await both(juno, '19b-new-chat-picker-search')
    await win.keyboard.press('Escape')
    await newChat.write('Thursday works for the freeze')
    await newChat.pickThread('draft', POSTGRES)
    await both(juno, '20-new-chat-thread-picked')
    await tabs.menu('close-tab')
  })

  await step('all topics', async () => {
    await allTopics.open()
    await win.mouse.move(1300, 850)
    await both(juno, '21-all-topics')
    save('measure-all-topics', await measure(win, 'main h1, main [data-all-topics-table], main button'))
    await sweep(juno, 'all-topics', 'main')
    await allTopics.type('zzzz no such topic')
    await allTopics.expectEmpty()
    await both(juno, '22-all-topics-empty')
  })

  await step('account menu', async () => {
    await juno.accountMenu.open()
    await both(juno, '23-account-menu')
    save('measure-account-menu', await measure(win, '[role="dialog"][aria-label="Account"], [role="dialog"][aria-label="Account"] *:is([role=menuitem],button)'))
    await juno.accountMenu.close()
  })

  await step('notifications page', async () => {
    await juno.openNotifications()
    await win.mouse.move(1300, 850)
    await both(juno, '24-notifications')
    save('measure-notifications', await measure(win, 'main h1, main h2, main h3, main label, main button, main input, main textarea'))
    await sweep(juno, 'notifications', 'main')
    await win.locator('main').evaluate((m) => m.querySelector('[data-scroll]')?.scrollTo(0, 99999))
    await both(juno, '24b-notifications-bottom')
  })

  await step('preferences page', async () => {
    await juno.openPreferences()
    await win.mouse.move(1300, 850)
    await both(juno, '25-preferences')
    save('insets-preferences', await insets(win, 'main'))
    save('measure-preferences', await measure(win, 'main h1, main h2, main h3, main label, main button, main [role=radio]'))
    await sweep(juno, 'preferences', 'main')
    await win.locator('main').evaluate((m) => m.querySelector('[data-scroll]')?.scrollTo(0, 99999))
    await both(juno, '25b-preferences-bottom')
  })

  await step('why popover', async () => {
    slack.as('Leo').postIn('alerts-prod', 'Weekly error report is up')
    await sidebar.row('#alerts-prod').open()
    await topic.expectMessage('Weekly error report is up')
    await topic.chooseInMessageMenu('Weekly error report is up', 'why')
    await expect(juno.whyPopover("Didn't notify you")).toBeVisible()
    await both(juno, '26-why-popover')
    await win.keyboard.press('Escape')
  })

  await step('views', async () => {
    await sidebar.root.getByRole('button', { name: 'New view', exact: true }).click()
    await expect(sidebar.viewSheet).toBeVisible()
    await both(juno, '27-view-sheet')
    save('measure-view-sheet', await measure(win, '[data-view-sheet], [data-view-sheet] *:is(h1,h2,label,button,input)'))
    await sidebar.fillViewSheet({ name: 'Bots', icon: 'Robot', conversations: ['alerts-prod'] })
    await both(juno, '27b-view-sheet-filled')
    await sidebar.viewSheet.getByRole('button', { name: 'Save' }).click()
    await sidebar.createView({ name: 'Hiring', conversations: ['hiring'] })
    await sidebar.filter('All')
    await win.mouse.move(1300, 850)
    await both(juno, '28-view-pills')
    save('measure-view-pills', await measure(win, '[data-pill-row], [data-pill-row] [data-view-pill], [data-pill-row] button'))
  })

  await step('juno with no provider', async () => {
    await sidebar.row(POSTGRES).open()
    await tabs.menu('juno')
    await expect(win.locator('aside [data-juno-no-provider]')).toBeVisible()
    await win.mouse.move(700, 850)
    await both(juno, '29-panel-no-provider')
    await tabs.menu('juno')
    await junoNav(juno).click()
    await expect(win.locator('main [data-juno-no-provider]')).toBeVisible()
    await both(juno, '30-juno-tab-no-provider')
    await win.locator('main [data-juno-no-provider]').getByRole('button', { name: 'Add a provider' }).click()
    await tabs.expectActive('Settings › Juno')
    await win.mouse.move(1300, 850)
    await both(juno, '31-settings-juno-add-provider')
    save('measure-provider', await measure(win, 'main h1, main h2, main h3, main label, main button, main input, main [role=radio]'))
    await sweep(juno, 'settings-juno-no-provider', 'main')
    await win.locator('main').getByLabel('API key').fill('two words')
    await win.locator('main').getByRole('button', { name: 'Save' }).click()
    await expect(win.locator('[data-provider-error]')).toBeVisible()
    await both(juno, '32-provider-error')
  })

  flushLog('slack')
})

agentTest('juno surfaces', async ({ juno }) => {
  log.length = 0
  pages.set(juno.app, juno.win)
  await setSize(juno.app, 1400, 900)
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 90_000 }).toBe('ready')
  const { win, sidebar, topic, tabs } = juno

  await step('juno tab empty', async () => {
    await junoNav(juno).click()
    await tabs.expectActive('Juno')
    await win.mouse.move(1300, 850)
    await both(juno, '40-juno-tab-empty')
    save('measure-juno-header', await measure(win, 'main [data-juno-header], main [data-juno-header] [data-island], main [data-island] > *'))
  })

  await step('juno chat', async () => {
    const chat = JunoChatPane.tab(win)
    await chat.send('what is on today?')
    await chat.expectJuno('You said: what is on today?')
    await chat.send('please react')
    await chat.expectJuno('Reacted to please react')
    await win.mouse.move(1300, 850)
    await both(juno, '41-juno-tab-chat')
    save('measure-juno-composer', await measure(win, 'main [data-juno-composer], main [data-juno-composer] *'))
    await sweep(juno, 'juno-tab', 'main')
    await chat.composer.focus()
    await both(juno, '42-juno-tab-composer-focus', win.locator('main [data-juno-composer]'))
    await chat.composer.press('Shift+Tab')
    await chat.composer.press('Tab')
    await both(juno, '42b-juno-tab-composer-keyboard-focus', win.locator('main [data-juno-composer]'))
    save('tab-juno-tab', await tabWalk(win, 8))
  })

  await step('juno header menu', async () => {
    await win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
    await expect(win.getByRole('menuitem', { name: 'Activity' })).toBeVisible()
    await both(juno, '43-juno-header-menu')
    save('measure-juno-menu', await measure(win, '[role=menu], [role=menu] [role=menuitem]'))
    await win.keyboard.press('Escape')
  })

  await step('juno panel', async () => {
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await tabs.menu('juno')
    const panel = JunoChatPane.panel(win)
    await expect(panel.composer).toBeFocused()
    await both(juno, '44-panel-composer-focus')
    await both(juno, '44b-panel-composer-focus-crop', win.locator('aside [data-juno-composer]'))
    save('measure-panel', await measure(win, 'aside[data-juno-panel], aside[data-juno-panel] [data-island], aside [data-juno-composer], aside [data-juno-composer] *'))
    await panel.send('summarise this thread')
    await panel.expectJuno('You said: summarise this thread')
    await win.mouse.move(300, 850)
    await panel.composer.blur()
    await both(juno, '45-panel-chat')
    await sweep(juno, 'panel', 'aside[data-juno-panel]')
    save('tab-panel', await tabWalk(win, 10))
    await tabs.menu('juno')
  })

  const openPage = async (label: string) => {
    await junoNav(juno).click()
    await win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
    await win.getByRole('menuitem', { name: label }).click()
    await tabs.expectActive(label)
    await win.mouse.move(1300, 850)
    await settle(win, 600)
  }

  await step('settings juno', async () => {
    await openPage('Settings › Juno')
    await both(juno, '46-settings-juno')
    save('insets-settings-juno', await insets(win, 'main'))
    save('measure-settings-juno', await measure(win, 'main h1, main h2, main h3, main label, main button, main input, main select, main p'))
    await sweep(juno, 'settings-juno', 'main')
    await win.locator('main').evaluate((m) => m.querySelector('[data-scroll]')?.scrollTo(0, 99999))
    await both(juno, '46b-settings-juno-bottom')
    await win.locator('main').evaluate((m) => m.querySelector('[data-scroll]')?.scrollTo(0, 0))
    await win.locator('main').getByLabel('Chat model').focus()
    await both(juno, '46c-settings-model-focus')
    const options = await win.locator('main').getByLabel('Chat model').evaluate((s: HTMLSelectElement) => [...s.options].map((o) => o.textContent))
    save('settings-model-options', options)
  })

  for (const [n, label] of [
    ['47', 'Activity'],
    ['48', 'What Juno remembers'],
    ['49', 'Memory of this chat'],
    ['50', 'Scheduled'],
    ['51', 'Connections'],
  ] as const) {
    await step(`page ${label}`, async () => {
      await openPage(label)
      await both(juno, `${n}-page-${label.toLowerCase().replaceAll(' ', '-')}`)
      save(`measure-page-${n}`, await measure(win, 'main h1, main h2, main h3, main button, main p'))
      save(`insets-page-${n}`, await insets(win, 'main'))
    })
  }

  await step('add a server', async () => {
    await openPage('Connections')
    const form = win.locator('[data-add-server]')
    await form.scrollIntoViewIfNeeded()
    await win.mouse.move(1300, 850)
    await both(juno, '51b-add-a-server')
    await form.getByRole('textbox').first().focus()
    await win.keyboard.press('Shift+Tab')
    await win.keyboard.press('Tab')
    await both(juno, '51c-add-a-server-focus', form)
  })

  await step('paused banner', async () => {
    await openPage('Settings › Juno')
    await win.locator('main').getByLabel('Juno is paused').check()
    await juno.nav.back()
    await expect(win.locator('main [data-banner="paused"]')).toBeVisible()
    await both(juno, '52-juno-paused')
    await win.locator('main [data-banner="paused"]').getByRole('button', { name: 'Resume' }).click()
  })

  await step('panel narrow', async () => {
    await setSize(juno.app, 900, 700)
    await sidebar.row(POSTGRES).open()
    await tabs.menu('juno')
    await settle(win, 500)
    await both(juno, '53-panel-900')
  })

  flushLog('juno')
})
