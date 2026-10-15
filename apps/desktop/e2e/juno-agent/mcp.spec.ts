// Notion and Littlebird on Connections (plan v3 §16, flow 7): a tool on no read list that the
// server marked read-only when Juno first saw it is a read and runs at once; once its schema
// changes the claim no longer counts, and a call the owner did not ask for in so many words asks.
// The offered rows cannot point at a fake, so both fakes are added by address on loopback.
import type { FakeLittlebird, FakeNotion } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { card, addServer, configure, openChat, openPage, ready } from './agent'
import { answer as echo, expect, test as chat } from './chat'

/** "export everything on <id>" calls the unknown tool; the rest is echoed. */
function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult !== undefined) {
    if (request.toolResult.includes('Proposed Change card')) return '<say>The export is ready for you to review.</say>'
    return `<say>${request.toolResult.includes('exported') ? 'Exported everything.' : 'The export failed.'}</say>`
  }
  const server = /\bon (server-[0-9a-f-]+)/.exec(request.input)?.[1]
  if (server !== undefined && /export everything/.test(request.input)) {
    return { toolCall: { name: 'call_tool', arguments: { server, tool: 'export_everything', args: { format: 'csv' } } } }
  }
  return echo(request)
}

const test = chat.extend<{ readonly notion: FakeNotion; readonly littlebird: FakeLittlebird; readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  // oxlint-disable-next-line no-empty-pattern
  notion: async ({}, use) => {
    // pi-mcp has only an ESM entry and Playwright loads specs as CommonJS.
    const { startFakeNotion } = await import('@juno/agent-testing/mcp')
    const server = await startFakeNotion()
    await use(server)
    await server.close()
  },
  // oxlint-disable-next-line no-empty-pattern
  littlebird: async ({}, use) => {
    const { startFakeLittlebird, unknownTool } = await import('@juno/agent-testing/mcp')
    const server = await startFakeLittlebird({ extraTools: [unknownTool()] })
    await use(server)
    await server.close()
  },
})

test.describe.configure({ timeout: 150_000 })

const exports = (littlebird: FakeLittlebird) => littlebird.calls.filter((call) => call.name === 'export_everything')

test('a tool marked read-only at first sight runs at once, and asks once its schema changes', async ({ juno, notion, littlebird }) => {
  await ready(juno)
  const docs = await addServer(juno, 'Docs', notion.url)
  const tools = await configure(juno, docs.row)
  for (const tool of ['notion-search', 'notion-fetch', 'notion-create-pages']) await expect(tools.locator(`[data-tool="${tool}"]`)).toBeVisible()
  await tools.getByRole('button', { name: 'Done' }).click()

  const { id, row } = await addServer(juno, 'Meetings', littlebird.url)
  const sheet = await configure(juno, row)
  await expect(sheet.locator('[data-tool="export_everything"]')).toHaveAttribute('data-tool-read-only', 'true')
  await sheet.getByRole('button', { name: 'Done' }).click()

  const pane = await openChat(juno)
  await pane.send(`export everything on ${id}`)
  await pane.expectJuno('Exported everything.')
  expect(exports(littlebird)).toHaveLength(1)
  expect(exports(littlebird)[0]?.args).toEqual({ format: 'csv' })
  await expect(card(pane, 'change')).toHaveCount(0)

  // The server changes the tool: its read-only claim no longer counts, and "export" is not an action the
  // owner named, so the review finds the intent only implied and Juno asks.
  littlebird.changeSchema('export_everything', { type: 'object', properties: { format: { type: 'string' }, since: { type: 'string' } } })
  const page = await openPage(juno, 'Connections')
  const changed = await configure(juno, page.locator(`[data-connection-id="${id}"]`))
  await expect(changed.locator('[data-tool="export_everything"]')).toHaveAttribute('data-tool-review', 'auto')
  await expect(changed.locator('[data-tool="export_everything"]')).toHaveAttribute('data-tool-mark', 'changed')
  await expect(changed.locator('[data-tool="export_everything"]')).not.toHaveAttribute('data-tool-read-only')
  await changed.getByRole('button', { name: 'Done' }).click()
  const after = await openChat(juno)
  await after.send(`export everything on ${id} again`)
  await after.expectJuno('The export is ready for you to review.')
  await expect(card(after, 'change')).toHaveCount(1)
  expect(exports(littlebird)).toHaveLength(1)
})
