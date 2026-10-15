import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { fakeProvider, reply, startFakeNotion, startFakeLittlebird, unknownTool } from '@juno/agent-testing'
import { createMcpManager, MCP_MIGRATIONS, NOTION, mcpExecutors, mcpTools, changeCard, serveMcp, type Credentials, type McpManagerApi } from '../src/mcp'
import { createProviderGuard, openTurns } from '../src'
import { SONNET } from './turns-harness'
import { openDatabase } from '../src/store/database'
import { initialize } from '../src/store/store'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

// Store type comes from the public credential bridge, without importing pi-mcp outside mcp/.
function credentials(approve: (url: URL) => URL): Credentials {
  type State = Awaited<ReturnType<ReturnType<Credentials['oauth']>['load']>>
  const states = new Map<string, State>()
  return {
    oauth: (id) => ({ load: () => states.get(id), save: (state) => { states.set(id, state) } }),
    bearer: async () => undefined,
    values: async () => [...states.values()].flatMap((s) => s?.tokens ? [s.tokens.access_token, s.tokens.refresh_token ?? ''] : []).filter(Boolean),
    clear: async (id) => { states.delete(id) },
    openAuthorization: async (url) => { await fetch(approve(new URL(url))) },
  }
}

async function fixture(engine = false) {
  const server = await startFakeNotion()
  cleanup.push(() => server.close())
  const dir = await mkdtemp(join(tmpdir(), 'juno-mcp-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const fake = fakeProvider()
  const creds = credentials(server.oauth.approve)
  let manager: McpManagerApi | undefined
  const create = (store: Parameters<typeof createMcpManager>[0]['store']) => {
    manager = createMcpManager({ store, credentials: creds, defaults: [{ ...NOTION, url: server.url }] })
    return manager
  }
  if (!engine) {
    const store = { db: openDatabase(join(dir, 'agent.sqlite'), [MCP_MIGRATIONS]), now: Date.now }
    initialize(store)
    cleanup.push(async () => { store.db.close() })
    const m = create(store)
    cleanup.push(() => m.close())
    await m.authorize('notion')
    return { server, manager: m, creds }
  }
  const turns = await openTurns({
    agentDir: dir, model: SONNET, migrations: [MCP_MIGRATIONS],
    provider: (store) => { create(store); return createProviderGuard({ store, transport: fake.models }) },
    actions: { executors: () => manager ? mcpExecutors(manager) : [] },
    tools: (context) => {
      if (!manager) throw new Error('No manager')
      return mcpTools(manager, { current: context.current, propose: context.actions.propose })
    },
  })
  if (turns._tag !== 'running' || !manager) throw new Error('No engine')
  cleanup.push(() => turns.close())
  const m: McpManagerApi = manager
  cleanup.push(() => m.close())
  m.subscribe(() => turns.actions.kick())
  await m.authorize('notion')
  return { server, manager: m, turns, fake, creds }
}

it('signs in on loopback, discovers Notion, refreshes tokens and disconnects', async () => {
  const { server, manager } = await fixture()
  expect(manager.page().connections[0]).toMatchObject({ state: 'ready', address: server.url })
  expect(manager.tool('notion', 'notion-search').tier).toBe(0)
  expect(manager.tool('notion', 'notion-get-self').tier).toBe(3)
  server.oauth.expireAccessTokens()
  await manager.invoke('notion', 'notion-fetch', { id: 'page-roadmap' })
  expect(server.oauth.stats().refreshes).toBe(1)
  await manager.disconnect('notion')
  expect(manager.page().connections[0]?.state).toBe('off')
  await manager.connect('notion')
  expect(manager.page().connections[0]?.state).toBe('needsSignIn')
})

it('proposes before writing, checks versions on the click, and never repeats a lost write', async () => {
  const { server, manager, turns, fake } = await fixture(true)
  if (!turns || !fake) throw new Error('No engine')
  fake.script([reply('<say>Ready.</say>')])
  turns.accept({ opId: 'owner', kind: 'send', text: 'Update my page' })
  await turns.idle()
  const run = turns.store.db.prepare('SELECT id FROM runs').get()
  if (typeof run?.id !== 'string') throw new Error('No run')
  const payload = await changeCard(manager, 'notion', 'notion-update-page', { page_id: 'page-roadmap', command: 'replace_content', content: 'Updated by the owner.' })
  turns.actions.propose({ runId: run.id, callId: 'proposal', payload })
  expect(server.calls.filter((c) => c.name === 'notion-update-page')).toHaveLength(0)
  server.editElsewhere('page-roadmap', 'Someone changed it.')
  const first = turns.actions.views()[0]?.binding
  if (!first) throw new Error('No binding')
  turns.actions.approve('click-1', first.identity, first.children)
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === 'notion-update-page')).toHaveLength(0)
  const next = await changeCard(manager, 'notion', 'notion-update-page', { page_id: 'page-roadmap', command: 'replace_content', content: 'Approved change.' })
  turns.actions.propose({ runId: run.id, callId: 'proposal-2', payload: next })
  const second = turns.actions.views().find((v) => v.binding)?.binding
  if (!second) throw new Error('No second binding')
  server.loseNextWrite()
  turns.actions.approve('click-2', second.identity, second.children)
  await turns.actions.idle()
  expect(server.pages().find((p) => p.id === 'page-roadmap')?.content).toBe('Approved change.')
  expect(server.calls.filter((c) => c.name === 'notion-update-page')).toHaveLength(1)
  turns.actions.approve('click-3', second.identity, second.children)
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === 'notion-update-page')).toHaveLength(1)
  expect(turns.store.db.prepare('SELECT outcome FROM authorizations').all()).toEqual([{ outcome: 'unknown' }])
  await manager.connect('notion')
  if (next._tag !== 'change') throw new Error('Wrong card')
  const executor = mcpExecutors(manager).find((item) => item.tool === next.action.payload.tool)
  const reconciled = await executor?.reconcile?.({ payload: next.action.payload, actionId: next.action.id,
    authorizationId: 'test-auth', attemptId: 'test-attempt', digest: 'test-digest', cardId: 'test-card', opId: 'click-2' })
  expect(reconciled?._tag).toBe('found')
  expect(server.calls.filter((c) => c.name === 'notion-update-page')).toHaveLength(1)
})

it('taints discovery and reads in the real turn engine', async () => {
  const { manager, turns, fake } = await fixture(true)
  if (!turns || !fake) throw new Error('No engine')
  fake.script([
    reply({ type: 'toolCall', id: 'read', name: 'call_tool', arguments: { server: 'notion', tool: 'notion-search', args: { query: 'launch' } } }),
    reply('<say>I found the notes.</say>'),
  ])
  turns.accept({ opId: 'read-op', kind: 'send', text: 'Find launch notes' })
  await turns.idle()
  expect(turns.store.db.prepare('SELECT clean FROM runs').all()).toEqual([{ clean: 0 }])
  expect(manager.state('notion')).toBe('ready')
})

it('blocks secrets, invalid arguments and non-read tools before transport', async () => {
  const { server, manager } = await fixture()
  const count = server.calls.length
  await expect(manager.invoke('notion', 'notion-search', { query: `sk-or-v1-${'x'.repeat(40)}` })).rejects.toMatchObject({ reason: 'secret' })
  await expect(manager.invoke('notion', 'notion-search', { query: 42 })).rejects.toThrow()
  await expect(manager.invoke('notion', 'notion-create-pages', { pages: [] })).rejects.toThrow()
  expect(server.calls).toHaveLength(count)
})

it('discovers paginated tools, demotes changed schemas and refuses stale tier edits', async () => {
  const server = await startFakeLittlebird()
  cleanup.push(() => server.close())
  const dir = await mkdtemp(join(tmpdir(), 'juno-mcp-list-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const store = { db: openDatabase(join(dir, 'db'), [MCP_MIGRATIONS]), now: Date.now }
  cleanup.push(async () => { store.db.close() })
  const manager = createMcpManager({ store, credentials: credentials(server.oauth!.approve), defaults: [{ ...NOTION, url: server.url }] })
  cleanup.push(() => manager.close())
  await manager.authorize('notion')
  const first = manager.definitions('notion')[0]
  if (!first) throw new Error('No tools')
  manager.setTier('notion', first.name, first.hash, 0)
  server.changeSchema(first.name, { type: 'object', properties: { newer: { type: 'string' } } })
  await expect.poll(() => manager.tool('notion', first.name).tier).toBe(3)
  expect(manager.tool('notion', first.name).changed).toBe(1)
  expect(() => manager.setTier('notion', first.name, first.hash, 0)).toThrow()
  server.addTool(unknownTool())
  await expect.poll(() => manager.definitions('notion').some((t) => t.name === unknownTool().name)).toBe(true)
  expect(manager.tool('notion', unknownTool().name).tier).toBe(3)
})

it('serves only approved tools on an authenticated per-turn loopback endpoint', async () => {
  let calls = 0
  const endpoint = await serveMcp([{ name: 'read', description: 'Read', inputSchema: { type: 'object' }, call: async () => { calls++; return { text: 'Invented result' } } }])
  cleanup.push(() => endpoint.close())
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read', arguments: {} } }
  expect((await fetch(endpoint.url, { method: 'POST', body: JSON.stringify(request) })).status).toBe(401)
  const response = await fetch(endpoint.url, { method: 'POST', headers: { authorization: `Bearer ${endpoint.token}` }, body: JSON.stringify(request) })
  expect(await response.json()).toMatchObject({ result: { content: [{ text: 'Invented result' }] } })
  expect(calls).toBe(1)
})

it('archives large results as ordinary attachments and pages them before the next model request', async () => {
  const { server, turns, fake } = await fixture(true)
  if (!turns || !fake) throw new Error('No engine')
  server.editElsewhere('page-roadmap', 'Invented content. '.repeat(2000))
  fake.script([
    reply({ type: 'toolCall', id: 'large', name: 'call_tool', arguments: { server: 'notion', tool: 'notion-fetch', args: { id: 'page-roadmap' } } }),
    reply('<say>The result is an attachment.</say>'),
  ])
  turns.accept({ opId: 'large-op', kind: 'send', text: 'Read the page' })
  await turns.idle()
  const latest = JSON.stringify(fake.requests.at(-1)?.context)
  expect(latest).toContain('result exceeds 20 KB')
  expect(latest).not.toContain('Invented content. '.repeat(100))
  const rows = turns.store.db.prepare('SELECT body FROM attachments').all()
  expect(JSON.stringify(rows)).toContain('Invented content. '.repeat(100))
})

it('the model can only propose an outward tool, and destructive arguments never get a card', async () => {
  const { server, manager, turns, fake } = await fixture(true)
  if (!turns || !fake) throw new Error('No engine')
  fake.script([
    reply({ type: 'toolCall', id: 'write', name: 'call_tool', arguments: { server: 'notion', tool: 'notion-update-page', args: { page_id: 'page-roadmap', command: 'replace_content', content: 'Owner draft.' } } }),
    reply('<say>Review the change.</say>'),
  ])
  turns.accept({ opId: 'write-op', kind: 'send', text: 'Update the roadmap' })
  await turns.idle()
  expect(turns.actions.views()[0]?.card._tag).toBe('change')
  expect(server.calls.filter((c) => c.name === 'notion-update-page')).toHaveLength(0)
  await expect(changeCard(manager, 'notion', 'notion-update-page', { page_id: 'page-roadmap', command: 'replace_content', content: '', archived: true })).rejects.toMatchObject({ reason: 'destructive' })
})

it('keeps the owner tier decision and connection identity across a manager restart', async () => {
  const { manager, creds } = await fixture()
  const old = manager.tool('notion', 'notion-search')
  const epoch = manager.stored('notion').epoch
  manager.setTier('notion', old.name, old.hash, 3)
  await manager.close()
  const restarted = createMcpManager({ store: manager.store, credentials: creds })
  cleanup.push(() => restarted.close())
  await restarted.start()
  expect(restarted.state('notion')).toBe('ready')
  expect(restarted.stored('notion').epoch).toBe(epoch)
  expect(restarted.tool('notion', old.name).tier).toBe(3)
})
