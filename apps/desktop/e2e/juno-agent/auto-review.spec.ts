// The auto-review of connection calls end to end (plan v3 §16 flow 7, SPEC 13.9, 13.10): a call the
// owner asked for in so many words, and that can be undone, runs with no card; a tool the server
// marked read-only when Juno first saw it runs at once, until its schema changes and a call the owner
// did not name asks; a delete always asks. The decision model is the fake OpenRouter's System One
// endpoint (`fakeReview`), the server agent-testing's fake Littlebird with one unknown tool.
// Configure's list, search and switches are on the connections flow (connections.spec.ts).
import type { FakeLittlebird } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { addServer, card, configure, openChat, openPage, openRuns, readySynced as ready } from './agent'
import { answer as echo, expect, test as chat } from './chat'

/** "add material on <id>" calls add_material, "delete material on <id>" delete_material, "export everything on <id>" the unknown tool; the rest is echoed. */
function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult !== undefined) {
    if (request.toolResult.includes('Proposed Change card')) return '<say>That needs your OK.</say>'
    return request.toolResult.includes('exported') ? '<say>Exported everything.</say>' : '<say>Done.</say>'
  }
  const server = /\bon (server-[0-9a-f-]+)/.exec(request.input)?.[1]
  if (server === undefined) return echo(request)
  if (/add material/.test(request.input)) return { toolCall: { name: 'call_tool', arguments: { server, tool: 'add_material', args: { title: 'Launch', text: 'The launch moved to Tuesday.' } } } }
  if (/delete material/.test(request.input)) return { toolCall: { name: 'call_tool', arguments: { server, tool: 'delete_material', args: { title: 'Launch' } } } }
  if (/export everything/.test(request.input)) return { toolCall: { name: 'call_tool', arguments: { server, tool: 'export_everything', args: { format: 'csv' } } } }
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
    // pi-mcp has only an ESM entry and Playwright loads specs as CommonJS.
    const { startFakeLittlebird, unknownTool } = await import('@juno/agent-testing/mcp')
    const server = await startFakeLittlebird({ extraTools: [unknownTool()] })
    await use(server)
    await server.close()
  },
})

test.use({ synced: true })

test.describe.configure({ timeout: 150_000 })

const exports = (mcp: FakeLittlebird) => mcp.calls.filter((call) => call.name === 'export_everything')

test('an asked-for call that can be undone and a read-only tool run with no card; a changed tool and a delete ask, and Activity says why', async ({ juno, mcp, model }) => {
  await ready(juno)
  const { id, row } = await addServer(juno, 'Meetings', mcp.url)
  const sheet = await configure(juno, row)
  await expect(sheet.locator('[data-tool="export_everything"]')).toHaveAttribute('data-tool-read-only', 'true')
  await sheet.getByRole('button', { name: 'Done' }).click()

  const pane = await openChat(juno)
  await pane.send(`add material on ${id} about the launch`)
  await pane.expectJuno('Done.')
  expect(mcp.materials()).toEqual([{ title: 'Launch', text: 'The launch moved to Tuesday.' }])
  // The reviewer read the owner's words and the call, nothing else.
  expect(model.reviews.at(-1)?.state).toMatchObject({ owner: [`add material on ${id} about the launch`], call: { tool: 'add_material' } })

  // A tool on no read list that the server marked read-only at first sight is a read.
  await pane.send(`export everything on ${id}`)
  await pane.expectJuno('Exported everything.')
  expect(exports(mcp)).toEqual([expect.objectContaining({ args: { format: 'csv' } })])
  await expect(card(pane, 'change')).toHaveCount(0)

  // The server changes the tool: its read-only claim no longer counts, and "export" is not an action the
  // owner named, so the review finds the intent only implied and Juno asks.
  mcp.changeSchema('export_everything', { type: 'object', properties: { format: { type: 'string' }, since: { type: 'string' } } })
  const page = await openPage(juno, 'Connections')
  const changed = await configure(juno, page.locator(`[data-connection-id="${id}"]`))
  await expect(changed.locator('[data-tool="export_everything"]')).toHaveAttribute('data-tool-review', 'auto')
  await expect(changed.locator('[data-tool="export_everything"]')).toHaveAttribute('data-tool-mark', 'changed')
  await expect(changed.locator('[data-tool="export_everything"]')).not.toHaveAttribute('data-tool-read-only')
  await changed.getByRole('button', { name: 'Done' }).click()
  const after = await openChat(juno)
  await after.send(`export everything on ${id} again`)
  await after.expectJuno('That needs your OK.')
  await expect(card(after, 'change')).toHaveCount(1)
  expect(exports(mcp)).toHaveLength(1)

  // A delete always asks, whatever the owner said.
  await after.send(`delete material on ${id} called Launch`)
  const asked = card(after, 'change').filter({ has: juno.win.locator('[data-change-review]', { hasText: "Asked because deleting can't be undone." }) })
  await expect(asked).toBeVisible({ timeout: 15_000 })
  expect(mcp.calls.map((call) => call.name)).not.toContain('delete_material')
  await asked.getByRole('button', { name: 'Delete material' }).click()
  await expect(asked).toContainText('Done')
  expect(mcp.calls.filter((call) => call.name === 'delete_material')).toHaveLength(1)
  expect(mcp.materials()).toHaveLength(0)

  // Activity records each, with the review's line.
  const activity = await openPage(juno, 'Activity')
  await openRuns(activity)
  await expect(activity.getByText('Ran without asking because you asked for it and it can be undone.')).toBeVisible()
  await expect(activity.getByText("Asked because deleting can't be undone.")).toBeVisible()
})
