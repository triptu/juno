import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { fakeProvider, reply, startFakeMcpServer, json, type FakeTool } from '@juno/agent-testing'
import { createProviderGuard, openTurns } from '../src'
import { createMcpManager, MCP_MIGRATIONS, T3, LITTLEBIRD, mcpExecutors, mcpTools, type Credentials, type McpManagerApi } from '../src/mcp'
import { parseObject } from '../src/mcp/catalogue'
import { createT3Adapter } from '../src/t3'
import { createJobs } from '../src/jobs/jobs'
import { SONNET } from './turns-harness'
import { openDatabase } from '../src/store/database'
import { initialize } from '../src/store/store'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).toReversed()) await close() })
const str = { type: 'string' }
const start = { project: 'project-test', baseBranch: 'main', title: 'Fix test', brief: 'Fix the synthetic test.', planFirst: false }
const launch: FakeTool = {
  name: 't3_thread_launch', inputSchema: { type: 'object', properties: {
    title: str, message: str, projectId: str, runtimeMode: { enum: ['full-access'] }, interactionMode: { enum: ['default', 'plan'] },
    workspaceStrategy: { type: 'object', properties: { type: { const: 'worktree' }, baseRef: str, startFromOrigin: { type: 'boolean' } }, required: ['type', 'baseRef', 'startFromOrigin'], additionalProperties: false },
  }, required: ['title', 'message', 'projectId', 'runtimeMode', 'workspaceStrategy'], additionalProperties: false },
  call: () => json({ threadId: 'thread-test' }),
}
const threadArgs = { type: 'object', properties: { threadId: str }, required: ['threadId'], additionalProperties: false } as const
const t3Tools: FakeTool[] = [launch,
  { name: 't3_thread_read', inputSchema: threadArgs, call: () => json({ thread: { threadId: 'thread-test', status: 'running', branch: 'fix-test' } }) },
  { name: 't3_worktree_status', inputSchema: threadArgs, call: () => json({ threadId: 'thread-test', branch: 'fix-test' }) },
  { name: 't3_thread_interrupt', inputSchema: threadArgs, call: () => json({ status: 'interrupted' }) },
  { name: 't3_thread_send', inputSchema: { type: 'object', properties: { threadId: str, message: str }, required: ['threadId', 'message'] }, call: () => json({ delivered: true }) },
]

async function fixture(serverId: 't3' | 'littlebird', tools: FakeTool[]) {
  const server = await startFakeMcpServer({ tools })
  cleanup.push(server.close)
  const dir = await mkdtemp(join(tmpdir(), 'juno-adapters-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const fake = fakeProvider()
  const credentials: Credentials = { oauth: () => ({ load: () => undefined, save: () => undefined }), bearer: async () => undefined, values: async () => [], clear: async () => undefined, openAuthorization: async () => undefined }
  let manager: McpManagerApi | undefined
  let t3: ReturnType<typeof createT3Adapter> | undefined
  const turns = await openTurns({
    agentDir: dir, model: SONNET, migrations: [MCP_MIGRATIONS],
    provider: (store) => {
      manager = createMcpManager({ store, credentials, defaults: [{ ...(serverId === 't3' ? T3 : LITTLEBIRD), url: server.url, auth: { kind: 'none' } }] })
      if (serverId === 't3') t3 = createT3Adapter(manager)
      return createProviderGuard({ store, transport: fake.models })
    },
    jobDrivers: () => t3 ? [t3.driver] : [],
    stopExternalJob: async (job) => t3?.stop(job) ?? false,
    actions: { executors: () => [...(manager ? mcpExecutors(manager) : []), ...(t3?.executors ?? [])] },
    tools: (context) => {
      if (!manager) throw new Error('No manager')
      return [...mcpTools(manager, { current: context.current, propose: context.actions.propose }), ...(t3?.tools(context) ?? [])]
    },
  })
  if (turns._tag !== 'running' || !manager) throw new Error('No engine')
  cleanup.push(turns.close)
  const m: McpManagerApi = manager
  cleanup.push(m.close)
  await m.connect(serverId)
  let serial = 0
  const call = async (name: string, args: unknown, readFirst = false) => {
    const id = `call-${++serial}`
    fake.script([...(readFirst ? [reply({ type: 'toolCall', id: `${id}-read`, name: 'call_tool', arguments: { server: 't3', tool: 't3_thread_read', args: { threadId: 'thread-test' } } })] : []), reply({ type: 'toolCall', id, name, arguments: parseObject(args) }), reply('<say>Ready.</say>')])
    turns.accept({ opId: `owner-${serial}`, kind: 'send', text: 'Use the synthetic test data.' })
    await turns.idle()
  }
  const click = async (id?: string) => {
    const binding = turns.actions.views().find((v) => v.binding && (id === undefined || v.card.id === id))?.binding
    if (!binding) throw new Error('No open card')
    turns.actions.approve(`click-${++serial}`, binding.identity, binding.children)
    await turns.actions.idle()
    return binding
  }
  return { server, turns, manager: m, call, click }
}

it('requires a Start card, starts once, records a grant and reads the session branch', async () => {
  const { server, turns, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', start)
  expect(server.calls.filter((c) => c.name === launch.name)).toHaveLength(0)
  expect(turns.actions.views()[0]?.card).toMatchObject({ _tag: 'proposedTask', where: 'project-test · from main', status: { _tag: 'open' } })
  const binding = await click()
  turns.actions.approve('second-click', binding.identity, binding.children)
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === launch.name)).toHaveLength(1)
  expect(server.calls.find((c) => c.name === launch.name)?.args).toMatchObject({ runtimeMode: 'full-access', workspaceStrategy: { type: 'worktree', baseRef: 'main' } })
  await expect.poll(() => turns.jobs.list()[0]?.place).toBe('project-test · fix-test')
  expect(turns.store.db.prepare('SELECT authority FROM grants').all()).toEqual([{ authority: 'click' }])
  const job = turns.jobs.list()[0]
  if (!job) throw new Error('No job')
  await turns.jobs.stop(job.id)
  await turns.jobs.stop(job.id)
  expect(server.calls.filter((c) => c.name === 't3_thread_interrupt')).toHaveLength(1)
})

it('replaces only an open proposal and rejects its old click', async () => {
  const { server, turns, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', start)
  const old = turns.actions.views()[0]?.binding
  if (!old) throw new Error('No old card')
  await call('t3_start', { ...start, baseBranch: 'release', replaces: old.identity.cardId })
  expect(turns.actions.views()[0]?.card).toMatchObject({ status: { _tag: 'expired' } })
  expect(turns.actions.approve('old-click', old.identity, old.children)).toMatchObject({ _tag: 'refused' })
  await click()
  expect(server.calls.filter((c) => c.name === launch.name)).toHaveLength(1)
  expect(server.calls.find((c) => c.name === launch.name)?.args).toMatchObject({ workspaceStrategy: { baseRef: 'release' } })
})

it('cannot launch through call_tool even if the owner made it Read', async () => {
  const { server, manager, turns, call } = await fixture('t3', t3Tools)
  manager.setTier('t3', launch.name, manager.tool('t3', launch.name).hash, 0)
  await call('call_tool', { server: 't3', tool: launch.name, args: {} })
  expect(server.calls.filter((c) => c.name === launch.name)).toHaveLength(0)
  expect(turns.actions.views()).toHaveLength(0)
})

it('uses discovered Littlebird read names and gates writes and unknown read hints', async () => {
  const tools: FakeTool[] = [
    { name: 'context_lookup_v7', description: 'Find context', inputSchema: { type: 'object', properties: { term: str }, required: ['term'] }, call: () => json({ matches: [] }) },
    { name: 'material_append_v2', inputSchema: { type: 'object', properties: { text: str }, required: ['text'] }, call: () => json({ id: 'material-test' }) },
    { name: 'unreviewed', annotations: { readOnlyHint: true }, call: () => json({}) },
  ]
  const { server, manager, turns, call, click } = await fixture('littlebird', tools)
  const read = manager.tool('littlebird', 'context_lookup_v7')
  manager.setTier('littlebird', read.name, read.hash, 0)
  await call('find_tools', { server: 'littlebird' })
  await call('call_tool', { server: 'littlebird', tool: read.name, args: { term: 'synthetic' } })
  expect(turns.actions.views()).toHaveLength(0)
  expect(server.calls.filter((c) => c.name === read.name)).toHaveLength(1)
  await call('call_tool', { server: 'littlebird', tool: 'material_append_v2', args: { text: 'Synthetic material' } })
  expect(server.calls.filter((c) => c.name === 'material_append_v2')).toHaveLength(0)
  await click()
  expect(server.calls.filter((c) => c.name === 'material_append_v2')).toHaveLength(1)
  expect(manager.tool('littlebird', 'unreviewed').tier).toBe(3)
})

it('never repeats an outward start after a lost response', async () => {
  const { server, turns, manager, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', start)
  server.loseNextCall(launch.name)
  const binding = await click()
  await manager.connect('t3')
  turns.actions.approve('repeat', binding.identity, binding.children)
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === launch.name)).toHaveLength(1)
  expect(turns.store.db.prepare('SELECT outcome FROM authorizations').all()).toEqual([{ outcome: 'unknown' }])
  expect(turns.actions.views()[0]?.card).toMatchObject({ status: { _tag: 'failed' } })
})

it('fails closed for missing launch fields, schema changes and a disconnected server', async () => {
  const { server, turns, manager, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', start)
  server.setTools([{ ...launch, inputSchema: { type: 'object', properties: { title: str } } }])
  await manager.refresh('t3')
  await click()
  await call('t3_start', start)
  expect(turns.actions.views()).toHaveLength(1)
  await manager.disconnect('t3', false)
  await call('t3_start', start)
  expect(turns.actions.views()).toHaveLength(1)
  expect(server.calls.filter((c) => c.name === launch.name)).toHaveLength(0)
})

it('uses plan mode when offered and otherwise puts the wait instruction in the approved brief', async () => {
  const { server, manager, turns, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', { ...start, planFirst: true })
  await click()
  expect(server.calls.find((c) => c.name === launch.name)?.args).toMatchObject({ interactionMode: 'plan' })
  const schema = launch.inputSchema
  if (!schema || typeof schema.properties !== 'object' || schema.properties === null) throw new Error('No schema')
  const { interactionMode: _, ...properties } = parseObject(schema.properties)
  server.setTools([{ ...launch, inputSchema: { ...schema, properties } }, ...t3Tools.slice(1)])
  await manager.refresh('t3')
  await call('t3_start', { ...start, planFirst: true })
  expect(turns.actions.views().at(-1)?.card).toMatchObject({ because: expect.stringContaining('Write a plan, then wait for approval') })
  await click()
  expect(server.calls.filter((c) => c.name === launch.name).at(-1)?.args.message).toContain('Write a plan, then wait for approval')
})

it('shows a T3 question and sends only the clicked answer once', async () => {
  const tools: FakeTool[] = [launch,
    { name: 't3_thread_read', inputSchema: threadArgs, call: () => json({ thread: { status: 'waiting' } }) },
    t3Tools[2]!,
    { name: 't3_pending_request_list', inputSchema: threadArgs, call: () => json({ requestIds: ['request-test'] }) },
    { name: 't3_pending_request_read', inputSchema: { type: 'object', properties: { threadId: str, requestId: str } }, call: () => json({ requestId: 'request-test', questions: [{ id: 'q1', question: 'Use the small fix?', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] }] }) },
    { name: 't3_pending_request_respond', inputSchema: { type: 'object', properties: { threadId: str, requestId: str, answers: { type: 'object' } }, required: ['threadId', 'requestId', 'answers'] }, call: () => json({ sequence: 1 }) },
  ]
  const { server, turns, call, click } = await fixture('t3', tools)
  await call('t3_start', start)
  await click()
  await expect.poll(() => turns.actions.views().some((v) => v.card._tag === 'question')).toBe(true)
  const question = turns.actions.views().find((v) => v.card._tag === 'question')
  if (!question?.binding || question.card._tag !== 'question') throw new Error('No question')
  expect(question.card.asks._tag).toBe('t3')
  expect(server.calls.filter((c) => c.name === 't3_pending_request_respond')).toHaveLength(0)
  const prepared = turns.actions.prepare(question.binding.identity, { _tag: 'answer', answer: { _tag: 'option', optionId: question.card.options[0]!.id } })
  if ('_tag' in prepared) throw new Error('Question refused')
  turns.actions.approve('answer-click', prepared.identity, prepared.children)
  await turns.actions.idle()
  turns.actions.approve('answer-again', prepared.identity, prepared.children)
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === 't3_pending_request_respond')).toHaveLength(1)
  expect(server.calls.find((c) => c.name === 't3_pending_request_respond')?.args).toMatchObject({ answers: { q1: 'yes' } })
})

it('fails unknown Littlebird schemas before transport and never repeats a lost write', async () => {
  const write: FakeTool = { name: 'material_append', inputSchema: { type: 'object', properties: { text: str }, required: ['text'] }, call: () => json({ id: 'test-material' }) }
  const { server, manager, turns, call, click } = await fixture('littlebird', [write,
    { name: 'unknown_schema', inputSchema: { type: 'object', properties: { text: { type: 'string', pattern: '^unsafe$' } } }, call: () => json({}) },
  ])
  await call('call_tool', { server: 'littlebird', tool: 'unknown_schema', args: { text: 'unsafe' } })
  expect(turns.actions.views()).toHaveLength(0)
  await call('call_tool', { server: 'littlebird', tool: write.name, args: { text: 'Test material' } })
  server.loseNextCall(write.name)
  const binding = await click()
  await manager.connect('littlebird')
  turns.actions.approve('repeat-write', binding.identity, binding.children)
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === write.name)).toHaveLength(1)
  expect(server.calls.filter((c) => c.name === 'unknown_schema')).toHaveLength(0)
})

it('uses a job grant only in clean owner runs and requires a click after reading a session', async () => {
  const { server, turns, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', start)
  await click()
  const job = turns.jobs.list()[0]
  if (!job) throw new Error('No job')
  await call('t3_send', { job: job.id, message: 'Run the synthetic test.' })
  expect(server.calls.filter((c) => c.name === 't3_thread_send')).toHaveLength(1)
  expect(turns.store.db.prepare('SELECT grant_id FROM authorizations WHERE grant_id IS NOT NULL').all()).toHaveLength(1)
  await call('t3_send', { job: job.id, message: 'Check the synthetic result.' }, true)
  expect(turns.actions.views().at(-1)?.card).toMatchObject({ _tag: 'change', target: job.title, status: { _tag: 'open' } })
  expect(server.calls.filter((c) => c.name === 't3_thread_send')).toHaveLength(1)
  await click()
  expect(server.calls.filter((c) => c.name === 't3_thread_send')).toHaveLength(2)
  await call('t3_stop', { job: job.id }, true)
  expect(server.calls.filter((c) => c.name === 't3_thread_interrupt')).toHaveLength(0)
  await call('t3_stop', { job: job.id })
  expect(server.calls.filter((c) => c.name === 't3_thread_interrupt')).toHaveLength(1)
  expect(turns.jobs.list()[0]?.phase).toBe('stopped')
})

it('keeps a lost grant-backed send unknown without retrying', async () => {
  const { server, manager, turns, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', start)
  await click()
  const job = turns.jobs.list()[0]
  if (!job) throw new Error('No job')
  server.loseNextCall('t3_thread_send')
  await call('t3_send', { job: job.id, message: 'Run the synthetic test once.' })
  await manager.connect('t3')
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === 't3_thread_send')).toHaveLength(1)
  expect(turns.store.db.prepare('SELECT outcome FROM authorizations WHERE grant_id IS NOT NULL').all()).toEqual([{ outcome: 'unknown' }])
})

it('fails clearly when the server goes down before the Start click', async () => {
  const { server, manager, turns, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', start)
  await server.close()
  await manager.connect('t3')
  await click()
  expect(server.calls.filter((c) => c.name === launch.name)).toHaveLength(0)
  expect(turns.actions.views()[0]?.card).toMatchObject({ status: { _tag: 'failed' } })
  await call('t3_start', start)
  expect(turns.actions.views()).toHaveLength(1)
})

it('reconciles a lost launch only from its exact message, without relaunching or minting a grant', async () => {
  let message = ''
  const tools: FakeTool[] = [
    { ...launch, call: (args) => { message = String(args.message); return json({ threadId: 'thread-test' }) } },
    { name: 't3_thread_search', inputSchema: { type: 'object', properties: { query: str }, required: ['query'] }, call: () => json({ matches: [{ threadId: 'thread-test' }] }) },
    { name: 't3_thread_read', inputSchema: threadArgs, call: () => json({ thread: { threadId: 'thread-test', projectId: start.project, status: 'running' }, items: [{ text: message }] }) },
    t3Tools[2]!,
  ]
  const { server, manager, turns, call, click } = await fixture('t3', tools)
  await call('t3_start', start)
  server.loseNextCall(launch.name)
  await click()
  expect(turns.jobs.list()).toHaveLength(0)
  await manager.connect('t3')
  await turns.actions.start()
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === launch.name)).toHaveLength(1)
  expect(turns.store.db.prepare('SELECT outcome FROM authorizations').all()).toEqual([{ outcome: 'done' }])
  expect(turns.jobs.list()).toHaveLength(1)
  expect(turns.store.db.prepare('SELECT id FROM grants').all()).toHaveLength(0)
})

it('does not queue a T3 interrupt while paused, so Resume sends nothing', async () => {
  const { server, turns, call, click } = await fixture('t3', t3Tools)
  await call('t3_start', start)
  await click()
  const job = turns.jobs.list()[0]
  if (!job) throw new Error('No job')
  // Settings' Pause asks every active job to stop; that is not a click on an interrupt.
  turns.setMode('paused')
  await turns.jobs.stop(job.id)
  turns.setMode('on')
  await turns.actions.idle()
  expect(server.calls.filter((c) => c.name === 't3_thread_interrupt')).toHaveLength(0)
  expect(turns.store.db.prepare("SELECT 1 FROM approvals WHERE op_id LIKE 't3-stop:%'").all()).toHaveLength(0)
  await turns.jobs.stop(job.id)
  expect(server.calls.filter((c) => c.name === 't3_thread_interrupt')).toHaveLength(1)
})

it('keeps every T3 tool off the read list a card, even if the owner made it Read', async () => {
  const fork: FakeTool = { name: 't3_thread_fork', inputSchema: threadArgs, call: () => json({ threadId: 'thread-fork' }) }
  const { server, manager, turns, call } = await fixture('t3', [...t3Tools, fork])
  manager.setTier('t3', fork.name, manager.tool('t3', fork.name).hash, 0)
  await call('call_tool', { server: 't3', tool: fork.name, args: { threadId: 'thread-test' } })
  expect(server.calls.filter((c) => c.name === fork.name)).toHaveLength(0)
  expect(turns.actions.views().at(-1)?.card).toMatchObject({ _tag: 'change', status: { _tag: 'open' } })
})

it('drops read names a preset no longer lists, before and after discovery', async () => {
  const lookup: FakeTool = { name: 'search_meetings', inputSchema: { type: 'object', properties: { term: str } }, call: () => json({ matches: [] }) }
  const account: FakeTool = { name: 'get_account', inputSchema: { type: 'object', properties: {} }, call: () => json({}) }
  const server = await startFakeMcpServer({ tools: [lookup, account] })
  cleanup.push(server.close)
  const dir = await mkdtemp(join(tmpdir(), 'juno-adapters-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const store = { db: openDatabase(join(dir, 'agent.sqlite'), [MCP_MIGRATIONS]), now: Date.now }
  initialize(store)
  cleanup.push(async () => { store.db.close() })
  const credentials: Credentials = { oauth: () => ({ load: () => undefined, save: () => undefined }), bearer: async () => undefined, values: async () => [], clear: async () => undefined, openAuthorization: async () => undefined }
  const preset = { ...LITTLEBIRD, url: server.url, auth: { kind: 'none' as const } }
  // An older build stored guessed read names and discovered one of them.
  const old = createMcpManager({ store, credentials, defaults: [{ ...preset, allowlist: ['search_meetings', 'get_account'] }] })
  await old.connect('littlebird')
  expect(old.tool('littlebird', 'search_meetings').tier).toBe(0)
  await old.close()
  // The current build lists no Littlebird reads.
  const current = createMcpManager({ store, credentials, defaults: [preset] })
  cleanup.push(() => current.close())
  expect(current.stored('littlebird').config.allowlist).toEqual([])
  expect(current.tool('littlebird', 'search_meetings').tier).toBe(3)
  // A store that never discovered still holds the guess; first discovery must not use it.
  const fresh = { db: openDatabase(join(dir, 'fresh.sqlite'), [MCP_MIGRATIONS]), now: Date.now }
  initialize(fresh)
  cleanup.push(async () => { fresh.db.close() })
  await createMcpManager({ store: fresh, credentials, defaults: [{ ...preset, allowlist: ['get_account'] }] }).close()
  const later = createMcpManager({ store: fresh, credentials, defaults: [preset] })
  cleanup.push(() => later.close())
  await later.connect('littlebird')
  expect(later.tool('littlebird', 'get_account').tier).toBe(3)
})

it('says a T3 question needs an answer in T3 Code when Juno cannot show it', async () => {
  const tools: FakeTool[] = [launch,
    { name: 't3_thread_read', inputSchema: threadArgs, call: () => json({ thread: { status: 'waiting' } }) },
    t3Tools[2]!,
    { name: 't3_pending_request_list', inputSchema: threadArgs, call: () => json({ requestIds: ['request-test'] }) },
    { name: 't3_pending_request_read', inputSchema: { type: 'object', properties: { threadId: str, requestId: str } }, call: () => json({ requestId: 'request-test', questions: [
      { id: 'q1', question: 'First?', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'q2', question: 'Second?', options: [{ label: 'C' }, { label: 'D' }] },
    ] }) },
  ]
  const { turns, call, click } = await fixture('t3', tools)
  await call('t3_start', start)
  await click()
  await expect.poll(() => turns.jobs.list()[0]?.state).toBe('T3 Code needs your answer in T3 Code')
  expect(turns.actions.views().some((v) => v.card._tag === 'question')).toBe(false)
})

it('writes a job only when its phase or line changes', async () => {
  const { turns } = await fixture('t3', t3Tools)
  const lost = { event: 'lostSight', state: 'Sign in to T3 Code to keep watching' } as const
  // A watcher that is signed out says the same line every second until the connection returns.
  const jobs = createJobs({
    store: turns.store, accept: () => ({ _tag: 'accepted' }) as never,
    drivers: [{ kind: 't3', resumable: false, run: async (_job, _signal, update) => {
      for (let i = 0; i < 5; i += 1) update(lost)
      return { event: 'done', state: 'Done' }
    } }],
  })
  turns.store.db.exec('CREATE TEMP TABLE job_writes (n INTEGER); CREATE TEMP TRIGGER count_job_writes AFTER UPDATE ON jobs BEGIN INSERT INTO job_writes VALUES (1); END')
  jobs.start({ kind: 't3', runId: 'run-test', originOp: 'op-test', callId: 'call-test', title: 'Fix test', place: 'project-test', task: '{}' })
  await jobs.idle()
  expect((turns.store.db.prepare('SELECT count(*) AS n FROM job_writes').get() as { n: number }).n).toBe(2)
})
