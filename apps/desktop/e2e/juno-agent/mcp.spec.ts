// Notion and Littlebird on Connections (plan v3 §16, flow 7): a tool Juno has never heard of is
// Tier 3, so a call to it only proposes a Change card, until the owner moves it to "Runs without asking".
// The offered rows cannot point at a fake, so both fakes are added by address on loopback.
import type { FakeLittlebird, FakeNotion } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { card, addServer, makeRead, openChat, openPage, ready } from './agent'
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

test('an unknown tool is Tier 3 and proposes a card until it is moved to Runs without asking', async ({ juno, notion, littlebird }) => {
  await ready(juno)
  const docs = await addServer(juno, 'Docs', notion.url)
  for (const tool of ['notion-search', 'notion-fetch', 'notion-create-pages']) await expect(docs.row.locator(`[data-tool="${tool}"]`)).toBeVisible()

  const { id, row } = await addServer(juno, 'Meetings', littlebird.url)
  const unknown = row.locator('[data-tool="export_everything"]')
  // It says it only reads, but nothing on Juno's side has said so.
  await expect(unknown).toHaveAttribute('data-tool-tier', '3')

  const pane = await openChat(juno)
  await pane.send(`export everything on ${id}`)
  await pane.expectJuno('The export is ready for you to review.')
  await expect(card(pane, 'change')).toBeVisible()
  expect(exports(littlebird)).toHaveLength(0)

  await openPage(juno, 'Connections')
  await makeRead(row, 'export_everything')
  const after = await openChat(juno)
  await after.send(`export everything on ${id} again`)
  await after.expectJuno('Exported everything.')
  expect(exports(littlebird)).toHaveLength(1)
  expect(exports(littlebird)[0]?.args).toEqual({ format: 'csv' })
  // The second call ran with no click: still only the first card.
  await expect(card(after, 'change')).toHaveCount(1)
})
