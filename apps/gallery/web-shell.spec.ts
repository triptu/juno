import { expect, test, type Page } from '@playwright/test'
import { startWebShell, type WebShell } from '@juno/desktop/web'
import type { WebPageHandle } from '@juno/desktop/web/page'

/**
 * The web shell (`pnpm web`, docs/development.md "Web shell") in Chrome: the
 * real renderer over the engine's WebSocket, with the page's bridge in place
 * of Electron's. Opens Main of a seeded channel, sends, reacts, copies a
 * link through the HTML context menu, and sends again after the socket
 * drops. Opens no gallery page.
 */
let shell: WebShell

test.beforeAll(async () => {
  shell = await startWebShell({ port: 0, logLevel: 'error' })
})

test.afterAll(async () => {
  await shell?.stop()
})

const connection = (page: Page) => page.evaluate(() => (window as unknown as { __junoWeb?: WebPageHandle }).__junoWeb?.connection())

test('the web shell reads, sends and reacts through the engine socket', async ({ page, context }) => {
  // The first load transforms the renderer's modules in the host's Vite.
  test.setTimeout(180_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(shell.url).origin })
  await page.goto(shell.url, { timeout: 120_000 })
  await expect.poll(() => connection(page), { timeout: 120_000 }).toBe('connected')
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  await expect(sidebar).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })

  const topic = page.locator('[data-topic-view]').filter({ visible: true })
  const messages = topic.getByRole('list', { name: 'Messages' })
  const message = (text: string) => messages.locator('[data-message-row]').filter({ has: page.locator('[data-msg-text]', { hasText: text }) })

  await test.step('Main of #eng shows the seeded messages', async () => {
    await sidebar.getByRole('listitem', { name: /^#eng/ }).click({ position: { x: 40, y: 20 } })
    await expect(topic.locator('[data-topic-header]')).toContainText('Main')
    await expect(messages.locator('[data-message-row]').first()).toBeVisible()
  })

  const text = 'Sent from the web shell'
  await test.step('a message sent from the composer reaches Slack and shows once', async () => {
    const composer = topic.locator('[data-composer] textarea')
    await composer.fill(text)
    await composer.press('Enter')
    await expect(message(text)).toHaveCount(1)
    await expect(message(text)).not.toHaveAttribute('data-pending', /.*/)
    await expect.poll(() => shell.fake.messages('C0ENG').some((each) => each.text === text)).toBe(true)
  })

  await test.step('a quick reaction reaches Slack', async () => {
    const row = message(text)
    await row.hover()
    await row.getByRole('button', { name: 'React 👍' }).click()
    await expect(row.getByRole('button', { name: '1 👍, including you' })).toBeVisible()
    await expect.poll(() => shell.fake.messages('C0ENG').find((each) => each.text === text)?.reactions?.map((each) => each.name)).toEqual(['+1'])
  })

  await test.step('the context menu is a page menu whose items work', async () => {
    await sidebar.getByRole('listitem', { name: /^#eng/ }).click({ button: 'right', position: { x: 40, y: 20 } })
    const menu = page.getByRole('menu', { name: 'Context menu' })
    await menu.getByRole('menuitem', { name: 'Copy Slack link' }).click()
    await expect(menu).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/archives\/C0ENG\b/)
  })

  await test.step('after the socket drops, the page reconnects and sends again', async () => {
    shell.dropEngineSockets()
    await expect.poll(() => connection(page)).toBe('reconnecting')
    await expect.poll(() => connection(page), { timeout: 30_000 }).toBe('connected')
    const again = 'Sent again after a reconnect'
    const composer = topic.locator('[data-composer] textarea')
    await composer.fill(again)
    await composer.press('Enter')
    await expect.poll(() => shell.fake.messages('C0ENG').some((each) => each.text === again)).toBe(true)
    await expect(message(again)).not.toHaveAttribute('data-pending', /.*/)
  })
})
