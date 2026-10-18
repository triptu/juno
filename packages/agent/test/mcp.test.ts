import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { fakeProvider, reply, startFakeMcpServer, startFakeNotion, startFakeLittlebird, unknownTool } from '@juno/agent-testing'
import { createMcpManager, MCP_MIGRATIONS, NOTION, T3, mcpExecutors, mcpTools, changeCard, serveMcp, type Credentials, type McpManagerApi } from '../src/mcp'
import { createProviderGuard, openTurns } from '../src'
import { SONNET } from './turns-harness'
import { openDatabase } from '../src/store/database'
import { slackTool } from '../src/mcp/catalogue'
import { initialize } from '../src/store/store'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

// Store type comes from the public credential bridge, without importing pi-mcp outside mcp/.
function credentials(approve: (url: URL) => URL, opened: string[] = []): Credentials {
  type State = Awaited<ReturnType<ReturnType<Credentials['oauth']>['load']>>
  const states = new Map<string, State>()
  return {
    oauth: (id) => ({ load: () => states.get(id), save: (state) => { states.set(id, state) } }),
    bearer: async () => undefined,
    values: async () => [...states.values()].flatMap((s) => s?.tokens ? [s.tokens.access_token, s.tokens.refresh_token ?? ''] : []).filter(Boolean),
    clear: async (id) => { states.delete(id) },
    openAuthorization: async (url) => { opened.push(url); await fetch(approve(new URL(url))) },
  }
}

async function bareManager(approve: (url: URL) => URL, opened: string[] = []) {
  const dir = await mkdtemp(join(tmpdir(), 'juno-mcp-bare-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const store = { db: openDatabase(join(dir, 'agent.sqlite'), [MCP_MIGRATIONS]), now: Date.now }
  initialize(store)
  cleanup.push(async () => { store.db.close() })
  const manager = createMcpManager({ store, credentials: credentials(approve, opened) })
  cleanup.push(() => manager.close())
  return manager
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
      return mcpTools(manager, { current: context.current, actions: context.actions })
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
  // The server marks it read-only and Juno has seen no schema change: it may skip the review in a clean run.
  expect(manager.tool('notion', 'notion-get-self')).toMatchObject({ tier: 3, hinted: true })
  expect(manager.tool('notion', 'notion-update-page').tier).toBe(3)
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

it('discovers paginated tools, trusts a read-only mark until its schema changes, and resets Never ask on a change', async () => {
  const server = await startFakeLittlebird()
  cleanup.push(() => server.close())
  const dir = await mkdtemp(join(tmpdir(), 'juno-mcp-list-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const store = { db: openDatabase(join(dir, 'db'), [MCP_MIGRATIONS]), now: Date.now }
  cleanup.push(async () => { store.db.close() })
  const manager = createMcpManager({ store, credentials: credentials(server.oauth!.approve), defaults: [{ ...NOTION, url: server.url }] })
  cleanup.push(() => manager.close())
  await manager.authorize('notion')
  expect(manager.definitions('notion').length).toBeGreaterThan(3)
  // A tool the server marks read-only when Juno first sees it keeps that mark.
  const hinted = unknownTool().name
  server.addTool(unknownTool())
  await expect.poll(() => manager.definitions('notion').some((t) => t.name === hinted)).toBe(true)
  expect(manager.tool('notion', hinted)).toMatchObject({ tier: 3, hinted: true, fresh: 0 })
  manager.setTool('notion', hinted, { review: 'never' })
  // Its schema changes: the claim no longer counts, and the owner's Never ask was for the old tool.
  server.changeSchema(hinted, { type: 'object', properties: { newer: { type: 'string' } } })
  await expect.poll(() => manager.tool('notion', hinted).hinted).toBe(false)
  expect(manager.tool('notion', hinted)).toMatchObject({ changed: 1, review: 'auto', fresh: 1 })
  // Under a connection-wide Never ask it keeps its own Auto, until the owner sets a rule again.
  manager.setRule('notion', 'never')
  expect(manager.rule('notion', hinted)).toBe('never')
  server.changeSchema(hinted, { type: 'object', properties: { newest: { type: 'string' } } })
  await expect.poll(() => manager.rule('notion', hinted)).toBe('auto')
  expect(manager.page().connections[0]?.tools.find((tool) => tool.name === hinted)).toMatchObject({ changed: true })
  // A tool that appears after the owner chose Never ask is new: its own Auto, marked New.
  server.addTool({ ...unknownTool(), name: 'later_tool' })
  await expect.poll(() => manager.definitions('notion').some((t) => t.name === 'later_tool')).toBe(true)
  expect(manager.rule('notion', 'later_tool')).toBe('auto')
  expect(manager.page().connections[0]?.tools.find((tool) => tool.name === 'later_tool')).toMatchObject({ added: true })
  manager.setTool('notion', 'later_tool', { review: 'auto' })
  expect(manager.rule('notion', 'later_tool')).toBe('never')
})

it('never offers a tool that merges, buys or force-pushes, and a delete or a Slack write always asks', async () => {
  const server = await startFakeLittlebird({ extraTools: [unknownTool('merge_pull_request'), unknownTool('buyCredits'), { ...unknownTool('purge_cache'), annotations: { destructiveHint: true } },
    { ...unknownTool('slack_send_message'), annotations: { readOnlyHint: true } }] })
  cleanup.push(() => server.close())
  const dir = await mkdtemp(join(tmpdir(), 'juno-mcp-locked-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const store = { db: openDatabase(join(dir, 'db'), [MCP_MIGRATIONS]), now: Date.now }
  cleanup.push(async () => { store.db.close() })
  const manager = createMcpManager({ store, credentials: credentials(server.oauth!.approve), defaults: [{ ...NOTION, url: server.url }] })
  cleanup.push(() => manager.close())
  await manager.authorize('notion')
  manager.setRule('notion', 'never')
  const offered = manager.definitions('notion').map((tool) => tool.name)
  expect(offered).not.toContain('merge_pull_request')
  expect(offered).not.toContain('buyCredits')
  expect(() => manager.tool('notion', 'merge_pull_request')).toThrow()
  // A delete, by its name or the server's own mark, is offered but always asks, whatever the rules say.
  expect(offered).toEqual(expect.arrayContaining(['delete_material', 'purge_cache']))
  expect(manager.rule('notion', 'delete_material')).toBe('always')
  expect(manager.rule('notion', 'purge_cache')).toBe('always')
  expect(() => manager.setTool('notion', 'delete_material', { review: 'never' })).toThrow()
  const tools = manager.page().connections[0]?.tools ?? []
  expect(tools.find((tool) => tool.name === 'delete_material')).toMatchObject({ locked: 'delete' })
  expect(tools.find((tool) => tool.name === 'merge_pull_request')).toMatchObject({ locked: 'forbidden' })
  // Juno never writes to Slack without a click: a Slack tool asks under any rule, whatever the server marks it.
  expect(manager.rule('notion', 'slack_send_message')).toBe('always')
  expect(() => manager.setTool('notion', 'slack_send_message', { review: 'never' })).toThrow()
  expect(tools.find((tool) => tool.name === 'slack_send_message')).toMatchObject({ locked: 'slack' })
  expect(slackTool({ ...NOTION, url: 'https://mcp.slack.com/mcp' }, 'conversations_add_message')).toBe(true)
  expect(slackTool(NOTION, 'search')).toBe(false)
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

it('asks for a write when no review can run, and a destructive argument still gets a card', async () => {
  const { server, manager, turns, fake } = await fixture(true)
  if (!turns || !fake) throw new Error('No engine')
  fake.script([
    reply({ type: 'toolCall', id: 'write', name: 'call_tool', arguments: { server: 'notion', tool: 'notion-update-page', args: { page_id: 'page-roadmap', command: 'replace_content', content: 'Owner draft.' } } }),
    reply('<say>Review the change.</say>'),
  ])
  turns.accept({ opId: 'write-op', kind: 'send', text: 'Update the roadmap' })
  await turns.idle()
  expect(turns.actions.views()[0]?.card).toMatchObject({ _tag: 'change', review: { rule: 'auto', failed: true, line: "Asked because Juno couldn't review this call." } })
  expect(server.calls.filter((c) => c.name === 'notion-update-page')).toHaveLength(0)
  await expect(changeCard(manager, 'notion', 'notion-update-page', { page_id: 'page-roadmap', command: 'replace_content', content: '', archived: true })).resolves.toMatchObject({ _tag: 'change' })
})

it("keeps the owner's tool switches, rules and connection identity across a manager restart", async () => {
  const { manager, creds } = await fixture()
  const old = manager.tool('notion', 'notion-search')
  const epoch = manager.stored('notion').epoch
  manager.setTool('notion', 'notion-get-self', { enabled: false })
  manager.setTool('notion', 'notion-update-page', { review: 'always' })
  manager.setRule('notion', 'never')
  await manager.close()
  const restarted = createMcpManager({ store: manager.store, credentials: creds })
  cleanup.push(() => restarted.close())
  await restarted.start()
  expect(restarted.state('notion')).toBe('ready')
  expect(restarted.stored('notion').epoch).toBe(epoch)
  expect(restarted.tool('notion', old.name).tier).toBe(0)
  expect(() => restarted.tool('notion', 'notion-get-self')).toThrow()
  expect(restarted.definitions('notion').some((tool) => tool.name === 'notion-get-self')).toBe(false)
  expect(restarted.rule('notion', 'notion-update-page')).toBe('always')
  expect(restarted.rule('notion', 'notion-create-pages')).toBe('never')
  expect(restarted.page().connections[0]).toMatchObject({ review: 'never' })
  expect(restarted.page().connections[0]?.tools.find((tool) => tool.name === 'notion-get-self')).toMatchObject({ enabled: false, review: 'auto', read: false, readOnly: true })
})

it('offers Notion, Littlebird and T3 Code, and adds a server by address that signs in only when it asks', async () => {
  const server = await startFakeLittlebird()
  cleanup.push(() => server.close())
  const open = await startFakeMcpServer({ name: 'open', tools: [{ name: 'lookup', description: 'Looks something up.', inputSchema: { type: 'object' }, call: () => 'found' }] })
  cleanup.push(() => open.close())
  const opened: string[] = []
  const manager = await bareManager(server.oauth.approve, opened)
  expect(manager.page().connections.map((row) => [row.label, row.state, row.removable ?? false])).toEqual([
    ['Notion', 'off', false], ['Littlebird', 'off', false], ['T3 Code', 'off', false],
  ])
  expect(manager.page().connections[2]?.t3).toEqual({ url: 'http://localhost:3773/mcp', allowNetwork: false })

  await expect(manager.add('Bad', 'http://example.com/mcp')).rejects.toMatchObject({ reason: 'invalid' })
  await manager.add('Open', open.url)
  await manager.add('', server.url)
  const [openRow, oauthRow] = manager.page().connections.slice(3)
  if (!openRow || !oauthRow) throw new Error('Not added')
  expect(oauthRow).toMatchObject({ label: new URL(server.url).host, state: 'off', removable: true })

  // A server without auth connects with no browser at all.
  await manager.authorize(openRow.id)
  expect(manager.page().connections[3]).toMatchObject({ state: 'ready', tools: [{ name: 'lookup', read: false, enabled: true, review: 'auto', hint: 'Looks something up.' }] })
  expect(opened).toHaveLength(0)

  // One that answers 401 gets the OAuth sign-in, and its tools.
  await manager.authorize(oauthRow.id)
  expect(opened).toHaveLength(1)
  expect(manager.state(oauthRow.id)).toBe('ready')
  expect(manager.definitions(oauthRow.id).length).toBeGreaterThan(3)

  // Off and on again uses the stored sign-in; Connect does too.
  await manager.disconnect(oauthRow.id, false)
  await manager.authorize(oauthRow.id)
  expect(manager.state(oauthRow.id)).toBe('ready')
  expect(opened).toHaveLength(1)

  await manager.remove(oauthRow.id)
  expect(manager.page().connections.map((row) => row.label)).toEqual(['Notion', 'Littlebird', 'T3 Code', 'Open'])
  await expect(manager.remove('notion')).rejects.toMatchObject({ reason: 'invalid' })
})

it('keeps T3 Code on this Mac unless the local network is allowed, allows private network addresses with the owner switch', async () => {
  const manager = await bareManager((url) => url)
  await expect(manager.address('http://192.168.1.22:3773/mcp', false)).rejects.toMatchObject({ reason: 'invalid' })
  await manager.address('http://192.168.1.22:3773/mcp', true)
  for (const host of ['example.com', '10.evil.com', '192.168.evil.com', '172.32.0.1']) {
    await expect(manager.address(`http://${host}:3773/mcp`, true)).rejects.toMatchObject({ reason: 'invalid' })
  }
  await expect(manager.address('https://t3.local:3773/mcp', false)).rejects.toMatchObject({ reason: 'invalid' })
  await manager.address('https://t3.local:3773/mcp', true)
  expect(manager.page().connections.find((row) => row.id === T3.id)).toMatchObject({ address: 'https://t3.local:3773/mcp', t3: { url: 'https://t3.local:3773/mcp', allowNetwork: true } })
  await manager.address('http://127.0.0.1:3773/mcp', false)
  expect(manager.stored(T3.id).config).toMatchObject({ url: 'http://127.0.0.1:3773/mcp', allowNetwork: false, noSecrets: true })
})
