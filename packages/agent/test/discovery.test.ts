// Progressive discovery of connection tools (docs/research/codemode.md, "Is this progressive
// disclosure?"): each step of find_tools tells the model only what that step needs, and the test
// measures how many bytes each response costs.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { json, startFakeMcpServer, startFakeNotion } from '@juno/agent-testing'
import { createMcpManager, LITTLEBIRD, MCP_MIGRATIONS, NOTION, T3, mcpTools, type Credentials } from '../src/mcp'
import type { Actions } from '../src/actions'
import { openDatabase } from '../src/store/database'
import { initialize } from '../src/store/store'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

function credentials(approve: (url: URL) => URL): Credentials {
  type State = Awaited<ReturnType<ReturnType<Credentials['oauth']>['load']>>
  const states = new Map<string, State>()
  return {
    oauth: (id) => ({ load: () => states.get(id), save: (state) => { states.set(id, state) } }),
    bearer: async () => undefined,
    values: async () => [],
    clear: async (id) => { states.delete(id) },
    openAuthorization: async (url) => { await fetch(approve(new URL(url))) },
  }
}

async function fixture() {
  const notion = await startFakeNotion()
  cleanup.push(() => notion.close())
  const docs = await startFakeMcpServer({ name: 'docs', tools: [
    { name: 'search_docs', description: 'Search the team handbook.\nLonger notes the model reads only with the schema.', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, call: () => json({ results: [] }) },
    { name: 'publish_page', description: 'Publish a handbook page.', inputSchema: { type: 'object', properties: { page: { type: 'string' } } }, call: () => json({}) },
    { name: 'purge_archive', description: 'Remove every archived page.', inputSchema: { type: 'object', properties: {} }, call: () => json({}) },
  ] })
  cleanup.push(() => docs.close())
  const dir = await mkdtemp(join(tmpdir(), 'juno-discovery-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const store = { db: openDatabase(join(dir, 'agent.sqlite'), [MCP_MIGRATIONS]), now: Date.now }
  initialize(store)
  cleanup.push(async () => { store.db.close() })
  const manager = createMcpManager({ store, credentials: credentials(notion.oauth.approve), defaults: [{ ...NOTION, url: notion.url }, LITTLEBIRD, T3] })
  cleanup.push(() => manager.close())
  await manager.authorize('notion')
  await manager.add('Team docs', docs.url)
  const added = manager.configs().find((config) => config.label === 'Team docs')!
  await manager.authorize(added.id)
  manager.setTool(added.id, 'purge_archive', { enabled: false })
  const run = { runId: 'run', opId: 'op', h: 0, origin: 'owner' as const, cutoff: 0, clean: true, position: { incarnation: 'i', seq: 0 } }
  const proposed: string[] = []
  const actions = { propose: () => { proposed.push('card'); return 'card-1' } } as unknown as Actions
  const [find] = mcpTools(manager, { current: async () => run, actions })
  let serial = 0
  const ask = async (args: Record<string, string>) => {
    const out = await (find!.registration.execute as unknown as (a: unknown, api: { callId: string }) => Promise<{ output: Array<{ text: string }>; isError?: true }>)(args, { callId: `find-${++serial}` })
    const text = out.output[0]!.text
    return { text, bytes: Buffer.byteLength(text), isError: out.isError === true, body: text.startsWith('Untrusted') ? JSON.parse(text.slice(text.indexOf('\n') + 1)) as unknown : undefined }
  }
  return { manager, added, ask, proposed, urls: [notion.url, docs.url] }
}

/** Nothing internal: no connection id, no schema hash, no address. */
function expectNothingInternal(text: string, id: string, urls: ReadonlyArray<string>) {
  expect(text).not.toContain(id)
  expect(text).not.toMatch(/[0-9a-f]{64}/)
  for (const url of urls) expect(text).not.toContain(new URL(url).host)
  expect(text).not.toMatch(/https?:\/\//)
}

it('discloses servers, then matching tools, then one schema, and measures each step', async () => {
  const { manager, added, ask, urls } = await fixture()
  const before = Buffer.byteLength(JSON.stringify(manager.page()))

  // 1. No arguments: the servers that are on, their state and tool counts. The disabled tool is not counted.
  const index = await ask({})
  expect(index.body).toEqual({
    servers: [
      { server: 'notion', name: 'Notion', state: 'ready', tools: 5 },
      { server: 'team-docs', name: 'Team docs', state: 'ready', tools: 2 },
    ],
    off: ['littlebird', 't3'],
  })
  expectNothingInternal(index.text, added.id, urls)

  // 2. A query across servers: matching tools, one line each, no schemas.
  const query = await ask({ query: 'page' })
  const tools = (query.body as { tools: Array<{ server: string; tool: string; about?: string; read?: true }> }).tools
  expect(tools.map((tool) => `${tool.server}/${tool.tool}`)).toEqual([
    'notion/notion-create-pages', 'notion/notion-fetch', 'notion/notion-search', 'notion/notion-update-page', 'team-docs/publish_page',
  ])
  expect(tools.find((tool) => tool.tool === 'notion-fetch')).toEqual({ server: 'notion', tool: 'notion-fetch', about: 'Fetch a page by ID.', read: true })
  expect(query.text).not.toContain('inputSchema')
  expectNothingInternal(query.text, added.id, urls)

  // A query scoped to a server; a server's whole list; the one-line description only.
  const scoped = await ask({ server: 'team-docs', query: 'handbook' })
  expect((scoped.body as { tools: unknown[] }).tools).toEqual([
    { server: 'team-docs', tool: 'publish_page', about: 'Publish a handbook page.' },
    { server: 'team-docs', tool: 'search_docs', about: 'Search the team handbook.', read: true },
  ])
  const list = await ask({ server: 'team-docs' })
  expect(list.text).not.toContain('purge_archive')

  // 3. One tool's schema, only when asked for by name.
  const schema = await ask({ server: 'team-docs', tool: 'search_docs' })
  expect(schema.body).toEqual({
    server: 'team-docs', tool: 'search_docs', about: 'Search the team handbook.\nLonger notes the model reads only with the schema.', read: true,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  })
  expectNothingInternal(schema.text, added.id, urls)

  // A disabled tool never appears and has no schema.
  for (const response of [index, query, scoped, list]) expect(response.text).not.toContain('purge_archive')
  expect(await ask({ server: 'team-docs', tool: 'purge_archive' })).toMatchObject({ isError: true, text: 'This tool is not available.' })
  expect(await ask({ query: 'archive' })).toMatchObject({ body: { tools: [] } })

  // The cost of each step, against the page the bare call used to return.
  const sizes = { before, index: index.bytes, query: query.bytes, scoped: scoped.bytes, list: list.bytes, schema: schema.bytes }
  console.info('find_tools bytes', sizes)
  expect(index.bytes).toBeLessThan(250)
  expect(index.bytes * 5).toBeLessThan(before)
  expect(query.bytes).toBeLessThan(700)
  expect(list.bytes).toBeLessThan(400)
  expect(schema.bytes).toBeLessThan(400)
})

it('names a server the owner added by its label, accepts it in call_tool, and proposes Connect for one that is off', async () => {
  const { manager, ask, proposed } = await fixture()
  expect([...manager.handles().keys()]).toEqual(['notion', 'littlebird', 't3', 'team-docs'])
  expect(await ask({ server: 'nowhere' })).toMatchObject({ isError: true, text: 'There is no connection by that name.' })
  const off = await ask({ server: 'littlebird' })
  expect(off.text).toBe('Connection unavailable. Proposed Connect card card-1.')
  expect(proposed).toHaveLength(1)
})
