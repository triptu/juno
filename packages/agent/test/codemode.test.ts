// Codemode for reads (docs/research/codemode.md), on the real engine with the scripted model:
// a script reads Slack through the host, its child calls are audited and shown in Activity,
// citations resolve, writes are refused, the caps hold, and Pause stops a running script.
import { afterEach, expect, it, setDefaultTimeout } from 'bun:test'
import { reply, startFakeNotion } from '@juno/agent-testing'
import { createMcpManager, MCP_MIGRATIONS, mcpTools, NOTION, type McpManagerApi } from '../src/mcp'
import type { HostReads } from '../src/index'
import { activityPage } from '../src/serve/pages'
import { credentials } from './connections-harness'
import { deferred, say, turnsHarness } from './turns-harness'
import { searchPage } from './fixtures/search'

// Each test opens the engine; a run takes under a second, but a loaded machine can stretch it past bun's 5 s.
setDefaultTimeout(30_000)

type Harness = Awaited<ReturnType<typeof turnsHarness>>
const open: Harness[] = []
afterEach(async () => { for (const h of open.splice(0)) await h.close() })

const message = (ts: string, text: string) => ({ channelId: 'C0ENG', channelName: '#eng', ts, senderId: 'U1', senderName: 'Maya Chen', text })

/** Slack with three messages in #eng; `hold` makes `search` wait until it resolves. `searched` resolves at the first search. */
function slack(hold?: Promise<void>) {
  const first = deferred()
  const host: HostReads = {
    search: async (query) => {
      first.resolve()
      if (hold) await hold
      return searchPage(query === 'deploy' ? [message('1760500000.000001', 'The deploy is at 3pm.'), message('1760500000.000002', 'Lunch is pizza.')] : [message('1760500000.000003', 'The review moved to Friday.')])
    },
    history: async () => ({ messages: [] }),
    replies: async () => ({ messages: [] }),
    topics: async () => ({ topics: [] }),
    person: async (id) => ({ id, name: 'maya', displayName: 'Maya' }),
  }
  return { host, searched: first.promise }
}

async function harness(options: Parameters<typeof turnsHarness>[0] = {}) {
  const h = await turnsHarness({ codemode: {}, ...options })
  open.push(h)
  return h
}

const script = (code: string, id = 'call-script') => reply({ type: 'toolCall', id, name: 'codemode', arguments: { code } })
const resultOf = (h: Harness, n: number) => JSON.stringify(h.chatRequests()[n]?.context.messages.at(-1))
/** The script calls the latest run's Activity entry lists. */
const audit = (h: Harness) => activityPage(h.turns.store, { limit: 50 }).runs[0]?.scriptCalls ?? []

it('reads Slack in parallel in a script, keeps the handles for citations, and records each call', async () => {
  const { host } = slack()
  const h = await harness({ host })
  h.fake.script([
    script(`
      const [deploy, review] = await Promise.all([tools.slack_search({ query: 'deploy' }), tools.slack_search({ query: 'review' })])
      text([...deploy.split('\\n'), ...review.split('\\n')].filter((line) => !line.includes('Lunch')).join('\\n'))
    `),
    reply(say('The deploy is at <src m="m1">3pm</src> and the review is <src m="m3">on Friday</src>.')),
  ])
  const op = h.send('when are the deploy and the review?')
  const ended = await h.ended(op)
  expect(ended.ending).toEqual({ _tag: 'complete' })

  // The model got the filtered lines only, with their handles.
  const result = resultOf(h, 1)
  expect(result).toContain('m1 #eng (C0ENG) ts 1760500000.000001')
  expect(result).toContain('m3 #eng (C0ENG) ts 1760500000.000003')
  expect(result).not.toContain('Lunch is pizza')
  // Both sources resolve to the messages the script read.
  const bubble = h.events.find((e) => e._tag === 'bubble')
  expect(bubble?._tag === 'bubble' && bubble.body.flatMap((span) => ('source' in span ? [span.source.ts] : []))).toEqual(['1760500000.000001', '1760500000.000003'])

  const run = activityPage(h.turns.store, { limit: 50 }).runs[0]!
  expect(run.tainted).toBe(true)
  expect(run.reads).toBe('Ran 1 script: 2 reads')
  expect(run.scriptCalls).toEqual([
    { tool: 'slack_search', args: '{"query":"deploy"}', outcome: 'done' },
    { tool: 'slack_search', args: '{"query":"review"}', outcome: 'done' },
  ])
})

it('offers a script only the reads, and refuses every other tool it names', async () => {
  const { host } = slack()
  const h = await harness({ host })
  h.fake.script([
    script(`
      text(ALL_TOOLS.map((tool) => tool.name).sort().join(','))
      for (const name of ['remember', 'schedule_create', 'remove_messages', 'codemode', 'juno_harnessTurn', 'call_tool']) {
        try { await tools[name]({}) } catch (error) { text(name + ': ' + error.message) }
      }
    `),
    reply(say('Done.')),
  ])
  await h.ended(h.send('try everything'))
  const result = resultOf(h, 1)
  expect(result).toContain('slack_history,slack_person,slack_replies,slack_search,slack_topics')
  expect(result).not.toMatch(/remember,|schedule_create,|call_tool,/)
  // A name the script was not given is not a function there; nothing ran and no pin was made.
  for (const name of ['remember', 'schedule_create', 'remove_messages', 'codemode', 'juno_harnessTurn', 'call_tool']) expect(result).toContain(`${name}: `)
  expect(h.turns.pins.active().active).toEqual([])
  expect(h.turns.actions.views()).toEqual([])
})

it('keeps the reads a script made before it throws', async () => {
  const { host } = slack()
  const h = await harness({ host })
  h.fake.script([
    script(`
      const found = await tools.slack_search({ query: 'deploy' })
      text(found.split('\\n')[0])
      throw new Error('stopped on purpose')
    `),
    reply(say('Partly done.')),
  ])
  await h.ended(h.send('read then fail'))
  const result = resultOf(h, 1)
  expect(result).toContain('m1 #eng')
  expect(result).toContain('stopped on purpose')
  expect(audit(h).map((row) => row.outcome)).toEqual(['done'])
})

it('holds a script to its call limit and output size, and fails one that waits on nothing', async () => {
  const { host } = slack()
  const h = await harness({ host, codemode: { limits: { calls: 2, outputBytes: 600 } } })
  h.fake.script([
    script(`
      for (const query of ['a', 'b', 'c']) {
        try { await tools.slack_search({ query }) } catch (error) { text(error.message) }
      }
      text('x'.repeat(5000))
    `),
    script(`await new Promise(() => {}); text('never')`, 'call-forever'),
    reply(say('Done.')),
  ])
  await h.ended(h.send('read a lot'))
  const first = resultOf(h, 1)
  expect(first).toContain('The script made more than 2 calls')
  expect(first.length).toBeLessThan(5000)
  expect(audit(h).map((row) => row.outcome)).toEqual(['done', 'done', 'refused'])
  // A script that waits on nothing fails at once, long before its wall time.
  expect(resultOf(h, 2)).toContain('can never settle')
})

it('stops a script that waits on a read past its wall time', async () => {
  const { host, searched } = slack(new Promise(() => {}))
  const h = await harness({ host, codemode: { limits: { wallMs: 200 } } })
  h.fake.script([script(`text(await tools.slack_search({ query: 'deploy' }))`), reply(say('Slack is slow.'))])
  await h.ended(h.send('when is the deploy?'))
  await searched
  expect(resultOf(h, 1)).toContain('timed out after 200 ms')
  expect(audit(h).map((row) => row.outcome)).toEqual(['failed'])
})

it('stops a running script on Pause and records the unfinished read as cancelled', async () => {
  const hold = deferred()
  const { host, searched } = slack(hold.promise)
  const h = await harness({ host })
  h.fake.script([
    script(`text(await tools.slack_search({ query: 'deploy' }))`),
    reply(say('Juno is paused.')),
  ])
  const op = h.send('when is the deploy?')
  await searched
  h.turns.setMode('paused')
  const ended = await h.ended(op)
  expect(ended.ending._tag).toBe('complete')
  expect(resultOf(h, 1)).toContain('Juno was paused, so the script stopped')
  hold.resolve()
  expect(audit(h).map((row) => row.outcome)).toEqual(['cancelled'])
  expect(activityPage(h.turns.store, { limit: 50 }).runs[0]?.reads).toBe('Ran 1 script: 1 read, 1 cancelled')
  h.turns.setMode('on')
})

it('counts the codemode section and declaration in admission, and offers neither without the flag', async () => {
  const { host } = slack()
  const on = await harness({ host })
  on.fake.script([reply(say('Hi.'))])
  await on.ended(on.send('hi'))
  const sent = JSON.stringify(on.chatRequests()[0]?.context)
  expect(sent).toContain('"codemode"')
  expect(sent).toContain('slack_search')
  // The script-only connection read is never offered to the model.
  expect(sent).not.toContain('"connection_read"')

  const off = await turnsHarness({ host })
  open.push(off)
  off.fake.script([reply(say('Hi.'))])
  await off.ended(off.send('hi'))
  expect(JSON.stringify(off.chatRequests()[0]?.context)).not.toContain('"codemode"')
})

it('reads a connection in a script only through a tool Juno reviewed as a read', async () => {
  const server = await startFakeNotion()
  let manager: McpManagerApi | undefined
  const signIn = credentials(server.oauth.approve)
  const h = await harness({
    migrations: [MCP_MIGRATIONS],
    tools: (context) => {
      manager ??= createMcpManager({ store: context.store, credentials: signIn, defaults: [{ ...NOTION, url: server.url }] })
      return mcpTools(manager, { current: context.current, actions: context.actions })
    },
  })
  try {
    await manager!.authorize('notion')
    h.fake.script([
      script(`
        // A connection's result is text that starts with Juno's untrusted-data line.
        const found = await tools.connection_read({ server: 'notion', tool: 'notion-search', args: { query: 'roadmap' } })
        text('found ' + found.length)
        try { await tools.connection_read({ server: 'notion', tool: 'notion-create-pages', args: { pages: [{ title: 'x' }] } }) } catch (error) { text(error.message) }
      `),
      reply(say('Done.')),
    ])
    await h.ended(h.send('look in notion'))
    expect(resultOf(h, 1)).toContain('notion-create-pages is not a read')
    expect(server.calls.map((call) => call.name)).not.toContain('notion-create-pages')
    expect(audit(h).map((row) => [row.tool, row.outcome])).toEqual([['connection_read', 'done'], ['connection_read', 'failed']])
  } finally {
    await manager?.close()
    await server.close()
  }
})
