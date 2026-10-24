// Connection calls the owner approves on a card, end to end (SPEC 13.3, 13.9): the click runs the
// tool once, the card says what it did with a short result line, and Juno's run goes on with the
// result. A failure shows the server's error. A search with no read-only mark runs under Auto with
// no card. The decision model is the fake OpenRouter's (`fakeReview`); the server is a generic fake.
import type { FakeMcpServer } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { addServer, card, configure, openChat, openPage, readySynced as ready } from './agent'
import { answer as echo, expect, test as chat } from './chat'

function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  // A run a click started: the card's outcome is its input.
  if (request.input.includes('<card-outcome') && request.toolResult === undefined) {
    if (request.input.includes('Prefers short messages')) return '<say>You prefer short messages.</say>'
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

interface SearchGate { readonly wait: () => Promise<void> | undefined; readonly hold: () => void; readonly release: () => void }

const test = chat.extend<{ readonly mcp: FakeMcpServer; readonly model: FakeOpenRouter; readonly searchGate: SearchGate }>({
  // oxlint-disable-next-line no-empty-pattern
  searchGate: async ({}, use) => {
    let wait: Promise<void> | undefined
    let release = () => {}
    await use({ wait: () => wait, hold: () => { wait = new Promise((resolve) => { release = resolve }) }, release: () => { release(); wait = undefined } })
    release()
  },
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  // oxlint-disable-next-line no-empty-pattern
  mcp: async ({ searchGate }, use) => {
    // pi-mcp has only an ESM entry and Playwright loads specs as CommonJS.
    const { startFakeMcpServer, json } = await import('@juno/agent-testing/mcp')
    const note = { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] } as const
    let notes = 0
    const server = await startFakeMcpServer({ name: 'context', tools: [
      // No read-only mark, as Littlebird's own search has none.
      { name: 'search_user_context', description: 'Search what is known about the user.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, call: async () => {
        await searchGate.wait()
        return json({ results: ['Prefers short messages.'] })
      } },
      { name: 'create_note', description: 'Create a note.', inputSchema: note, call: () => json({ id: `note-${++notes}`, saved: true }) },
      { name: 'create_note_failing', description: 'Create a note.', inputSchema: note, call: () => { throw new Error('Notes are full for this workspace.') } },
    ] })
    await use(server)
    await server.close()
  },
})

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

test('a search with no read-only mark runs under Auto, an approved call runs once and shows its result, a failed one shows the error, and a read under Always ask says what it found', async ({ juno, mcp, searchGate }) => {
  await ready(juno)
  const { id, row } = await addServer(juno, 'Context', mcp.url)
  const pane = await openChat(juno)
  const changes = card(pane, 'change')
  searchGate.hold()
  await pane.send(`learn about me on ${id}`)
  // While the call runs, the status bubble names the connection and what the tool does.
  await expect(pane.root.locator('[data-chat-status]')).toHaveText('Searching Context')
  searchGate.release()
  await pane.expectJuno('You prefer short messages.')
  await expect(changes).toHaveCount(0)
  expect(mcp.calls.map((call) => call.name)).toEqual(['search_user_context'])

  await pane.send(`keep a note on ${id} about lunch`)
  const asked = changes.nth(0)
  await expect(asked).toBeVisible({ timeout: 15_000 })
  // Named by what it does, with a short verb on the button, and its values without JSON quotes.
  await expect(asked.locator('[data-chat-card-kind]')).toHaveText('Create note in Context')
  await expect(asked.locator('[data-change-field="title"]')).toContainText('Lunch')
  await expect(asked.locator('[data-change-field="title"]')).not.toContainText('"')
  expect(mcp.calls).toHaveLength(1)
  await asked.getByRole('button', { name: 'Create note' }).click()
  await expect(asked).toHaveAttribute('data-card-status', 'done')
  await expect(asked).toContainText('Done')
  // A plain line, never the server's JSON; all of it is behind Show result.
  await expect(asked.locator('[data-card-result]')).toHaveText('Saved')
  expect(await asked.innerText()).not.toContain('{"')
  await asked.getByRole('button', { name: 'Show result' }).click()
  await expect(asked.locator('[data-card-result-full]')).toHaveText('id: note-1\nsaved: true')
  expect(mcp.calls.map((call) => call.name)).toEqual(['search_user_context', 'create_note'])
  // The run goes on with the result.
  await pane.expectJuno('Saved. note-1')

  await pane.send(`keep a note on ${id}, the failing one`)
  const failing = changes.nth(1)
  await failing.getByRole('button', { name: 'Create note' }).click()
  await expect(failing).toHaveAttribute('data-card-status', 'failed')
  await expect(failing.locator('[data-card-result]')).toContainText('Notes are full for this workspace.')
  await pane.expectJuno('Saving the note failed.')

  await openPage(juno, 'Connections')
  const sheet = await configure(juno, row)
  await sheet.locator('[data-tool="search_user_context"]').getByRole('combobox', { name: 'Auto-review: search_user_context' }).selectOption('always')
  await expect(sheet.locator('[data-tool="search_user_context"]')).toHaveAttribute('data-tool-review', 'always')
  await sheet.getByRole('button', { name: 'Done' }).click()
  await openChat(juno)
  await pane.send(`learn about me on ${id}`)
  const search = changes.nth(2)
  await expect(search.locator('[data-chat-card-kind]')).toHaveText('Search Context', { timeout: 15_000 })
  await search.getByRole('button', { name: 'Search' }).click()
  await expect(search).toHaveAttribute('data-card-status', 'done')
  await expect(search).toContainText('Done')
  await expect(search).not.toContainText('Applied')
  await expect(search.locator('[data-card-result]')).toHaveText('Found 1 result')
  await expect(pane.junoBubble('You prefer short messages.')).toHaveCount(2, { timeout: 15_000 })
})
