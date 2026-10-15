// Connections end to end (WP17): the owner adds an MCP server by its address, signs in through a
// fake OAuth authorization server, sees its tools with their tiers, makes one a read, and Juno
// uses it in the chat; an outward tool only proposes a card; Disconnect forgets the sign-in.
// The server is agent-testing's fake Littlebird on loopback; main fetches the sign-in page under
// JUNO_E2E instead of opening the browser, and the fake approves at once.
import type { FakeLittlebird } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { answer as echo, expect, JunoChatPane, test as chat } from './chat'

/** "search meetings on <id>" calls a read; "save a note on <id>" an outward tool; the rest is echoed. */
function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult !== undefined) {
    if (request.toolResult.includes('Proposed Change card')) return '<say>The note is ready for you to review.</say>'
    return `<say>${request.toolResult.includes('Planning') ? 'Found the Planning meeting.' : 'Found nothing.'}</say>`
  }
  const server = /\bon (server-[0-9a-f-]+)/.exec(request.input)?.[1]
  if (server !== undefined && /search meetings/.test(request.input)) {
    return { toolCall: { name: 'call_tool', arguments: { server, tool: 'search_meetings', args: { query: 'launch' } } } }
  }
  if (server !== undefined && /save a note/.test(request.input)) {
    return { toolCall: { name: 'call_tool', arguments: { server, tool: 'add_material', args: { title: 'Launch', text: 'The launch moved to Tuesday.' } } } }
  }
  return echo(request)
}

const test = chat.extend<{ readonly mcp: FakeLittlebird; readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  // oxlint-disable-next-line no-empty-pattern
  mcp: async ({}, use) => {
    // pi-mcp has only an ESM entry and Playwright loads specs as CommonJS (see `@juno/agent-testing/mcp`).
    const { startFakeLittlebird } = await import('@juno/agent-testing/mcp')
    const server = await startFakeLittlebird()
    await use(server)
    await server.close()
  },
})

test.describe.configure({ timeout: 120_000 })

async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

async function openConnections(juno: Juno): Promise<void> {
  await openChat(juno)
  await juno.win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.win.getByRole('menuitem', { name: 'Connections' }).click()
  await juno.tabs.expectActive('Connections')
}

const openChat = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()

test('adds a server, signs in, lists and moves tools, uses a read in chat, proposes a write, and disconnects', async ({ juno, mcp }) => {
  await ready(juno)
  await openConnections(juno)
  const page = juno.win.locator('main')

  // Notion, Littlebird and T3 Code are offered, off until connected; T3 Code is on this Mac.
  for (const label of ['Notion', 'Littlebird', 'T3 Code']) await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  await expect(page.locator('[data-connection-id="notion"]').getByRole('button', { name: 'Connect' })).toBeVisible()
  await expect(page.getByLabel('T3 Code address')).toHaveValue('http://localhost:3773/mcp')

  // An address off this Mac must be https.
  const add = page.locator('[data-add-server]')
  await add.getByLabel('Address').fill('http://example.com/mcp')
  await add.getByRole('button', { name: 'Add' }).click()
  await expect(add.getByText('Use an https address, or http on this Mac.')).toBeVisible()

  await add.getByLabel('Name').fill('Meetings')
  await add.getByLabel('Address').fill(mcp.url)
  await add.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByRole('heading', { name: 'Meetings', exact: true })).toBeVisible()
  const row = page.locator('[data-connection-id^="server-"]')
  const id = await row.getAttribute('data-connection-id')
  if (id === null) throw new Error('No connection id')
  await expect(row).toHaveAttribute('data-connection', 'off')

  // Connect: the server answers 401, so Juno signs in with OAuth (registration, PKCE, code exchange).
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-connection', 'ready', { timeout: 20_000 })
  expect(mcp.oauth.stats()).toMatchObject({ registrations: 1, exchanges: 1 })

  // Every tool is listed, across the server's pages; a server added by address has no read list.
  for (const tool of ['search_meetings', 'get_account', 'add_material', 'update_routine']) await expect(row.locator(`[data-tool="${tool}"]`)).toHaveAttribute('data-tool-tier', '3')
  const search = row.locator('[data-tool="search_meetings"]')
  // The box follows the agent's answer, so it changes once the tier is saved.
  await search.getByLabel('Runs without asking').click()
  await expect(search).toHaveAttribute('data-tool-tier', '0')
  await expect(search.getByText('Read', { exact: true })).toBeVisible()

  // A read runs with no click, and Juno answers from its result.
  await openChat(juno)
  const pane = JunoChatPane.tab(juno.win)
  await pane.send(`search meetings on ${id}`)
  await pane.expectJuno('Found the Planning meeting.')
  expect(mcp.calls.map((call) => call.name)).toContain('search_meetings')

  // An outward tool only proposes a Change card; nothing reaches the server.
  await pane.send(`save a note on ${id}`)
  await pane.expectJuno('The note is ready for you to review.')
  await expect(pane.root.locator('[data-chat-card="change"]')).toBeVisible()
  expect(mcp.calls.map((call) => call.name)).not.toContain('add_material')
  expect(mcp.materials()).toHaveLength(0)

  // Disconnect forgets the sign-in: the next Connect signs in again.
  await openConnections(juno)
  await row.getByRole('button', { name: 'Disconnect' }).click()
  await expect(row).toHaveAttribute('data-connection', 'off')
  await expect(row.getByRole('button', { name: 'Connect' })).toBeVisible()
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-connection', 'ready', { timeout: 20_000 })
  expect(mcp.oauth.stats().exchanges).toBe(2)

  // A server the owner added can be removed; the offered ones cannot.
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('heading', { name: 'Meetings', exact: true })).toHaveCount(0)
  await expect(page.locator('[data-connection-id="notion"]').getByRole('button', { name: 'Remove' })).toHaveCount(0)
})
