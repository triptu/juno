import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { DemoPageHandle } from '../../web/demo/page/handle'
import type { DemoSnapshot } from '@juno/state/demo'

/**
 * The read-only demo (docs/development.md, "Demo") as a visitor gets it: the
 * production build in `web/demo/dist/` (the `build-demo` step), served as
 * plain files under `/try/` with no engine, socket or host. A walk through
 * everything the demo shows must find an answer in the snapshot for every
 * request the renderer makes, show each topic whole, and fetch nothing but
 * the folder's own files. What the demo cannot do (pages, writing, ⌘K) is
 * not there to find, by pointer, menu or key.
 */
const DIST = resolve(import.meta.dirname, '../../web/demo/dist')
const BASE = '/try/'
const TYPES: Readonly<Record<string, string>> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

/** A static file server for the folder: GET and HEAD of files under `BASE`, nothing else. */
async function serveFolder(): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://demo').pathname)
    const inside = path.startsWith(BASE) ? normalize(path.slice(BASE.length) || 'index.html') : undefined
    if ((request.method !== 'GET' && request.method !== 'HEAD') || inside === undefined || inside.startsWith('..')) {
      response.writeHead(404).end()
      return
    }
    readFile(join(DIST, inside)).then(
      (body) => response.writeHead(200, { 'content-type': TYPES[extname(inside)] ?? 'application/octet-stream' }).end(body),
      () => response.writeHead(404).end(),
    )
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return { url: `http://127.0.0.1:${address.port}${BASE}`, close: () => new Promise((done) => server.close(() => done())) }
}

const DAY_MS = 86_400_000

const misses = (page: Page) => page.evaluate(() => (window as unknown as { __junoDemo: DemoPageHandle }).__junoDemo.misses().map((miss) => `${miss.tag} ${JSON.stringify(miss.payload)}`))

test('the demo shows every topic whole from its snapshot, over static files only', async ({ page }) => {
  const snapshot = JSON.parse(await readFile(join(DIST, 'demo/snapshot.json'), 'utf8')) as DemoSnapshot
  const listOf = (payload: string) => snapshot.lists[`topics.list ${payload}`]!
  const all = listOf('{"kind":"all","unreadOnly":false}')
  const titleOf = (id: string) => (all.rows[id] as { readonly title: string }).title
  const messagesOf = (title: string) => snapshot.lists[`messages.list ${JSON.stringify({ id: all.order.find((id) => titleOf(id) === title) })}`]!.order.length
  const site = await serveFolder()
  const elsewhere: Array<string> = []
  const errors: Array<string> = []
  page.on('request', (request) => {
    if (!request.url().startsWith(site.url) || request.method() !== 'GET') elsewhere.push(`${request.method()} ${request.url()}`)
  })
  page.on('websocket', (socket) => elsewhere.push(`websocket ${socket.url()}`))
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(site.url)
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
    const main = page.getByRole('main')
    const rows = sidebar.getByRole('listitem')
    const selectedTab = page.getByRole('tablist', { name: 'Tabs' }).getByRole('tab', { selected: true })
    // Another tab's topic stays mounted, hidden.
    const shownMessages = main.locator('[data-message-row]').filter({ visible: true })
    // The selected tab's full title, its tooltip; its text also holds an avatar's initial. A Main's is its channel's name.
    const expectOpen = (title: string) => expect(selectedTab).toHaveAttribute('data-tooltip', title.replace(/^#/, ''))
    await expect(rows).toHaveCount(all.order.length)

    await test.step('the window offers reading only', async () => {
      await expect(sidebar.getByText('Demo · sample conversations')).toBeVisible()
      await expect(sidebar.getByRole('navigation', { name: 'Pages' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^(Search|All topics|Home|Account and settings|New tab|Close tab|New view)$/ })).toHaveCount(0)
      await expect(shownMessages.first()).toBeVisible()
      await shownMessages.first().hover()
      await expect(main.getByRole('textbox')).toHaveCount(0)
      await expect(main.getByRole('button', { name: /^(More actions|Resolve|Reopen|Follow|Juno)$/ })).toHaveCount(0)
    })

    await test.step('every topic in the sidebar opens with all its messages', async () => {
      for (const [index, id] of all.order.entries()) {
        await rows.nth(index).click()
        await expectOpen(titleOf(id))
        await expect(shownMessages).toHaveCount(messagesOf(titleOf(id)))
      }
    })

    await test.step('the quick filters, Automated and Unread only list from the snapshot', async () => {
      const filters = sidebar.getByRole('group', { name: 'Quick filters' })
      // A group's name says ", unread" while it has unread topics and is not selected.
      const quick = (name: string) => filters.getByRole('button', { name: new RegExp(`^${name}(,|$)`) })
      for (const [filter, kind] of [['Channels', 'channels'], ['DMs', 'dms'], ['All', 'all']] as const) {
        await quick(filter).click()
        await expect(rows).toHaveCount(listOf(`{"kind":"${kind}","unreadOnly":false}`).order.length)
      }
      await quick('Automated').click()
      await expect(quick('Automated')).toHaveAttribute('aria-pressed', 'true')
      await quick('All').click()
      await filters.getByRole('button', { name: 'Unread only' }).click()
      await expect(filters.getByRole('button', { name: 'Unread only' })).toHaveAttribute('aria-pressed', 'true')
      await expect(rows).toHaveCount(listOf('{"kind":"all","unreadOnly":true}').order.length)
      await filters.getByRole('button', { name: 'Unread only' }).click()
      await expect(rows).toHaveCount(all.order.length)
    })

    await test.step("a channel's pill scopes the sidebar to it", async () => {
      await sidebar.getByRole('listitem', { name: '#eng' }).click()
      await main.getByRole('button', { name: /^eng, public channel/ }).click()
      await expect(sidebar.getByRole('button', { name: 'Show everything' })).toBeVisible()
      await expect(rows).toHaveCount(listOf('{"kind":"all","scope":"C0ENG","unreadOnly":false}').order.length)
      await sidebar.getByRole('button', { name: 'Show everything' }).click()
      await expect(rows).toHaveCount(all.order.length)
    })

    await test.step("a thread link in Main opens the thread, and Back and Forward move between them", async () => {
      await sidebar.getByRole('listitem', { name: '#eng' }).click()
      await expectOpen('eng')
      await main.getByRole('button', { name: /^5 replies/ }).click()
      await expectOpen('Release 2.4 goes out Thursday')
      await expect(shownMessages).toHaveCount(messagesOf('Release 2.4 goes out Thursday'))
      await page.keyboard.press('Meta+[')
      await expectOpen('eng')
      await page.keyboard.press('Meta+]')
      await expectOpen('Release 2.4 goes out Thursday')
    })

    await test.step('a topic opens in a second tab, and the tabs switch', async () => {
      const tabs = page.getByRole('tablist', { name: 'Tabs' }).getByRole('tab')
      await sidebar.getByRole('listitem', { name: 'Jonas' }).click({ modifiers: ['Meta'] })
      await expect(tabs).toHaveCount(2)
      await tabs.filter({ hasText: 'Jonas' }).click()
      await expectOpen('Jonas')
      await expect(shownMessages).toHaveCount(messagesOf('Jonas'))
      await tabs.filter({ hasText: 'Release 2.4' }).click()
      await expectOpen('Release 2.4 goes out Thursday')
    })

    await test.step('holding Option over a row peeks at the topic', async () => {
      await sidebar.getByRole('listitem', { name: 'Widget crashes on small phones' }).hover()
      await page.keyboard.down('Alt')
      await expect(page.locator('[role="dialog"][aria-roledescription="peek"] [data-message-row]')).toHaveCount(messagesOf('Widget crashes on small phones'))
      await page.keyboard.up('Alt')
    })

    await test.step('the menus offer only Open in new tab and closing tabs', async () => {
      const tabs = page.getByRole('tablist', { name: 'Tabs' }).getByRole('tab')
      const menu = page.getByRole('menu', { name: 'Context menu' })
      const before = await tabs.count()
      await sidebar.getByRole('listitem', { name: 'Jonas' }).click({ button: 'right' })
      await expect(menu.getByRole('menuitem')).toHaveText(['Open in new tab'])
      await menu.getByRole('menuitem', { name: 'Open in new tab' }).click()
      await expect(tabs).toHaveCount(before + 1)
      await main.getByRole('button', { name: 'More', exact: true }).click()
      await expect(menu.getByRole('menuitem')).toHaveText(['Open in new tab'])
      await page.keyboard.press('Escape')
      await tabs.first().click({ button: 'right' })
      // A shortcut shows after its item's name.
      await expect(menu.getByRole('menuitem')).toHaveText([/^Pin tab/, /^Close tab/, /^Close other tabs/, /^Close tabs to the right/])
      await menu.getByRole('menuitem', { name: /^Close other tabs/ }).click()
      await expect(tabs).toHaveCount(1)
    })

    await test.step('the last tab cannot close, and no key opens a page', async () => {
      const tabs = page.getByRole('tablist', { name: 'Tabs' }).getByRole('tab')
      await expect(page.getByRole('button', { name: 'Close tab' })).toHaveCount(0)
      await tabs.first().focus()
      await page.keyboard.press('Delete')
      for (const key of ['Meta+k', 'Meta+t', 'Meta+n', 'Meta+Comma', 'Meta+j', 'Meta+f', 'Meta+w', 'Meta+Shift+t']) await page.keyboard.press(key)
      await expect(tabs).toHaveCount(1)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    await test.step('the pictures come from the folder', async () => {
      await expect.poll(() => page.evaluate(() => [...document.images].filter((image) => image.complete && image.naturalWidth > 0).length)).toBeGreaterThan(0)
    })

    expect(await misses(page)).toEqual([])
    expect(errors).toEqual([])
    expect(elsewhere).toEqual([])
  } finally {
    await site.close()
  }
})

test('the dates read as they did at the export, whenever the page opens', async ({ page, browser }) => {
  const snapshot = JSON.parse(await readFile(join(DIST, 'demo/snapshot.json'), 'utf8')) as DemoSnapshot
  const site = await serveFolder()
  const later = await browser.newPage()
  const rows = snapshot.lists['topics.list {"kind":"all","unreadOnly":false}']!.order.length
  const times = async (at: Page, now: number) => {
    await at.clock.setFixedTime(now)
    await at.goto(site.url)
    const time = at.getByRole('complementary', { name: 'Sidebar' }).getByRole('listitem').locator('[data-row-part="time"]')
    await expect(time).toHaveCount(rows)
    return time.allTextContents()
  }
  try {
    const then = await times(page, snapshot.capturedAt)
    // Forty days on, every label would read "5w" from the real clock.
    expect(await times(later, snapshot.capturedAt + 40 * DAY_MS)).toEqual(then)
  } finally {
    await later.close()
    await site.close()
  }
})

test('a narrow window shows a note in place of the app', async ({ page }) => {
  const site = await serveFolder()
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(site.url)
    await expect(page.getByRole('status').filter({ hasText: 'Juno is a desktop app' })).toContainText('Open this page on a wider screen to try it.')
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toHaveCount(0)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible()
    expect(await misses(page)).toEqual([])
  } finally {
    await site.close()
  }
})
