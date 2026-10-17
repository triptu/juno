// The auto-review of connection calls end to end (SPEC 13.9, 13.10): Configure lists a server's
// tools with a search box and an Enabled switch each; a call the owner asked for in so many words,
// and that can be undone, runs with no card; a delete asks. The decision model is the fake
// OpenRouter's System One endpoint (`fakeReview`), the server agent-testing's fake Littlebird.
import type { FakeLittlebird } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { addServer, card, configure, openChat, openPage, openRuns, ready } from './agent'
import { answer as echo, expect, test as chat } from './chat'

/** "add material on <id>" calls add_material, "delete material on <id>" delete_material; the rest is echoed. */
function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult !== undefined) return request.toolResult.includes('Proposed Change card') ? '<say>That needs your OK.</say>' : '<say>Done.</say>'
  const server = /\bon (server-[0-9a-f-]+)/.exec(request.input)?.[1]
  if (server !== undefined && /add material/.test(request.input)) {
    return { toolCall: { name: 'call_tool', arguments: { server, tool: 'add_material', args: { title: 'Launch', text: 'The launch moved to Tuesday.' } } } }
  }
  if (server !== undefined && /delete material/.test(request.input)) {
    return { toolCall: { name: 'call_tool', arguments: { server, tool: 'delete_material', args: { title: 'Launch' } } } }
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
    // pi-mcp has only an ESM entry and Playwright loads specs as CommonJS.
    const { startFakeLittlebird } = await import('@juno/agent-testing/mcp')
    const server = await startFakeLittlebird()
    await use(server)
    await server.close()
  },
})

test.describe.configure({ timeout: 120_000 })

test('Configure lists the tools, searches them, and turns one off', async ({ juno, mcp }) => {
  await ready(juno)
  const { row } = await addServer(juno, 'Meetings', mcp.url)
  const sheet = await configure(juno, row)
  // Every tool is on by default and Auto, a tool the server marks read-only too; a delete always asks, and says why.
  await expect(sheet.locator('[data-tool]')).toHaveCount(9)
  await expect(sheet.locator('[data-tool][data-tool-enabled="false"]')).toHaveCount(0)
  await expect(sheet.locator('[data-tool="get_meeting"]')).toHaveAttribute('data-tool-review', 'auto')
  await expect(sheet.locator('[data-tool="get_meeting"]')).toHaveAttribute('data-tool-read-only', 'true')
  await expect(sheet.locator('[data-tool="delete_material"]')).toHaveAttribute('data-tool-review', 'always')
  await expect(sheet.locator('[data-tool="delete_material"]')).toContainText("Deleting can't be undone, so Juno always asks.")
  await expect(sheet.getByRole('combobox', { name: 'Auto-review: delete_material' })).toHaveCount(0)

  await sheet.getByRole('textbox', { name: 'Search tools' }).fill('routine')
  await expect(sheet.locator('[data-tool]')).toHaveCount(3)
  await sheet.getByRole('textbox', { name: 'Search tools' }).fill('calendar')
  await expect(sheet.locator('[data-tool]')).toHaveCount(0)
  await expect(sheet.getByText('No tools match.')).toBeVisible()

  await sheet.getByRole('textbox', { name: 'Search tools' }).fill('material')
  const material = sheet.locator('[data-tool="delete_material"]')
  await material.getByRole('checkbox', { name: 'Enabled: delete_material' }).click()
  // The switch follows the agent's answer, so it holds once the agent kept it.
  await expect(material).toHaveAttribute('data-tool-enabled', 'false')
  await material.getByRole('checkbox', { name: 'Enabled: delete_material' }).click()
  await expect(material).toHaveAttribute('data-tool-enabled', 'true')
  // A rule for one tool; the connection's own rule is at the top.
  const add = sheet.locator('[data-tool="add_material"]')
  await add.getByRole('combobox', { name: 'Auto-review: add_material' }).selectOption('always')
  await expect(add).toHaveAttribute('data-tool-review', 'always')
  await expect(sheet.getByRole('combobox', { name: 'Auto-review for all tools' })).toHaveValue('auto')
  await sheet.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('a call the owner asked for that can be undone runs with no card, and a delete asks', async ({ juno, mcp, model }) => {
  await ready(juno)
  const { id } = await addServer(juno, 'Meetings', mcp.url)

  const pane = await openChat(juno)
  await pane.send(`add material on ${id} about the launch`)
  await pane.expectJuno('Done.')
  expect(mcp.materials()).toEqual([{ title: 'Launch', text: 'The launch moved to Tuesday.' }])
  await expect(card(pane, 'change')).toHaveCount(0)
  // The reviewer read the owner's words and the call, nothing else.
  expect(model.reviews.at(-1)?.state).toMatchObject({ owner: [`add material on ${id} about the launch`], call: { tool: 'add_material' } })

  await pane.send(`delete material on ${id} called Launch`)
  await pane.expectJuno('That needs your OK.')
  const asked = card(pane, 'change')
  await expect(asked).toBeVisible()
  await expect(asked.locator('[data-change-review]')).toHaveText("Asked because deleting can't be undone.")
  expect(mcp.calls.map((call) => call.name)).not.toContain('delete_material')
  await asked.getByRole('button', { name: 'Delete material' }).click()
  await expect(asked).toContainText('Done')
  expect(mcp.calls.filter((call) => call.name === 'delete_material')).toHaveLength(1)
  expect(mcp.materials()).toHaveLength(0)

  // Activity records both, each with the review's line.
  const activity = await openPage(juno, 'Activity')
  await openRuns(activity)
  await expect(activity.getByText('Ran without asking because you asked for it and it can be undone.')).toBeVisible()
  await expect(activity.getByText("Asked because deleting can't be undone.")).toBeVisible()
})
