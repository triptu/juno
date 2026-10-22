import { WebSocket } from 'ws'
import { expect, test, type Page } from '@playwright/test'
import { launchWebShell, messages as fakeMessages } from './host'
import type { WebPageHandle } from '../../web/page/connect'

/**
 * The web shell (`pnpm web`, docs/development.md "Web shell") in Chrome: the
 * real renderer over the engine's WebSocket, with the page's bridge in place
 * of Electron's. Opens Main of a seeded channel, sends, reacts, copies a
 * link through the HTML context menu, and sends again after the socket
 * drops.
 */
let shell: Awaited<ReturnType<typeof launchWebShell>>

test.beforeAll(async () => {
  shell = await launchWebShell()
})

test.afterAll(async () => {
  await shell?.stop()
  if (shell) await expect(fetch(shell.url)).rejects.toThrow()
})

const connection = (page: Page) => page.evaluate(() => (window as unknown as { __junoWeb?: WebPageHandle }).__junoWeb?.connection())

test('the web shell reads, sends and reacts through the engine socket', async ({ page, context }) => {
  // The first load transforms the renderer's modules in the host's Vite.
  test.setTimeout(180_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(shell.url).origin })
  let dropEngineSocket: () => Promise<void> = async () => { throw new Error('The page has not connected') }
  await page.routeWebSocket('**/__juno/engine', (socket) => {
    const server = socket.connectToServer()
    dropEngineSocket = () => server.close()
  })
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
    await expect.poll(() => fakeMessages(shell.controlUrl)).toEqual(expect.arrayContaining([expect.objectContaining({ text })]))
  })

  await test.step('a quick reaction reaches Slack', async () => {
    const row = message(text)
    await row.hover()
    await row.getByRole('button', { name: 'React 👍' }).click()
    await expect(row.getByRole('button', { name: '1 👍, including you' })).toBeVisible()
    await expect.poll(() => fakeMessages(shell.controlUrl)).toEqual(expect.arrayContaining([expect.objectContaining({ text, reactions: [expect.objectContaining({ name: '+1' })] })]))
  })

  await test.step('the context menu is a page menu whose items work', async () => {
    await sidebar.getByRole('listitem', { name: /^#eng/ }).click({ button: 'right', position: { x: 40, y: 20 } })
    const menu = page.getByRole('menu', { name: 'Context menu' })
    await menu.getByRole('menuitem', { name: 'Copy Slack link' }).click()
    await expect(menu).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/archives\/C0ENG\b/)
  })

  await test.step('closing a second page leaves the first client working', async () => {
    const second = await context.newPage()
    try {
      await second.goto(shell.url)
      await expect.poll(() => connection(second), { timeout: 30_000 }).toBe('connected')
      await expect(second.getByRole('complementary', { name: 'Sidebar' })).toHaveAttribute('aria-busy', 'false')
    } finally {
      await second.close()
    }
    expect(await connection(page)).toBe('connected')
  })

  await test.step('after the socket drops, the page reconnects and sends again', async () => {
    await dropEngineSocket()
    await expect.poll(() => connection(page)).toBe('reconnecting')
    await expect.poll(() => connection(page), { timeout: 30_000 }).toBe('connected')
    const again = 'Sent again after a reconnect'
    const composer = topic.locator('[data-composer] textarea')
    await composer.fill(again)
    await composer.press('Enter')
    await expect.poll(() => fakeMessages(shell.controlUrl)).toEqual(expect.arrayContaining([expect.objectContaining({ text: again })]))
    await expect(message(again)).not.toHaveAttribute('data-pending', /.*/)
  })
})


test('the host rejects foreign socket origins and files outside the fake', async () => {
  const address = new URL('/__juno/engine', shell.url)
  address.protocol = 'ws:'
  for (const origin of [undefined, 'null', 'not a URL', 'http://example.invalid']) {
    const opened = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(address, { origin, handshakeTimeout: 2000 })
      socket.once('open', () => { socket.terminate(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    expect(opened).toBe(false)
  }
  const response = await fetch(new URL(`/__juno/download?${new URLSearchParams({ url: 'https://slack.com/', name: 'blocked' })}`, shell.url))
  expect(response.status).toBe(404)
  const outside = await fetch(new URL('/@fs/etc/passwd', shell.url))
  expect(outside.status).toBe(403)
})
