// The T3 Code adapter (src/t3/README.md) on the real engine against a loopback fake T3 server with
// synthetic schemas: the Start card, the session's grant, questions, Stop, removal and the watcher.
// The watcher's waits run on a clock the test moves (`pollClock`), so no test waits for a real poll.
import { afterEach, expect, test } from 'bun:test'
import { json, reply, startFakeMcpServer, type FakeTool } from '@juno/agent-testing'
import { T3 } from '../src/mcp'
import { callTool, callsOf, closeAfter, closeConnections, connections, until } from './connections-harness'
import { deferred } from './turns-harness'

afterEach(closeConnections)

const str = { type: 'string' }
const START = { project: 'project-test', baseBranch: 'main', title: 'Fix test', brief: 'Fix the synthetic test.', planFirst: false }
const LAUNCH = 't3_thread_launch'
const launch: FakeTool = {
  name: LAUNCH, inputSchema: { type: 'object', properties: {
    title: str, message: str, projectId: str, runtimeMode: { enum: ['full-access'] }, interactionMode: { enum: ['default', 'plan'] },
    workspaceStrategy: { type: 'object', properties: { type: { const: 'worktree' }, baseRef: str, startFromOrigin: { type: 'boolean' } }, required: ['type', 'baseRef', 'startFromOrigin'], additionalProperties: false },
  }, required: ['title', 'message', 'projectId', 'runtimeMode', 'workspaceStrategy'], additionalProperties: false },
  call: () => json({ threadId: 'thread-test' }),
}
const threadArgs = { type: 'object', properties: { threadId: str }, required: ['threadId'], additionalProperties: false } as const
const read = (thread: () => Record<string, unknown>): FakeTool => ({ name: 't3_thread_read', inputSchema: threadArgs, call: () => json({ thread: { threadId: 'thread-test', ...thread() } }) })
const status: FakeTool = { name: 't3_worktree_status', inputSchema: threadArgs, call: () => json({ threadId: 'thread-test', branch: 'fix-test' }) }
const interrupt: FakeTool = { name: 't3_thread_interrupt', inputSchema: threadArgs, call: () => json({ status: 'interrupted' }) }
const send: FakeTool = { name: 't3_thread_send', inputSchema: { type: 'object', properties: { threadId: str, message: str }, required: ['threadId', 'message'] }, call: () => json({ delivered: true }) }
const TOOLS: FakeTool[] = [launch, read(() => ({ status: 'running', branch: 'fix-test' })), status, interrupt, send]

/** T3 Code's pending questions: `questions(requestId)` is what reading one returns. */
function asking(requestIds: () => ReadonlyArray<string>, questions: (requestId: string) => unknown, respond: () => void = () => {}): FakeTool[] {
  return [
    { name: 't3_pending_request_list', inputSchema: threadArgs, call: () => json({ requestIds: requestIds() }) },
    { name: 't3_pending_request_read', inputSchema: { type: 'object', properties: { threadId: str, requestId: str } }, call: (args) => json({ requestId: args.requestId, questions: questions(String(args.requestId)) }) },
    { name: 't3_pending_request_respond', inputSchema: { type: 'object', properties: { threadId: str, requestId: str, answers: { type: 'object' } }, required: ['threadId', 'requestId', 'answers'] }, call: () => { respond(); return json({ sequence: 1 }) } },
  ]
}
const yesNo = [{ id: 'q1', question: 'Use the small fix?', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] }]

async function t3(tools: FakeTool[] = TOOLS) {
  const server = await startFakeMcpServer({ tools })
  closeAfter(server.close)
  const c = await connections({ t3: true, defaults: [{ ...T3, url: server.url, auth: { kind: 'none' } }] })
  await c.manager.connect('t3')
  const job = () => {
    const found = c.turns.jobs.list()[0]
    if (!found) throw new Error('No job')
    return found
  }
  return {
    c, server, job,
    launches: () => callsOf(server, LAUNCH),
    sends: () => callsOf(server, 't3_thread_send').length,
    interrupts: () => callsOf(server, 't3_thread_interrupt').length,
    start: (input: Record<string, unknown> = START) => c.ask('Use the synthetic test data.', { name: 't3_start', args: input }),
    /** A clean owner run that sends to the job, or one that reads the session first. */
    steer: (message: string, readFirst = false) => c.ask('Use the synthetic test data.',
      ...(readFirst ? [callTool('t3', 't3_thread_read', { threadId: 'thread-test' })] : []), { name: 't3_send', args: { job: job().id, message } }),
    stop: (readFirst = false) => c.ask('Stop it.',
      ...(readFirst ? [callTool('t3', 't3_thread_read', { threadId: 'thread-test' })] : []), { name: 't3_stop', args: { job: job().id } }),
    openChange: () => c.turns.actions.views().find((v) => v.card._tag === 'change' && v.binding),
  }
}

test('a Start click launches once, and the grant lets only a clean owner run send or stop without a card', async () => {
  const { c, launches, sends, interrupts, start, steer, stop, job, openChange } = await t3()
  await start()
  expect(launches()).toHaveLength(0)
  expect(c.turns.actions.views()[0]?.card).toMatchObject({ _tag: 'proposedTask', where: 'project-test · from main', status: { _tag: 'open' } })
  const binding = await c.click()
  c.turns.actions.approve('second-click', binding.identity, binding.children)
  await c.turns.actions.idle()
  expect(launches()).toHaveLength(1)
  expect(launches()[0]?.args).toMatchObject({ runtimeMode: 'full-access', workspaceStrategy: { type: 'worktree', baseRef: 'main' } })
  // The watcher's first read finds the session's own branch.
  await c.clock.waited(1)
  expect(job().place).toBe('project-test · fix-test')

  await steer('Run the synthetic test.')
  expect(sends()).toBe(1)
  expect(openChange()).toBeUndefined()
  // A run that read the session is not clean: the same send needs a click.
  await steer('Check the synthetic result.', true)
  expect(openChange()?.card).toMatchObject({ _tag: 'change', target: job().title })
  expect(sends()).toBe(1)
  await c.click()
  expect(sends()).toBe(2)

  await stop(true)
  expect(interrupts()).toBe(0)
  await stop()
  expect(interrupts()).toBe(1)
  expect(job().phase).toBe('stopped')
})

test('replaces only an open proposal, and its old click does nothing', async () => {
  const { c, launches, start } = await t3()
  await start()
  const old = c.turns.actions.views()[0]?.binding
  if (!old) throw new Error('No card')
  await start({ ...START, baseBranch: 'release', replaces: old.identity.cardId })
  expect(c.turns.actions.views()[0]?.card).toMatchObject({ status: { _tag: 'expired' } })
  expect(c.turns.actions.approve('old-click', old.identity, old.children)).toMatchObject({ _tag: 'refused' })
  await c.click()
  expect(launches().map((call) => call.args)).toMatchObject([{ workspaceStrategy: { baseRef: 'release' } }])
})

test('no T3 tool but a read skips its card through call_tool, even under Never ask or a read-only claim', async () => {
  const fork: FakeTool = { name: 't3_thread_fork', annotations: { readOnlyHint: true }, inputSchema: threadArgs, call: () => json({ threadId: 'thread-fork' }) }
  const { c, server, launches } = await t3([...TOOLS, fork])
  c.manager.setTool('t3', LAUNCH, { review: 'never' })
  c.manager.setTool('t3', fork.name, { review: 'never' })
  await c.ask('Start it.', callTool('t3', LAUNCH, {}))
  expect(launches()).toHaveLength(0)
  expect(c.turns.actions.views()).toHaveLength(0)
  await c.ask('Fork it.', callTool('t3', fork.name, { threadId: 'thread-test' }))
  expect(callsOf(server, fork.name)).toHaveLength(0)
  expect(c.turns.actions.views().at(-1)?.card).toMatchObject({ _tag: 'change', status: { _tag: 'open' } })
})

test('launches nothing when the launch schema changed under its card or the server is off', async () => {
  const { c, server, launches, start } = await t3()
  await start()
  server.setTools([{ ...launch, inputSchema: { type: 'object', properties: { title: str } } }, ...TOOLS.slice(1)])
  await c.manager.refresh('t3')
  await c.click()
  // A schema that cannot carry the launch arguments gets no card at all.
  await start()
  expect(c.turns.actions.views()).toHaveLength(1)
  await c.manager.disconnect('t3', false)
  await start()
  expect(c.turns.actions.views()).toHaveLength(1)
  expect(launches()).toHaveLength(0)
})

test('a Start click after the server went down fails, and launches nothing', async () => {
  const { c, server, launches, start } = await t3()
  await start()
  await server.close()
  await c.manager.connect('t3')
  await c.click()
  expect(c.turns.actions.views()[0]?.card).toMatchObject({ status: { _tag: 'failed' } })
  expect(launches()).toHaveLength(0)
})

test('sends plan mode when T3 Code offers it, and otherwise the approved brief carries the instruction', async () => {
  const { c, server, launches, start } = await t3()
  await start({ ...START, planFirst: true })
  await c.click()
  expect(launches()[0]?.args).toMatchObject({ interactionMode: 'plan' })
  const { interactionMode: _, ...properties } = (launch.inputSchema as { properties: Record<string, unknown> }).properties
  server.setTools([{ ...launch, inputSchema: { ...launch.inputSchema, properties } }, ...TOOLS.slice(1)])
  await c.manager.refresh('t3')
  await start({ ...START, planFirst: true })
  const card = c.turns.actions.views().at(-1)?.card
  if (card?._tag !== 'proposedTask' || card.because === undefined) throw new Error('No brief on the card')
  expect(card.because).not.toBe(START.brief)
  await c.click()
  // What reached T3 Code is the brief the owner approved, the instruction included.
  expect(launches()[1]?.args).not.toHaveProperty('interactionMode')
  expect(String(launches()[1]?.args.message)).toContain(card.because.slice(START.brief.length).trim())
})

test('never launches again after a lost launch, and reconciles it only from its exact message, with no grant', async () => {
  let message = ''
  const { c, server, launches, start, steer, sends, openChange } = await t3([
    { ...launch, call: (args) => { message = String(args.message); return json({ threadId: 'thread-test' }) } },
    { name: 't3_thread_search', inputSchema: { type: 'object', properties: { query: str }, required: ['query'] }, call: () => json({ matches: [{ threadId: 'thread-test' }] }) },
    { name: 't3_thread_read', inputSchema: threadArgs, call: () => json({ thread: { threadId: 'thread-test', projectId: START.project, status: 'running' }, items: [{ text: message }] }) },
    status, send,
  ])
  await start()
  server.loseNextCall(LAUNCH)
  const binding = await c.click()
  expect(c.turns.jobs.list()).toHaveLength(0)
  await c.manager.connect('t3')
  c.turns.actions.approve('click-again', binding.identity, binding.children)
  await c.turns.actions.idle()
  expect(launches()).toHaveLength(1)
  // A restart of the dispatcher reconciles: the session is found by the tag in its first message.
  await c.turns.actions.start()
  await c.turns.actions.idle()
  expect(launches()).toHaveLength(1)
  expect(c.turns.jobs.list()).toHaveLength(1)
  expect(c.turns.actions.views()[0]?.card).toMatchObject({ _tag: 'proposedTask', status: { _tag: 'done' } })
  // A reconciled receipt mints no grant: a send from a clean run still asks.
  await steer('Run the synthetic test.')
  expect(sends()).toBe(0)
  expect(openChange()).toBeDefined()
})

test('a grant-backed send that is lost stays unknown, is not retried, and its card says it failed', async () => {
  const { c, server, start, steer, sends } = await t3()
  await start()
  await c.click()
  server.loseNextCall('t3_thread_send')
  await steer('Run the synthetic test once.')
  await c.manager.connect('t3')
  await c.turns.actions.start()
  await c.turns.actions.idle()
  expect(sends()).toBe(1)
  expect(c.turns.actions.views().find((v) => v.card._tag === 'change')?.card).toMatchObject({ status: { _tag: 'failed' } })
})

test('a question becomes a card answered once, and the answer wakes the watcher at once', async () => {
  let answered = false
  const { c, server, start, job } = await t3([launch, read(() => ({ status: answered ? 'running' : 'waiting' })), status,
    ...asking(() => answered ? [] : ['request-test'], () => yesNo, () => { answered = true })])
  await start()
  await c.click()
  await c.clock.waited(1)
  expect(job().phase).toBe('needsYou')
  const question = c.turns.actions.views().find((v) => v.card._tag === 'question')
  if (!question?.binding || question.card._tag !== 'question') throw new Error('No question')
  expect(question.card.asks._tag).toBe('t3')
  const prepared = c.turns.actions.prepare(question.binding.identity, { _tag: 'answer', answer: { _tag: 'option', optionId: question.card.options[0]!.id } })
  if ('_tag' in prepared) throw new Error('Question refused')
  const waits = c.clock.waits.length
  c.turns.actions.approve('answer', prepared.identity, prepared.children)
  c.turns.actions.approve('answer-again', prepared.identity, prepared.children)
  await c.turns.actions.idle()
  expect(callsOf(server, 't3_pending_request_respond').map((call) => call.args.answers)).toEqual([{ q1: 'yes' }])
  // The clock never moved: only the answer can have made the watcher read again.
  await c.clock.waited(waits + 1)
  expect(job().phase).toBe('running')
})

test('reports each new question once while the session waits, and reads a quiet session less often', async () => {
  const requestIds = ['request-test']
  const { c, start, job } = await t3([launch, read(() => ({ status: 'waiting' })), status, ...asking(() => requestIds, () => yesNo)])
  await start()
  c.fake.script([reply('<say>T3 Code has a question.</say>')])
  await c.click()
  const reports = () => c.fake.requests.filter((r) => JSON.stringify(r.context.messages.at(-1)).includes('waiting for an answer')).length
  await c.clock.waited(1)
  await c.turns.idle()
  expect(reports()).toBe(1)
  requestIds.push('request-second')
  c.fake.script([reply('<say>T3 Code has another question.</say>')])
  await c.clock.tick()
  await c.turns.idle()
  expect(reports()).toBe(2)
  expect(job().phase).toBe('needsYou')
  expect(c.turns.actions.views().filter((v) => v.card._tag === 'question')).toHaveLength(2)
  // The same pending questions, read again and again: no new report, and longer waits between reads.
  for (let i = 0; i < 4; i += 1) await c.clock.tick()
  await c.turns.idle()
  expect(reports()).toBe(2)
  expect(c.clock.waits.at(-1)).toBeGreaterThan(c.clock.waits[1]!)
})

test('says a question needs an answer in T3 Code when Juno cannot show it', async () => {
  const { c, start, job } = await t3([launch, read(() => ({ status: 'waiting' })), status, ...asking(() => ['request-test'], () => [
    { id: 'q1', question: 'First?', options: [{ label: 'A' }, { label: 'B' }] },
    { id: 'q2', question: 'Second?', options: [{ label: 'C' }, { label: 'D' }] },
  ])])
  await start()
  await c.click()
  await c.clock.waited(1)
  expect(job()).toMatchObject({ phase: 'needsYou', state: expect.stringContaining('in T3 Code') })
  expect(c.turns.actions.views().some((v) => v.card._tag === 'question')).toBe(false)
})

test('Stop: one click sends one interrupt, a new click retries a lost one, and a Stop that cannot be built keeps the job', async () => {
  const { c, server, start, job, interrupts } = await t3()
  await start()
  await c.click()
  server.loseNextCall('t3_thread_interrupt')
  await c.turns.jobs.stop(job().id, 'stop-1')
  expect(job().phase).not.toBe('stopped')
  await c.manager.connect('t3')
  await c.turns.jobs.stop(job().id, 'stop-1')
  expect(interrupts()).toBe(1)

  server.setTools(TOOLS.filter((tool) => tool.name !== 't3_thread_interrupt'))
  await c.manager.refresh('t3')
  await c.turns.jobs.stop(job().id, 'stop-2')
  expect(job()).toMatchObject({ stopFailed: true })
  expect(job().phase).not.toBe('stopped')

  server.setTools(TOOLS)
  await c.manager.refresh('t3')
  await c.turns.jobs.stop(job().id, 'stop-3')
  expect(interrupts()).toBe(2)
  expect(job().phase).toBe('stopped')
})

test('Pause does not queue an interrupt, so Resume sends nothing', async () => {
  const { c, start, job, interrupts } = await t3()
  await start()
  await c.click()
  // Settings' Pause stops every active job; that is not a click on an interrupt.
  c.turns.setMode('paused')
  await c.turns.jobs.stop(job().id)
  c.turns.setMode('on')
  await c.turns.actions.idle()
  expect(interrupts()).toBe(0)
  await c.turns.jobs.stop(job().id)
  expect(interrupts()).toBe(1)
})

test('after a removal, stops watching the session and leaves its interrupt to an owner click', async () => {
  const { c, start, job, interrupts, openChange } = await t3()
  const { opId } = await start()
  await c.click()
  await c.clock.waited(1)
  const message = c.turns.messages().find((m) => m.opId === opId && m.kind === 'user')
  if (!message) throw new Error('No owner message')
  await c.turns.redaction.remove({ opId: 'remove-test', messageIds: [message.id], alsoRemoveReply: false })
  await until(c.turns.actions.subscribe, () => openChange() !== undefined)
  expect(job().phase).toBe('unknown')
  expect(openChange()?.card).toMatchObject({ _tag: 'change', caption: expect.stringContaining('after a removal') })
  expect(interrupts()).toBe(0)
  await c.click(openChange()?.card.id)
  expect(interrupts()).toBe(1)
})

test('shows a session T3 Code started while the account changed, and stops watching it', async () => {
  let changeAccount: (() => void) | undefined
  const { c, start, steer, sends } = await t3([{ ...launch, call: () => { changeAccount?.(); return json({ threadId: 'thread-test' }) } }, ...TOOLS.slice(1)])
  // A new sign-in during the launch gives the connection a new account epoch.
  changeAccount = () => { c.turns.store.db.prepare("UPDATE mcp_connections SET epoch = 'account-test' WHERE id = 't3'").run() }
  await start()
  await c.click()
  expect(c.turns.actions.views()[0]?.card).toMatchObject({ _tag: 'proposedTask', status: { _tag: 'done' } })
  expect(c.turns.jobs.list()).toHaveLength(1)
  await c.turns.jobs.idle()
  expect(c.turns.jobs.list()[0]?.phase).toBe('unknown')
  await steer('Run the synthetic test.')
  expect(sends()).toBe(0)
})

test('sees a session end as soon as t3_thread_wait returns, without another timed read', async () => {
  let state = 'running'
  const ended = deferred()
  const called = deferred()
  const { c, start, job } = await t3([launch, read(() => ({ status: state, branch: 'fix-test' })), status,
    { name: 't3_thread_wait', inputSchema: { type: 'object', properties: { threadId: str, timeoutMs: { type: 'number' } }, required: ['threadId'] }, call: async () => {
      called.resolve()
      await ended.promise
      return json({ threadId: 'thread-test', status: state, timedOut: false })
    } }])
  await start()
  await c.click()
  await called.promise
  state = 'completed'
  ended.resolve()
  await c.turns.jobs.idle()
  expect(job().phase).toBe('done')
  expect(c.clock.waits).toHaveLength(1)
})
