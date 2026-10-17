// Connection calls the owner approves on a card, end to end (SPEC 13.3, 13.9): the click runs the
// tool once, the card says what it did with a short result line, and Juno's run goes on with the
// result. A failure shows the server's error. A search with no read-only mark runs under Auto with
// no card. The decision model is the fake OpenRouter's (`fakeReview`); the server is a generic fake.
import type { FakeMcpServer } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { addServer, card, openChat, ready } from './agent'
import { answer as echo, expect, test as chat } from './chat'

function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  // A run a click started: the card's outcome is its input.
  if (request.input.includes('<card-outcome') && request.toolResult === undefined) {
    if (request.input.includes('outcome="done"')) return `<say>Saved. ${/note-[0-9]+/.exec(request.input)?.[0] ?? 'no id'}</say>`
    return '<say>Saving the note failed.</say>'
  }
  if (request.toolResult !== undefined) {
    if (request.toolResult.includes('Proposed Change card')) return '<say>That needs your OK.</say>'
    return `<say>You prefer ${/short [a-z]+/.exec(request.toolResult)?.[0] ?? 'nothing'}.</say>`
  }
  const server = /\bon (server-[0-9a-f-]+)/.exec(request.input)?.[1]
  if (server !== undefined && /learn about me/.test(request.input)) {
    return { toolCall: { name: 'call_tool', arguments: { server, tool: 'search_user_context', args: { query: 'preferences' } } } }
  }
  if (server !== undefined && /keep a note/.test(request.input)) {
    const tool = /failing/.test(request.input) ? 'create_note_failing' : 'create_note'
    return { toolCall: { name: 'call_tool', arguments: { server, tool, args: { title: 'Lunch', text: 'Lunch moved to noon.' } } } }
  }
  return echo(request)
}

const test = chat.extend<{ readonly mcp: FakeMcpServer; readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  // oxlint-disable-next-line no-empty-pattern
  mcp: async ({}, use) => {
    // pi-mcp has only an ESM entry and Playwright loads specs as CommonJS.
    const { startFakeMcpServer, json } = await import('@juno/agent-testing/mcp')
    const note = { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] } as const
    let notes = 0
    const server = await startFakeMcpServer({ name: 'context', tools: [
      // No read-only mark, as Littlebird's own search has none.
      { name: 'search_user_context', description: 'Search what is known about the user.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, call: () => json({ results: ['Prefers short messages.'] }) },
      { name: 'create_note', description: 'Create a note.', inputSchema: note, call: () => json({ id: `note-${++notes}`, saved: true }) },
      { name: 'create_note_failing', description: 'Create a note.', inputSchema: note, call: () => { throw new Error('Notes are full for this workspace.') } },
    ] })
    await use(server)
    await server.close()
  },
})

test.describe.configure({ timeout: 120_000 })

test('a search with no read-only mark runs under Auto with no card', async ({ juno, mcp }) => {
  await ready(juno)
  const { id } = await addServer(juno, 'Context', mcp.url)
  const pane = await openChat(juno)
  await pane.send(`learn about me on ${id}`)
  await pane.expectJuno('You prefer short messages.')
  await expect(card(pane, 'change')).toHaveCount(0)
  expect(mcp.calls.map((call) => call.name)).toEqual(['search_user_context'])
})

test('an approved call runs once, the card shows its result, and Juno goes on with it', async ({ juno, mcp }) => {
  await ready(juno)
  const { id } = await addServer(juno, 'Context', mcp.url)
  const pane = await openChat(juno)
  await pane.send(`keep a note on ${id} about lunch`)
  await pane.expectJuno('That needs your OK.')
  const asked = card(pane, 'change')
  await expect(asked).toBeVisible()
  // Named by what it does, with a short verb on the button.
  await expect(asked.locator('[data-chat-card-kind]')).toHaveText('Create note in Context')
  expect(mcp.calls).toHaveLength(0)
  await test.info().attach('card-before', { body: await asked.screenshot(), contentType: 'image/png' })
  await asked.getByRole('button', { name: 'Create note' }).click()
  await expect(asked).toHaveAttribute('data-card-status', 'done')
  await expect(asked).toContainText('Applied')
  await expect(asked.locator('[data-card-result]')).toContainText('note-1')
  await test.info().attach('card-after', { body: await asked.screenshot(), contentType: 'image/png' })
  expect(mcp.calls.map((call) => call.name)).toEqual(['create_note'])
  // The run goes on with the result.
  await pane.expectJuno('Saved. note-1')
})

test('a failed call shows the server error, and Juno hears it', async ({ juno, mcp }) => {
  await ready(juno)
  const { id } = await addServer(juno, 'Context', mcp.url)
  const pane = await openChat(juno)
  await pane.send(`keep a note on ${id}, the failing one`)
  await pane.expectJuno('That needs your OK.')
  const asked = card(pane, 'change')
  await asked.getByRole('button', { name: 'Create note' }).click()
  await expect(asked).toHaveAttribute('data-card-status', 'failed')
  await expect(asked.locator('[data-card-result]')).toContainText('Notes are full for this workspace.')
  await test.info().attach('card-failed', { body: await asked.screenshot(), contentType: 'image/png' })
  await pane.expectJuno('Saving the note failed.')
})
