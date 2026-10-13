/**
 * The M3 design-review harness: renders the signed-in shell against the fake
 * Slack in the states the review needs, writes screenshots to ../shots and
 * JSON evidence to ./out, and runs the break pass. Review tooling only.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { CONVERSATIONS, largeSeed, SELF_ID, startFakeSlack, type FakeSlack } from '../../../../packages/fake-slack/src/index.ts'
import { measureLayoutShift } from '../../../../packages/testing/src/layoutShift.ts'
import { Juno } from '../../../../apps/desktop/e2e/driver/juno'
import { expect, hooks, launchApp, tempUserData, test, writeSlackApp } from '../../../../apps/desktop/e2e/fixtures'
import { ARABIC, CJK, CJK_CHANNEL, EMOJI_ONLY, hostileSeed, LONG_CHANNEL, LONG_URL, UNBROKEN } from './hostile'

const shots = resolve(__dirname, '../shots')
const out = resolve(__dirname, 'out')
mkdirSync(shots, { recursive: true })
mkdirSync(out, { recursive: true })

const POSTGRES = 'Draft plan is in the doc.'
const RINA = 'Rina finished the onsite.'
const OFFSITE = 'Can eng take the Wednesday afternoon'
const ALERTS_MAIN = '#alerts-prod'

test.describe.configure({ timeout: 240_000 })

const shot = (win: Page, name: string) => win.screenshot({ path: join(shots, `${name}.png`) })
const save = (name: string, data: unknown) => writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2))

const setSize = (app: ElectronApplication, width: number, height: number) =>
  app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.setSize(size.width, size.height)
    return win.getContentSize()
  }, { width, height })

const setZoom = (app: ElectronApplication, factor: number) =>
  app.evaluate(({ BrowserWindow }, zoom) => {
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom)
  }, factor)

const settle = async (win: Page) => {
  await win.evaluate(() => document.fonts.ready)
  await win.waitForTimeout(250)
}

const park = (win: Page) => win.mouse.move(1100, 700)

/** A true capture of the window from the main process; Playwright's screenshot scales wrongly under page zoom. */
const capture = async (app: ElectronApplication, name: string) => {
  const base64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(shots, `${name}.png`), Buffer.from(base64, 'base64'))
}

/** Every text node under `root`: its colour against the colour behind it, with ancestor opacity folded in. */
const contrastSweep = (win: Page, root: string) =>
  win.evaluate((rootSelector) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
    }
    const over = (top: [number, number, number, number], bottom: [number, number, number, number], alpha = top[3]): [number, number, number, number] => [
      top[0] * alpha + bottom[0] * (1 - alpha),
      top[1] * alpha + bottom[1] * (1 - alpha),
      top[2] * alpha + bottom[2] * (1 - alpha),
      1,
    ]
    const lum = ([r, g, b]: [number, number, number, number]) => {
      const f = (c: number) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a: [number, number, number, number], b: [number, number, number, number]) => {
      const l1 = lum(a)
      const l2 = lum(b)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }
    const bodyBg = rgba(getComputedStyle(document.body).backgroundColor)
    const results: Array<{ text: string; fg: string; bg: string; ratio: number; opacity: number; size: string; weight: string; path: string }> = []
    const rootEl = document.querySelector(rootSelector)
    if (!rootEl) return results
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT)
    const seen = new Set<string>()
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? '').trim()
      if (!text) continue
      const el = node.parentElement
      if (!el) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      // Walk up: find the nearest painted background and the product of opacities above the text.
      let bg: [number, number, number, number] | undefined
      let opacity = 1
      let bgInsideOpacity = false
      let sawOpacity = false
      let cur: HTMLElement | null = el
      const path: string[] = []
      while (cur) {
        const s = getComputedStyle(cur)
        const o = parseFloat(s.opacity)
        if (o < 1) {
          opacity *= o
          sawOpacity = true
          if (bg === undefined) bgInsideOpacity = true
        }
        if (bg === undefined) {
          const c = rgba(s.backgroundColor)
          if (c[3] > 0) bg = c
        }
        if (path.length < 6) path.push(cur.tagName.toLowerCase() + (cur.getAttribute('role') ? `[${cur.getAttribute('role')}]` : ''))
        cur = cur.parentElement
      }
      void bgInsideOpacity
      void sawOpacity
      const backdrop = bodyBg
      const base = bg ?? backdrop
      const fg = rgba(cs.color)
      // The text and its own background both fade toward the backdrop by the ancestor opacity.
      const fgEff = over(over(fg, base), backdrop, opacity)
      const bgEff = over(base, backdrop, opacity)
      const r = ratio(fgEff, bgEff)
      const key = `${text}|${cs.color}|${r.toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ text: text.slice(0, 40), fg: cs.color, bg: base.map((v) => Math.round(v)).join(','), ratio: Math.round(r * 100) / 100, opacity, size: cs.fontSize, weight: cs.fontWeight, path: path.join('<') })
    }
    return results
  }, root)

/** Tab through the page from the start and record where focus lands and whether a ring shows. */
const tabOrder = async (win: Page, presses: number) => {
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const stops: Array<{ tag: string; role: string | null; name: string; ringVisible: boolean; outline: string; outlineColor: string }> = []
  for (let i = 0; i < presses; i++) {
    await win.keyboard.press('Tab')
    stops.push(
      await win.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return { tag: 'body', role: null, name: '', ringVisible: false, outline: '', outlineColor: '' }
        const cs = getComputedStyle(el)
        const labelled = el.getAttribute('aria-labelledby')
        const name = el.getAttribute('aria-label') ?? (labelled ? (document.getElementById(labelled)?.textContent ?? '') : (el.textContent ?? '').trim().slice(0, 40))
        return { tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), name, ringVisible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, outlineColor: cs.outlineColor }
      }),
    )
  }
  return stops
}

/** Console errors as a count plus the first ten that are not the CSP blocking the fake's avatar URLs. */
const errorSummary = (errors: ReadonlyArray<string>) => ({ count: errors.length, other: errors.filter((e) => !e.includes('Content Security Policy')).slice(0, 10) })

const consoleErrors = (win: Page) => {
  const errors: string[] = []
  win.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  win.on('pageerror', (error) => errors.push(String(error)))
  return errors
}

test('baseline: light and dark, hover, keyboard focus, accents, aria tree, contrast', async ({ juno, win, app }) => {
  const errors = consoleErrors(win)
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  await settle(win)
  await sidebar.row(POSTGRES).select()
  await park(win)
  await settle(win)
  await shot(win, '01-light-coral-selected')

  // Titles as rendered (the fallback ellipsis check).
  save('titles', await sidebar.titles())

  // Hover a row, then keyboard focus on a row and on its Resolve button.
  await sidebar.row(RINA).hover()
  await settle(win)
  await shot(win, '02-light-row-hover')
  await park(win)
  await win.keyboard.press('Shift')
  await sidebar.row(POSTGRES).focus()
  await settle(win)
  await shot(win, '03-light-row-focus')
  await win.keyboard.press('Tab')
  await settle(win)
  await shot(win, '04-light-resolve-focus')

  // The accessibility tree of the sidebar.
  const aria = await win.locator('aside').ariaSnapshot()
  writeFileSync(join(out, 'aria-sidebar-light.txt'), aria)

  // Contrast in light.
  await park(win)
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  save('contrast-light', await contrastSweep(win, 'aside'))
  save('contrast-light-workspace', await contrastSweep(win, 'section[aria-label="Workspace"]'))

  // Account menu open.
  await juno.accountMenu.open()
  await settle(win)
  await shot(win, '05-light-account-menu')
  // Accent claret.
  await juno.accountMenu.root.getByRole('button', { name: 'Claret' }).click()
  await juno.accountMenu.close()
  await park(win)
  await settle(win)
  await win.keyboard.press('Shift')
  await sidebar.row(POSTGRES).focus()
  await settle(win)
  await shot(win, '06-light-claret-focus')
  save('focus-ring-claret', await win.evaluate(() => getComputedStyle(document.activeElement!).outlineColor))

  // Dark, cyan.
  await sidebar.themeButton.click()
  await expect(win.locator('html')).not.toHaveAttribute('data-theme-switching', /.*/)
  await juno.accountMenu.open()
  await juno.accountMenu.root.getByRole('button', { name: 'Cyan' }).click()
  await settle(win)
  await shot(win, '07-dark-cyan-account-menu')
  await juno.accountMenu.close()
  await park(win)
  await settle(win)
  await shot(win, '08-dark-cyan-selected')
  await sidebar.row(RINA).hover()
  await settle(win)
  await shot(win, '09-dark-row-hover')
  await park(win)
  save('contrast-dark', await contrastSweep(win, 'aside'))
  save('contrast-dark-workspace', await contrastSweep(win, 'section[aria-label="Workspace"]'))

  // Back to coral in dark for the plain dark shot.
  await juno.accountMenu.open()
  await juno.accountMenu.root.getByRole('button', { name: 'Coral' }).click()
  await juno.accountMenu.close()
  await park(win)
  await settle(win)
  await shot(win, '10-dark-coral')
  save('console-errors-baseline', errorSummary(errors))
  void app
})

test('keyboard only: tab order, focus rings, reaching Resolve on a non-selected row', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  await park(win)
  const order = await tabOrder(win, 16)
  save('tab-order', order)

  // Arrow down to the third row, then Tab: where does focus go?
  await win.keyboard.press('Shift')
  await sidebar.rows.first().focus()
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('ArrowDown')
  const focusedTitle = await win.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const id = el.getAttribute('aria-labelledby')
    return { tabindex: el.getAttribute('tabindex'), title: id ? document.getElementById(id)?.textContent : null, slotOpacity: getComputedStyle(el.querySelector('button')!.parentElement!).opacity }
  })
  await shot(win, '11-keyboard-third-row-focus')
  await win.keyboard.press('Tab')
  const afterTab = await win.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const row = el.closest('[data-topic-row]')
    const id = row?.getAttribute('aria-labelledby')
    return { tag: el.tagName.toLowerCase(), label: el.getAttribute('aria-label'), rowTitle: id ? document.getElementById(id)?.textContent : null, tabindex: el.getAttribute('tabindex') }
  })
  save('keyboard-resolve-reach', { focusedTitle, afterTab })

  // Enter selects; then Tab reaches Resolve of the selected row.
  await win.keyboard.press('Shift+Tab')
  await win.keyboard.press('Enter')
  await win.keyboard.press('Tab')
  const afterEnterTab = await win.evaluate(() => (document.activeElement as HTMLElement).getAttribute('aria-label'))
  save('keyboard-resolve-after-enter', afterEnterTab)
  await shot(win, '12-keyboard-resolve-after-enter')

  // Scrollbar while scrolling by keyboard only: is there any scroll indicator?
  await win.keyboard.press('Shift+Tab')
  await win.keyboard.press('End')
  await settle(win)
  await shot(win, '13-keyboard-end-no-pointer')
  save('scrollbar-keyboard-only', await sidebar.list.evaluate((node) => ({ thumb: getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor, scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })))
})

test('window sizes and 200% zoom', async ({ juno, win, app }) => {
  await juno.signIn()
  await juno.waitForSync()
  const geometry = () =>
    win.evaluate(() => {
      const aside = document.querySelector('aside')!
      const workspace = document.querySelector('section[aria-label="Workspace"]')!
      const icons = Array.from(document.querySelectorAll('aside header button')).map((b) => {
        const r = b.getBoundingClientRect()
        return { name: b.getAttribute('aria-label'), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), height: Math.round(r.height) }
      })
      const list = document.querySelector('[aria-label="Topics"]')!
      const empty = document.querySelector('main')!.getBoundingClientRect()
      return {
        zoom: window.devicePixelRatio,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        aside: { width: aside.getBoundingClientRect().width, right: aside.getBoundingClientRect().right },
        workspace: { width: workspace.getBoundingClientRect().width, left: workspace.getBoundingClientRect().left },
        icons,
        listHeight: list.clientHeight,
        visibleRows: Array.from(list.querySelectorAll('[data-topic-row]')).filter((r) => {
          const b = r.getBoundingClientRect()
          const l = list.getBoundingClientRect()
          return b.top >= l.top && b.bottom <= l.bottom
        }).length,
        emptyBox: { width: Math.round(empty.width), height: Math.round(empty.height) },
      }
    })
  const report: Record<string, unknown> = {}
  await park(win)
  report['1200x800'] = await geometry()
  await setSize(app, 720, 480)
  await settle(win)
  await shot(win, '14-narrow-720x480')
  report['720x480'] = await geometry()
  await setSize(app, 1920, 1080)
  await settle(win)
  await shot(win, '15-wide-1920x1080')
  report['1920x1080'] = await geometry()
  await setSize(app, 1200, 800)
  await setZoom(app, 2)
  await settle(win)
  await capture(app, '16-zoom-200-1200x800')
  report['1200x800@2'] = await geometry()
  await setSize(app, 720, 480)
  await settle(win)
  await capture(app, '17-zoom-200-720x480')
  report['720x480@2'] = await geometry()
  // Account menu at 200% in the narrow window.
  await juno.accountMenu.open()
  await settle(win)
  await capture(app, '18-zoom-200-720x480-menu')
  report['menu@2'] = await juno.accountMenu.root.evaluate((node) => {
    const r = node.getBoundingClientRect()
    return { left: r.left, right: r.right, bottom: r.bottom, innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }
  })
  await juno.accountMenu.close()
  await setZoom(app, 1)
  save('geometry', report)
})

test('reduced motion and motion tokens', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  const read = () =>
    win.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const row = document.querySelector('[data-topic-row]')!
      const button = document.querySelector('aside header button')!
      return {
        durationFast: root.getPropertyValue('--duration-fast'),
        durationAppear: root.getPropertyValue('--duration-appear'),
        stagger: root.getPropertyValue('--stagger'),
        pressScale: root.getPropertyValue('--press-scale'),
        riseStagger: root.getPropertyValue('--rise-stagger'),
        rowTransition: getComputedStyle(row).transitionProperty + ' ' + getComputedStyle(row).transitionDuration,
        buttonTransition: getComputedStyle(button).transitionProperty + ' ' + getComputedStyle(button).transitionDuration,
      }
    })
  const motionOn = await read()
  await win.emulateMedia({ reducedMotion: 'reduce' })
  const motionReduced = await read()
  // Open the empty state under reduced motion and read the animation.
  await sidebar.toggleUnread()
  await sidebar.filter('DMs')
  await sidebar.filter('Channels')
  await sidebar.filter('All')
  // Force an empty state: unread only in a group with nothing unread is not available in the seed, so use the popover instead.
  await juno.accountMenu.open()
  const popover = await juno.accountMenu.root.evaluate((node) => {
    const panel = node.closest('[class]') as HTMLElement
    let cur: HTMLElement | null = panel
    const found: string[] = []
    while (cur && found.length < 3) {
      const cs = getComputedStyle(cur)
      if (cs.animationName !== 'none') found.push(`${cs.animationName} ${cs.animationDuration}`)
      cur = cur.parentElement
    }
    return found
  })
  await juno.accountMenu.close()
  save('motion', { motionOn, motionReduced, popoverUnderReducedMotion: popover })
  await win.emulateMedia({ reducedMotion: 'no-preference' })
})

test('empty states in the app: caught up, filtered, and the stagger replays on every filter change', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  for (const channel of ['D0MAYA', 'D0SAM', 'G0MAYALEO']) {
    const last = fake.messages(channel).at(-1)!
    fake.markRead({ channel, ts: last.ts })
    for (const root of fake.messages(channel).filter((message) => message.reply_count !== undefined && message.reply_count > 0)) {
      fake.markThreadRead({ channel, threadTs: root.ts, ts: last.ts })
    }
  }
  await sidebar.filter('DMs')
  await sidebar.toggleUnread()
  await sidebar.expectEmpty("You're all caught up")
  await settle(win)
  await park(win)
  await shot(win, '19-empty-caught-up')
  // Does the entrance replay when the state was visible a moment ago?
  const animated = async () =>
    win.evaluate(() => {
      const title = Array.from(document.querySelectorAll('aside h2')).find((h) => h.textContent?.includes('caught up'))
      if (!title) return null
      const cs = getComputedStyle(title)
      return { animationName: cs.animationName, duration: cs.animationDuration, delay: cs.animationDelay }
    })
  const first = await animated()
  await sidebar.toggleUnread()
  await sidebar.toggleUnread()
  const second = await animated()
  save('empty-state-entrance', { first, second })
  await sidebar.themeButton.click()
  await settle(win)
  await shot(win, '20-empty-caught-up-dark')
})

test('quiet workspace: nothing in the last 7 days', async () => {
  // A fake whose clock sits 30 days back, so every seeded message is older than the quiet window.
  const fake = await startFakeSlack({ now: Date.now() - 30 * 24 * 60 * 60 * 1000 })
  const userData = await tempUserData()
  try {
    // Everything read, so only the quiet window decides.
    for (const conversation of CONVERSATIONS) {
      if (!conversation.members.includes(SELF_ID)) continue
      const all = fake.messages(conversation.id)
      const last = all.at(-1)
      if (last === undefined) continue
      fake.markRead({ channel: conversation.id, ts: last.ts })
      for (const root of all.filter((message) => message.reply_count !== undefined && message.reply_count > 0)) {
        fake.markThreadRead({ channel: conversation.id, threadTs: root.ts, ts: last.ts })
      }
    }
    const app = await writeSlackApp(fake, await mkdtemp(join(tmpdir(), 'juno-review-app-')))
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: app.dir, keychainPassword: app.keychainPassword })
    const juno = new Juno(running.app, running.win)
    await juno.signIn()
    await juno.sidebar.expectVisible()
    await running.win.waitForTimeout(4000)
    await settle(running.win)
    await park(running.win)
    await shot(running.win, '21-empty-quiet')
    const text = await juno.sidebar.list.textContent()
    const buttons = await juno.sidebar.list.getByRole('button').allTextContents()
    save('empty-quiet', { text, buttons })
    await running.close()
  } finally {
    await fake.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('pinned, pinned-resolved and unsubscribed rows through the user overlay', async ({ fake, slackApp }) => {
  const userData = await tempUserData()
  try {
    const first = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    const juno1 = new Juno(first.app, first.win)
    await juno1.signIn()
    await juno1.waitForSync()
    await first.close()
    // Find user.db and write overlay rows.
    const find = (dir: string): string | undefined => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (entry === 'user.db') return full
        if (statSync(full).isDirectory()) {
          const hit = find(full)
          if (hit) return hit
        }
      }
      return undefined
    }
    const db = find(userData)!
    const root = (channel: string, prefix: string) => fake.messages(channel).find((m) => m.text?.startsWith(prefix))!.ts
    const postgres = `t:C0ENG:${root('C0ENG', POSTGRES)}`
    const offsite = `t:D0MAYA:${root('D0MAYA', OFFSITE)}`
    const rina = `t:C0HIRING:${root('C0HIRING', RINA)}`
    const now = String(Date.now())
    execFileSync('sqlite3', [
      db,
      `INSERT OR REPLACE INTO topic_overlay (topic_id, pinned_at) VALUES ('${postgres}', '${now}'), ('m:C0ALERTSPROD', '${now}');
       INSERT OR REPLACE INTO topic_overlay (topic_id, pinned_at, resolved_at, resolved_activity_ts) VALUES ('${offsite}', '${now}', '${now}', '${root('D0MAYA', OFFSITE)}');
       INSERT OR REPLACE INTO topic_overlay (topic_id, unsubscribed_at) VALUES ('${rina}', '${now}');`,
    ])
    const dump = {
      db,
      overlay: execFileSync('sqlite3', [db, 'SELECT topic_id, pinned_at, resolved_at, unsubscribed_at FROM topic_overlay']).toString(),
      index: execFileSync('sqlite3', [db.replace('user.db', 'cache.db'), "SELECT topic_id FROM topic_index WHERE topic_id LIKE 't:C0ENG:%' OR topic_id LIKE 'm:C0ALERTS%' LIMIT 12"]).toString(),
      files: readdirSync(db.replace('/user.db', '')),
    }
    save('overlay-db', dump)
    const again = await launchApp(userData, { fakeSlackUrl: fake.url })
    const juno = new Juno(again.app, again.win)
    await juno.sidebar.expectRows()
    await again.win.waitForTimeout(2000)
    await settle(again.win)
    await park(again.win)
    await shot(again.win, '22-pinned-recent-overlay')
    const sections = {
      pinned: await juno.sidebar.titles('Pinned').catch(() => []),
      recent: await juno.sidebar.titles('Recent').catch(() => []),
      headings: await juno.sidebar.list.getByRole('heading').allTextContents(),
      dimmedRows: await again.win.evaluate(() =>
        Array.from(document.querySelectorAll('[data-topic-row]'))
          .filter((row) => parseFloat(getComputedStyle(row).opacity) < 1)
          .map((row) => ({ title: document.getElementById(row.getAttribute('aria-labelledby')!)?.textContent, opacity: getComputedStyle(row).opacity })),
      ),
    }
    save('overlay-sections', sections)
    save('contrast-light-overlay', await contrastSweep(again.win, 'aside'))
    // Sticky headers: scroll the list and read where the Pinned label sits.
    const sticky = await juno.sidebar.list.evaluate((list) => {
      list.scrollTop = 150
      const label = list.querySelector('h2')!
      const l = list.getBoundingClientRect()
      const r = label.getBoundingClientRect()
      return { listTop: l.top, labelTop: r.top, scrollTop: list.scrollTop }
    })
    save('sticky-header', sticky)
    await settle(again.win)
    await shot(again.win, '23-pinned-scrolled-sticky')
    await juno.sidebar.themeButton.click()
    await settle(again.win)
    await park(again.win)
    save('contrast-dark-overlay', await contrastSweep(again.win, 'aside'))
    await shot(again.win, '24-pinned-recent-overlay-dark')
    await again.close()
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('break pass: hostile titles, names, counts, scripts and emoji', async () => {
  const fake = await startFakeSlack({ seed: hostileSeed })
  const userData = await tempUserData()
  try {
    const app = await writeSlackApp(fake, await mkdtemp(join(tmpdir(), 'juno-review-app-')))
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: app.dir, keychainPassword: app.keychainPassword })
    const win = running.win
    const errors = consoleErrors(win)
    const juno = new Juno(running.app, win)
    await juno.signIn()
    await juno.waitForSync()
    await settle(win)
    await park(win)
    await shot(win, '25-hostile-top')
    const titles = await juno.sidebar.titles()
    // Per-row overflow report: anything drawn outside its row or wider than the list.
    const overflow = await win.evaluate(() => {
      const list = document.querySelector('[aria-label="Topics"]')!
      const listRect = list.getBoundingClientRect()
      return Array.from(list.querySelectorAll('[data-topic-row]')).map((row) => {
        const r = row.getBoundingClientRect()
        const titleEl = document.getElementById(row.getAttribute('aria-labelledby')!)!
        const wide: string[] = []
        for (const el of Array.from(row.querySelectorAll('*'))) {
          const b = el.getBoundingClientRect()
          if (b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5)) wide.push(`${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 20)} right=${Math.round(b.right)}`)
        }
        return {
          title: titleEl.textContent?.slice(0, 50),
          rowWidth: Math.round(r.width),
          rowRight: Math.round(r.right),
          listRight: Math.round(listRect.right),
          rowScrollWidth: (row as HTMLElement).scrollWidth,
          rowClientWidth: (row as HTMLElement).clientWidth,
          titleScrollWidth: titleEl.scrollWidth,
          titleClientWidth: titleEl.clientWidth,
          titleTruncated: titleEl.scrollWidth > titleEl.clientWidth,
          titleHasTooltip: titleEl.getAttribute('title') ?? row.getAttribute('title'),
          height: Math.round(r.height),
          dir: getComputedStyle(titleEl).direction,
          tile: (row.querySelector('span[aria-hidden="true"]') as HTMLElement | null)?.textContent?.slice(0, 4),
          badges: Array.from(row.querySelectorAll('[title]')).map((b) => `${b.getAttribute('title')}=${b.textContent}`),
          outside: wide.slice(0, 5),
        }
      })
    })
    save('hostile-rows', { titles, overflow })
    // Screenshots of each hostile row scrolled into view.
    const find = (prefix: string) => juno.sidebar.row(prefix)
    const targets: Array<[string, string]> = [
      ['26-hostile-unbroken', UNBROKEN.slice(0, 20)],
      ['27-hostile-url', LONG_URL.slice(0, 20)],
      ['28-hostile-cjk', CJK.slice(0, 6)],
      ['29-hostile-arabic', ARABIC.slice(0, 6)],
      ['30-hostile-emoji', EMOJI_ONLY],
      ['31-hostile-long-channel-main', `#${LONG_CHANNEL.slice(0, 20)}`],
      ['32-hostile-cjk-channel', CJK_CHANNEL.slice(0, 4)],
    ]
    for (const [name, prefix] of targets) {
      const row = find(prefix)
      if ((await row.root.count()) === 0) {
        save(`${name}-missing`, { prefix })
        continue
      }
      await row.root.scrollIntoViewIfNeeded()
      await row.hover()
      await settle(win)
      await shot(win, name)
    }
    await park(win)
    await juno.sidebar.themeButton.click()
    await settle(win)
    await shot(win, '33-hostile-top-dark')
    save('console-errors-hostile', errorSummary(errors))
    await running.close()
  } finally {
    await fake.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('break pass: large seed, window full, resize while scrolled, keyboard repeat, rapid filters', async () => {
  test.setTimeout(600_000)
  const fake = await startFakeSlack({ seed: largeSeed() })
  const userData = await tempUserData()
  try {
    const app = await writeSlackApp(fake, await mkdtemp(join(tmpdir(), 'juno-review-app-')))
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: app.dir, keychainPassword: app.keychainPassword })
    const win = running.win
    const errors = consoleErrors(win)
    const juno = new Juno(running.app, win)
    await juno.signIn()
    await expect(juno.sidebar.rows.first()).toBeVisible({ timeout: 240_000 })
    await juno.accountMenu.open()
    await expect(juno.accountMenu.engineStatus).toHaveText('Engine live', { timeout: 240_000 })
    await juno.accountMenu.close()
    await park(win)
    await settle(win)
    const count = await juno.sidebar.rows.count()
    const footer = await juno.sidebar.list.getByText('Older topics are in All topics').count()
    await shot(win, '34-large-top')
    // Scroll to the middle, remember the anchor row, resize, compare.
    const list = juno.sidebar.list
    await list.hover({ position: { x: 100, y: 100 } })
    await win.mouse.wheel(0, 6000)
    await win.waitForTimeout(300)
    const before = await list.evaluate((node) => {
      const rows = Array.from(node.querySelectorAll('[data-topic-row]'))
      const l = node.getBoundingClientRect()
      const anchor = rows.find((r) => r.getBoundingClientRect().top >= l.top)!
      return { id: anchor.getAttribute('data-topic-id'), top: anchor.getBoundingClientRect().top - l.top, scrollTop: node.scrollTop }
    })
    await setSize(running.app, 900, 600)
    await win.waitForTimeout(300)
    const after = await list.evaluate((node, id) => {
      const anchor = node.querySelector(`[data-topic-id="${id}"]`)!
      const l = node.getBoundingClientRect()
      return { top: anchor.getBoundingClientRect().top - l.top, scrollTop: node.scrollTop }
    }, before.id)
    await shot(win, '35-large-resized-while-scrolled')
    await setSize(running.app, 1200, 800)
    await win.waitForTimeout(300)
    const restored = await list.evaluate((node, id) => {
      const anchor = node.querySelector(`[data-topic-id="${id}"]`)!
      const l = node.getBoundingClientRect()
      return { top: anchor.getBoundingClientRect().top - l.top, scrollTop: node.scrollTop }
    }, before.id)
    // Scroll to the end and screenshot the footer.
    await list.hover({ position: { x: 100, y: 100 } })
    await win.mouse.wheel(0, 100000)
    await win.waitForTimeout(300)
    await shot(win, '36-large-end-footer')
    // Keyboard repeat: 120 ArrowDowns as fast as the harness can send them.
    await park(win)
    await win.keyboard.press('Shift')
    await juno.sidebar.rows.first().focus()
    const started = Date.now()
    for (let i = 0; i < 120; i++) await win.keyboard.press('ArrowDown', { delay: 0 })
    const repeatMs = Date.now() - started
    const focusedIndex = await win.evaluate(() => Array.from(document.querySelectorAll('[data-topic-row]')).indexOf(document.activeElement as HTMLElement))
    await shot(win, '37-large-after-keyboard-repeat')
    // Rapid filter clicks.
    const t0 = Date.now()
    for (let i = 0; i < 15; i++) {
      await juno.sidebar.filterButton('Channels').click({ delay: 0 })
      await juno.sidebar.filterButton('DMs').click({ delay: 0 })
      await juno.sidebar.unreadToggle.click({ delay: 0 })
    }
    const rapidMs = Date.now() - t0
    await win.waitForTimeout(500)
    // The app's own filter-change measure (click to paint), from docs/performance.md 1: 50 ms.
    const filterMeasures = await win.evaluate(() => performance.getEntriesByName('juno.filter', 'measure').map((entry) => Math.round(entry.duration)))
    const imgCount = await win.evaluate(() => document.querySelectorAll('aside img').length)
    const finalState = {
      channels: await juno.sidebar.filterButton('Channels').getAttribute('aria-pressed'),
      dms: await juno.sidebar.filterButton('DMs').getAttribute('aria-pressed'),
      unread: await juno.sidebar.unreadToggle.getAttribute('aria-pressed'),
      rows: await juno.sidebar.rows.count(),
    }
    await shot(win, '38-large-after-rapid-filters')
    // Does toggling a filter move the other filter buttons (weight change)?
    const filterBoxes = () => win.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Quick filters"] button')).map((b) => ({ name: b.getAttribute('aria-label'), left: b.getBoundingClientRect().left, width: b.getBoundingClientRect().width })))
    await juno.sidebar.filter('All')
    if (finalState.unread === 'true') await juno.sidebar.toggleUnread()
    const boxesAll = await filterBoxes()
    await juno.sidebar.filter('Channels')
    const boxesChannels = await filterBoxes()
    const shiftOnFilter = await measureLayoutShift(win, () => juno.sidebar.filterButton('DMs').click(), { root: 'aside' })
    save('large-seed', { count, footer, before, after, restored, repeatMs, focusedIndex, rapidMs, filterMeasures, imgCount, finalState, boxesAll, boxesChannels, shiftOnFilter: { shifts: shiftOnFilter.shifts.slice(0, 5), moved: shiftOnFilter.moved.slice(0, 8) }, errors: errorSummary(errors) })
    await running.close()
  } finally {
    await fake.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('break pass: live message while hovering, socket drop, engine crash, engine failure, session expiry', async ({ juno, win, fake, app }) => {
  const errors = consoleErrors(win)
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  // Hover the Postgres row (second from top) and inject a reply into the Offsite DM thread, which jumps to the top.
  const postgres = sidebar.row(POSTGRES)
  await postgres.hover()
  const pointer = await postgres.root.boundingBox()
  const underBefore = await win.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-topic-row]')?.getAttribute('data-topic-id'), [pointer!.x + pointer!.width / 2, pointer!.y + pointer!.height / 2])
  const root = fake.messages('D0MAYA').find((m) => m.text?.startsWith(OFFSITE))!
  fake.injectMessage({ channel: 'D0MAYA', threadTs: root.ts, user: 'U0MAYA', text: 'Moving this to the top while you hover.' })
  await expect.poll(() => sidebar.titles().then((t) => t[0])).toMatch(/^Can eng take/)
  await win.waitForTimeout(200)
  const hoverState = await win.evaluate(([x, y]) => {
    const under = document.elementFromPoint(x, y)?.closest('[data-topic-row]') as HTMLElement | null
    const rows = Array.from(document.querySelectorAll('[data-topic-row]')) as HTMLElement[]
    const hovered = rows.filter((r) => r.matches(':hover')).map((r) => r.getAttribute('data-topic-id'))
    const slots = rows.filter((r) => getComputedStyle(r.querySelector('button')!.parentElement!).opacity === '1').map((r) => r.getAttribute('data-topic-id'))
    return { under: under?.getAttribute('data-topic-id'), hovered, resolveShown: slots }
  }, [pointer!.x + pointer!.width / 2, pointer!.y + pointer!.height / 2])
  await settle(win)
  await shot(win, '39-live-message-while-hovering')
  save('live-while-hover', { underBefore, hoverState })

  // Socket drop: what does the user see?
  await park(win)
  fake.dropSocket()
  await win.waitForTimeout(1500)
  await juno.accountMenu.open()
  const afterDrop = await juno.accountMenu.engineStatus.textContent()
  await shot(win, '40-socket-dropped-menu')
  await juno.accountMenu.close()

  // Engine crash: sample the list every 16ms for 3s to catch an empty flash.
  const pid = await hooks(app, 'enginePid')
  const sampler = win.evaluate(() => {
    const samples: Array<{ t: number; rows: number; empty: boolean }> = []
    const list = () => document.querySelector('[aria-label="Topics"]')
    return new Promise<typeof samples>((done) => {
      const start = performance.now()
      const tick = () => {
        const l = list()
        samples.push({ t: Math.round(performance.now() - start), rows: l ? l.querySelectorAll('[data-topic-row]').length : -1, empty: Boolean(l?.querySelector('h2')?.textContent?.match(/quiet|caught|Nothing/)) })
        if (performance.now() - start < 3000) setTimeout(tick, 16)
        else done(samples)
      }
      tick()
    })
  })
  process.kill(pid!, 'SIGKILL')
  const samples = await sampler
  const distinct = [...new Set(samples.map((s) => `${s.rows}:${s.empty}`))]
  await juno.accountMenu.open()
  await expect(juno.accountMenu.engineStatus).toHaveText(/Engine (live|catching|ready|starting|restarting).*/, { timeout: 30_000 })
  const afterCrash = await juno.accountMenu.engineStatus.textContent()
  await juno.accountMenu.close()
  await sidebar.row(POSTGRES).expectVisible()

  // Engine gives up.
  await hooks(app, 'failEngine')
  await win.waitForTimeout(2000)
  await shot(win, '41-engine-failed')
  const failedText = await win.locator('body').innerText()
  await juno.accountMenu.open()
  const failedStatus = await juno.accountMenu.engineStatus.textContent().catch(() => null)
  await shot(win, '42-engine-failed-menu')
  await juno.accountMenu.close()
  save('engine', { afterDrop, crashSamples: distinct, afterCrash, failedStatus, failedTextHead: failedText.slice(0, 300), errors: errorSummary(errors) })
})

test('scroll: the off-screen row estimate against the real row height', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const list = juno.sidebar.list
  const measure = () =>
    list.evaluate((node) => {
      const rows = Array.from(node.querySelectorAll('[data-topic-row]')) as HTMLElement[]
      return {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
        heights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
        estimate: getComputedStyle(rows[0]!).containIntrinsicSize,
        padding: getComputedStyle(rows[0]!).paddingTop,
      }
    })
  const top = await measure()
  await list.hover({ position: { x: 100, y: 100 } })
  for (let i = 0; i < 12; i++) {
    await win.mouse.wheel(0, 300)
    await win.waitForTimeout(80)
  }
  const bottom = await measure()
  for (let i = 0; i < 12; i++) {
    await win.mouse.wheel(0, -300)
    await win.waitForTimeout(80)
  }
  const back = await measure()
  save('scroll-estimate', { top, bottom, back })
})

test('break pass: filter change timing on the large seed', async () => {
  test.setTimeout(900_000)
  const fake = await startFakeSlack({ seed: largeSeed() })
  const userData = await tempUserData()
  try {
    const app = await writeSlackApp(fake, await mkdtemp(join(tmpdir(), 'juno-review-app-')))
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: app.dir, keychainPassword: app.keychainPassword })
    const win = running.win
    const juno = new Juno(running.app, win)
    await juno.signIn()
    await expect(juno.sidebar.rows.first()).toBeVisible({ timeout: 240_000 })
    await juno.accountMenu.open()
    await expect(juno.accountMenu.engineStatus).toHaveText('Engine live', { timeout: 240_000 })
    await juno.accountMenu.close()
    await park(win)
    await win.waitForTimeout(2000)
    const clicks: Array<{ name: string; wallMs: number; rows: number; imgs: number }> = []
    const sequence: Array<'Channels' | 'DMs' | 'All' | 'unread'> = ['Channels', 'DMs', 'All', 'unread', 'Channels', 'unread', 'All']
    for (const name of sequence) {
      const button = name === 'unread' ? juno.sidebar.unreadToggle : juno.sidebar.filterButton(name)
      const box = (await button.boundingBox())!
      const t0 = Date.now()
      // A raw press, so the driver's own actionability waits do not count.
      await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await win.waitForTimeout(1500)
      const wallMs = Date.now() - t0 - 1500
      const state = await win.evaluate(() => ({ rows: document.querySelectorAll('[data-topic-row]').length, imgs: document.querySelectorAll('aside img').length }))
      clicks.push({ name, wallMs, ...state })
    }
    const filterMeasures = await win.evaluate(() => performance.getEntriesByName('juno.filter', 'measure').map((entry) => Math.round(entry.duration)))
    const longTasks = await win.evaluate(
      () =>
        new Promise<number[]>((done) => {
          const seen: number[] = []
          try {
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) seen.push(Math.round(entry.duration))
            })
            observer.observe({ type: 'long-animation-frame', buffered: true })
            setTimeout(() => {
              observer.disconnect()
              done(seen)
            }, 100)
          } catch {
            done(seen)
          }
        }),
    )
    save('filter-timing', { clicks, filterMeasures, longAnimationFrames: longTasks })
    await running.close()
  } finally {
    await fake.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('break pass: session expiry', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  fake.expireSession()
  fake.dropSocket()
  await win.waitForTimeout(3000)
  await shot(win, '43-session-expired')
  const text = await win.locator('body').innerText()
  save('session-expired', { textHead: text.slice(0, 400) })
})
