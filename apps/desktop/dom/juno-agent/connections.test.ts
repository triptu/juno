// Connections end to end (WP17, auto-review): the owner adds an MCP server by its address, signs in
// through a fake OAuth authorization server, opens Configure to see its tools, and Juno uses a read
// in the chat; a tool the owner turns off is never called; Disconnect forgets the sign-in.
// The server is agent-testing's fake Littlebird on loopback; main fetches the sign-in page under
// JUNO_E2E instead of opening the browser, and the fake approves at once.
import { startFakeLittlebird, type FakeLittlebird } from '@juno/agent-testing/mcp'
import { startFakeOpenRouter, type OpenRouterRequest, type ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { answer as echo } from '../../e2e/juno-agent/model'
import { configure, JunoChatPane, readySynced as ready } from '../driver/agent'
import type { Juno } from '../driver/juno'
import { expect } from '../expect'
import type { Query } from '../query'
import { domTest } from '../test'

/** "search meetings on <id>" calls a read; "save a note on <id>" an outward tool; the rest is echoed. */
function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult !== undefined) {
    if (request.toolResult.includes('Proposed Change card')) return '<say>The note is ready for you to review.</say>'
    if (request.toolResult.includes('This tool is not available.')) return '<say>That tool is off.</say>'
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

async function openConnections(juno: Juno): Promise<void> {
  await openChat(juno)
  await juno.win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.win.getByRole('menuitem', { name: 'Connections' }).click()
  await juno.tabs.expectActive('Settings')
}

async function openChat(juno: Juno): Promise<void> {
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  await expect(juno.win.locator('main [data-juno-header="chat"]')).toBeVisible()
}

domTest('adds a server, signs in, configures its tools, uses a read in chat, turns a write off, and disconnects', async ({ juno, step }) => {
  const mcp = await startFakeLittlebird()
  try {
    await ready(juno)
    await openConnections(juno)
    const page = juno.win.locator('main')
    await step('Notion, Littlebird and T3 Code are offered, off until connected', () => offeredRows(juno, page))
    const { row, id } = await step('a server added by its address signs in with OAuth', () => addAndSignIn(page, mcp))
    await step('Configure lists, searches and sets rules for its tools', () => configureTools(juno, row))
    await step('a read runs with no click, and a tool turned off is never called', () => useAndTurnOff(juno, row, id, mcp))
    await step('Disconnect forgets the sign-in, and an added server can be removed', () => disconnectAndRemove(juno, page, row, mcp))
  } finally {
    await mcp.close()
  }
}, { model: () => startFakeOpenRouter({ answer }), timeout: 120_000 })

async function offeredRows(juno: Juno, page: Query): Promise<void> {
  // Notion, Littlebird and T3 Code are offered as compact rows, off until connected; T3 Code is on this Mac.
  for (const label of ['Notion', 'Littlebird', 'T3 Code']) await expect(page.locator('[data-connection-name]').filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible()
  await expect(page.locator('[data-connection-id="notion"]').getByRole('button', { name: 'Connect' })).toBeVisible()
  const t3 = await configure(juno, page.locator('[data-connection-id="t3"]'))
  await expect(t3.getByLabel('T3 Code address')).toHaveValue('http://localhost:3773/mcp')
  await t3.getByRole('button', { name: 'Done' }).click()
  await expect(t3).toHaveCount(0)
}

async function addAndSignIn(page: Query, mcp: FakeLittlebird): Promise<{ readonly row: Query; readonly id: string }> {
  // An address off this Mac must be https.
  const add = page.locator('[data-add-server]')
  await add.getByLabel('Address').fill('http://example.com/mcp')
  await add.getByRole('button', { name: 'Add' }).click()
  await expect(add.getByText('Use an https address, or http on this Mac.')).toBeVisible()

  await add.getByLabel('Name').fill('Meetings')
  await add.getByLabel('Address').fill(mcp.url)
  await add.getByRole('button', { name: 'Add' }).click()
  const row = page.locator('[data-connection-id^="server-"]')
  await expect(row.locator('[data-connection-name]')).toHaveText('Meetings')
  const id = await row.getAttribute('data-connection-id')
  if (id === null) throw new Error('No connection id')
  await expect(row).toHaveAttribute('data-connection', 'off')

  // Connect: the server answers 401, so Juno signs in with OAuth (registration, PKCE, code exchange).
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-connection', 'ready', { timeout: 20_000 })
  expect(mcp.oauth.stats()).toMatchObject({ registrations: 1, exchanges: 1 })
  return { row, id }
}

async function configureTools(juno: Juno, row: Query): Promise<void> {
  // Configure lists every tool across the server's pages (three to a page), each on and Auto; the server marks the
  // lookups read-only. A delete always asks.
  const sheet = await configure(juno, row)
  for (const tool of ['search_meetings', 'get_account', 'add_material', 'update_routine']) await expect(sheet.locator(`[data-tool="${tool}"]`)).toHaveAttribute('data-tool-enabled', 'true')
  await expect(sheet.locator('[data-tool][data-tool-enabled="false"]')).toHaveCount(0)
  await expect(sheet.locator('[data-tool="search_meetings"]')).toHaveAttribute('data-tool-read-only', 'true')
  await expect(sheet.locator('[data-tool="add_material"]')).toHaveAttribute('data-tool-review', 'auto')
  await expect(sheet.locator('[data-tool="delete_material"]')).toHaveAttribute('data-tool-review', 'always')
  await expect(sheet.getByRole('combobox', { name: 'Auto-review: delete_material' })).toHaveCount(0)
  // The search box narrows the list.
  await sheet.getByRole('textbox', { name: 'Search tools' }).fill('routine')
  await expect(sheet.locator('[data-tool="update_routine"]')).toBeVisible()
  await expect(sheet.locator('[data-tool="search_meetings"]')).toHaveCount(0)
  await sheet.getByRole('textbox', { name: 'Search tools' }).fill('calendar')
  await expect(sheet.locator('[data-tool]')).toHaveCount(0)
  // A rule for one tool; the connection's own rule is at the top.
  await sheet.getByRole('textbox', { name: 'Search tools' }).fill('routine')
  const routine = sheet.locator('[data-tool="update_routine"]')
  await routine.getByRole('combobox', { name: 'Auto-review: update_routine' }).selectOption('always')
  await expect(routine).toHaveAttribute('data-tool-review', 'always')
  await expect(sheet.getByRole('combobox', { name: 'Auto-review for all tools' })).toHaveValue('auto')
  await sheet.press('Escape')
  await expect(sheet).toHaveCount(0)
}

async function useAndTurnOff(juno: Juno, row: Query, id: string, mcp: FakeLittlebird): Promise<void> {
  // A read runs with no click, and Juno answers from its result.
  await openChat(juno)
  const pane = JunoChatPane.tab(juno.win)
  await pane.send(`search meetings on ${id}`)
  await pane.expectJuno('Found the Planning meeting.')
  expect(mcp.calls.map((call) => call.name)).toContain('search_meetings')
  // Turning a tool off: the switch follows the agent's answer, so it holds once the agent kept it, and Juno is no longer offered the tool.
  await openConnections(juno)
  const again = await configure(juno, row)
  const material = again.locator('[data-tool="add_material"]')
  await material.getByRole('checkbox', { name: 'Enabled: add_material' }).click()
  await expect(material).toHaveAttribute('data-tool-enabled', 'false')
  await again.getByRole('button', { name: 'Done' }).click()
  await openChat(juno)
  await pane.send(`save a note on ${id}`)
  await pane.expectJuno('That tool is off.')
  await expect(pane.root.locator('[data-chat-card="change"]')).toHaveCount(0)
  expect(mcp.calls.map((call) => call.name)).not.toContain('add_material')
  expect(mcp.materials()).toHaveLength(0)
}

async function disconnectAndRemove(juno: Juno, page: Query, row: Query, mcp: FakeLittlebird): Promise<void> {
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
  await expect(page.locator('[data-connection-id^="server-"]')).toHaveCount(0)
  await expect(page.locator('[data-connection-id="notion"]').getByRole('button', { name: 'Remove' })).toHaveCount(0)
}
