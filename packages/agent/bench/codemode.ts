// Runs on Node: Bun's node:sqlite on macOS cannot open its SQLite files (docs/development.md, "Runtimes").
// Direct tools against codemode (docs/research/codemode.md, "Measurement"), on the real turn
// engine with the scripted model, so it needs no network and no key. Two sets:
//
// - The agent eval cases (`eval/cases.ts`). The codemode variant moves each response's Slack
//   reads, and runs of consecutive read-only responses, into one `codemode` script that returns
//   the same text; every other step, and the final answers, stay the same.
// - Three multi-step read tasks over the fake Notion, Littlebird and T3 servers, written once with
//   direct tools (parallel calls where the calls are independent) and once with one script.
//
// It prints, per task and mode: the chat requests (model turns), prompt and completion size in
// UTF-8 bytes and as estimated tokens (bytes / 4, pi-ai's faux estimate; no real tokenizer), the
// wall time from the owner's message to the settled run, and whether the task succeeded (the eval
// graders with the scripted judge; for the connection tasks, the facts the answer states were in
// what the model read). The scripted model writes the same answer whatever it is sent, so turns,
// sizes and success measure the tool path, not model behaviour.
//
//   bun scripts/heavy.mjs bun run --cwd packages/agent node --import ../../scripts/ts-resolve-hooks.mjs bench/codemode.ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeProvider, reply, startFakeLittlebird, startFakeNotion, startFakeT3, type ModelStep } from '@juno/agent-testing'
import { createProviderGuard, openTurns, type ModelRef, type Turns } from '../src/index'
import { createMcpManager, LITTLEBIRD, MCP_MIGRATIONS, mcpTools, NOTION, T3, type Credentials, type McpManagerApi } from '../src/mcp'
import { CASES } from '../eval/cases'
import { runSteps } from '../eval/engine'
import { grade } from '../eval/grade'
import { scriptedJudge } from '../eval/judge'

const SONNET: ModelRef = { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' }
const HAIKU: ModelRef = { provider: 'openrouter', modelId: 'anthropic/claude-haiku-5.5' }
const READS = new Set(['slack_search', 'slack_history', 'slack_replies', 'slack_topics', 'slack_person', 'slack_channels'])
const ROUNDS = Number(process.env.ROUNDS ?? 3)

type Block = { type: string; name?: string; arguments?: Record<string, unknown>; text?: string; id?: string }
type Fake = ReturnType<typeof fakeProvider>
type Row = { task: string; mode: 'direct' | 'codemode'; turns: number; promptBytes: number; completionBytes: number; ms: number; ok: boolean }

const blocks = (step: ModelStep): Block[] => (step.kind === 'reply' && typeof step.answer !== 'function' ? (step.answer.content as Block[]) : [])
const isRead = (step: ModelStep) => {
  const calls = blocks(step).filter((b) => b.type === 'toolCall')
  return calls.length > 0 && calls.every((b) => READS.has(b.name ?? ''))
}
let scripts = 0
const scriptCall = (code: string): Block => ({ type: 'toolCall', id: `script-${++scripts}`, name: 'codemode', arguments: { code } })
const callOf = (b: Block) => `tools.${b.name}(${JSON.stringify(b.arguments ?? {})})`

/**
 * The same case with its reads in scripts: each run of consecutive read-only responses becomes one
 * response with one script, which makes the reads of a response in parallel and the responses in
 * order, and returns their results joined as the direct path would show them.
 */
function asCodemode(script: ReadonlyArray<ModelStep>): ModelStep[] {
  const out: ModelStep[] = []
  for (let i = 0; i < script.length; i++) {
    if (!isRead(script[i]!)) { out.push(script[i]!); continue }
    const group: ModelStep[] = []
    while (i < script.length && isRead(script[i]!)) group.push(script[i++]!)
    i--
    const lines = group.map((step) => `results.push(...(await Promise.all([${blocks(step).filter((b) => b.type === 'toolCall').map(callOf).join(', ')}])))`)
    const notes = group.flatMap((step) => blocks(step).filter((b) => b.type === 'text'))
    out.push(reply([...notes, scriptCall(`const results = []\n${lines.join('\n')}\ntext(results.join('\\n'))`)] as never))
  }
  return out
}

function measure(fake: Fake, used: ReadonlyArray<ModelStep>): Pick<Row, 'turns' | 'promptBytes' | 'completionBytes'> {
  const chat = fake.requests.filter((r) => r.model === SONNET.modelId)
  const answered = used.slice(0, used.length - fake.pending())
  return {
    turns: chat.length,
    promptBytes: chat.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r.context)), 0),
    completionBytes: answered.reduce((n, step) => n + Buffer.byteLength(JSON.stringify(blocks(step))), 0),
  }
}

async function evalCase(c: (typeof CASES)[number], mode: Row['mode']): Promise<Row> {
  const script = mode === 'direct' ? [...c.script] : asCodemode(c.script)
  const fake = fakeProvider()
  fake.script(script)
  const backend = { model: SONNET, helper: HAIKU, provider: (store: Parameters<typeof createProviderGuard>[0]['store']) => createProviderGuard({ store, transport: fake.models }) }
  const trace = await runSteps(c.steps, backend, 30_000, mode === 'codemode' ? { codemode: {} } : {})
  const result = await grade(c.id, c.checks, trace, scriptedJudge())
  return { task: c.id, mode, ...measure(fake, script), ms: trace.ms, ok: result.error === undefined && result.checks.every((check) => check.pass !== false) }
}

// ---- The connection tasks

interface Servers {
  readonly notion: Awaited<ReturnType<typeof startFakeNotion>>
  readonly littlebird: Awaited<ReturnType<typeof startFakeLittlebird>>
  readonly t3: Awaited<ReturnType<typeof startFakeT3>>
}

interface ConnectionTask {
  readonly id: string
  readonly ask: string
  /** What the answer states, which the model must have read. */
  readonly facts: ReadonlyArray<string>
  readonly direct: ReadonlyArray<ModelStep>
  readonly codemode: ReadonlyArray<ModelStep>
}

let ids = 0
const calls = (...list: Array<[string, Record<string, unknown>]>) => reply(list.map(([name, args]) => ({ type: 'toolCall', id: `call-${++ids}`, name, arguments: args })) as never)
const callTool = (server: string, tool: string, args: Record<string, unknown>): [string, Record<string, unknown>] => ['call_tool', { server, tool, args }]
const script = (code: string) => reply([scriptCall(code)] as never)

const TASKS = (threads: ReadonlyArray<string>): ReadonlyArray<ConnectionTask> => [
  {
    id: 'notion-two-pages',
    ask: 'What did we decide about the launch in Notion, and what is on the roadmap?',
    facts: ['Decided to move the launch to Tuesday.', 'Q4: ship the topic view.'],
    direct: [
      calls(['find_tools', { server: 'notion', query: 'search fetch' }]),
      calls(callTool('notion', 'notion-search', { query: 'launch' }), callTool('notion', 'notion-search', { query: 'roadmap' })),
      calls(callTool('notion', 'notion-fetch', { id: 'page-notes' }), callTool('notion', 'notion-fetch', { id: 'page-roadmap' })),
      reply('<say>The meeting notes say the launch moved to Tuesday. The roadmap for Q4 is to ship the topic view.</say>'),
    ],
    codemode: [
      calls(['find_tools', { server: 'notion', query: 'search fetch' }]),
      script(`
        const read = async (tool, args) => JSON.parse((await tools.connection_read({ server: 'notion', tool, args })).split('\\n').slice(1).join('\\n'))
        const found = await Promise.all(['launch', 'roadmap'].map((query) => read('notion-search', { query })))
        const ids = [...new Set(found.flatMap((r) => r.structuredContent?.results ?? JSON.parse(r.content[0].text).results).map((p) => p.id))]
        const pages = await Promise.all(ids.map((id) => read('notion-fetch', { id })))
        text(pages.map((p) => { const page = p.structuredContent ?? JSON.parse(p.content[0].text); return page.title + ': ' + page.content }).join('\\n'))
      `),
      reply('<say>The meeting notes say the launch moved to Tuesday. The roadmap for Q4 is to ship the topic view.</say>'),
    ],
  },
  {
    id: 'littlebird-meetings',
    ask: 'What came out of this week\'s design review and planning meetings?',
    facts: ['Agreed on the calmer sidebar.', 'Moved the launch to Tuesday.'],
    direct: [
      calls(['find_tools', { server: 'littlebird', query: 'meeting' }]),
      calls(callTool('littlebird', 'search_meetings', { query: 'design' }), callTool('littlebird', 'search_meetings', { query: 'planning' })),
      calls(callTool('littlebird', 'get_meeting', { id: 'meeting-1' }), callTool('littlebird', 'get_meeting', { id: 'meeting-2' })),
      reply('<say>The design review agreed on the calmer sidebar. Planning moved the launch to Tuesday.</say>'),
    ],
    codemode: [
      calls(['find_tools', { server: 'littlebird', query: 'meeting' }]),
      script(`
        const read = async (tool, args) => { const r = JSON.parse((await tools.connection_read({ server: 'littlebird', tool, args })).split('\\n').slice(1).join('\\n')); return r.structuredContent ?? JSON.parse(r.content[0].text) }
        const found = await Promise.all(['design', 'planning'].map((query) => read('search_meetings', { query })))
        const meetings = await Promise.all(found.flatMap((r) => r.meetings).map((m) => read('get_meeting', { id: m.id })))
        text(meetings.map((m) => (m.meeting ?? m).title + ': ' + (m.meeting ?? m).summary).join('\\n'))
      `),
      reply('<say>The design review agreed on the calmer sidebar. Planning moved the launch to Tuesday.</say>'),
    ],
  },
  {
    id: 't3-running-threads',
    ask: 'Which T3 Code threads are still running, and what did each last say?',
    facts: ['Fixing the sidebar flake', 'Tests running, 2 of 5', 'Docs build is green'],
    direct: [
      calls(['find_tools', { server: 't3', query: 'thread' }]),
      calls(callTool('t3', 't3_thread_list', { statuses: ['running'] })),
      calls(...threads.map((threadId) => callTool('t3', 't3_thread_read', { threadId }))),
      reply('<say>Three are running: Fixing the sidebar flake, with tests running, 2 of 5; the docs build, which is green; and the third, still starting.</say>'),
    ],
    codemode: [
      calls(['find_tools', { server: 't3', query: 'thread' }]),
      script(`
        const read = async (tool, args) => { const r = JSON.parse((await tools.connection_read({ server: 't3', tool, args })).split('\\n').slice(1).join('\\n')); return r.structuredContent ?? JSON.parse(r.content[0].text) }
        const list = await read('t3_thread_list', { statuses: ['running'] })
        const threads = await Promise.all(list.threads.map((t) => read('t3_thread_read', { threadId: t.threadId })))
        text(threads.map((t, i) => list.threads[i].title + ': ' + ((t.items ?? []).at(-1)?.text ?? 'nothing yet')).join('\\n'))
      `),
      reply('<say>Three are running: Fixing the sidebar flake, with tests running, 2 of 5; the docs build, which is green; and the third, still starting.</say>'),
    ],
  },
]

/** The real MCP manager on the three fakes, signed in with in-memory OAuth. Littlebird's meeting reads are owner-reviewed. */
async function engine(servers: Servers, fake: Fake, codemode: boolean): Promise<{ turns: Turns; manager: McpManagerApi; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'juno-codemode-bench-'))
  const states = new Map<string, unknown>()
  const approvers = [[servers.notion.url, servers.notion.oauth], [servers.littlebird.url, servers.littlebird.oauth], [servers.t3.loopbackUrl, servers.t3.oauth]] as const
  const credentials: Credentials = {
    oauth: (id) => ({ load: () => states.get(id) as never, save: (state) => { states.set(id, state) } }),
    bearer: async () => undefined,
    values: async () => [],
    clear: async (id) => { states.delete(id) },
    openAuthorization: async (url) => {
      const approver = approvers.find(([server]) => new URL(server).origin === new URL(url).origin)
      if (approver === undefined) throw new Error(`no fake serves ${new URL(url).origin}`)
      await fetch(approver[1].approve(new URL(url)))
    },
  }
  let manager: McpManagerApi | undefined
  const opened = await openTurns({
    agentDir: dir, model: SONNET, migrations: [MCP_MIGRATIONS], ...(codemode ? { codemode: {} } : {}),
    now: () => Date.parse('2026-10-15T12:00:00Z'),
    provider: (store) => createProviderGuard({ store, transport: fake.models }),
    tools: (context) => {
      manager = createMcpManager({ store: context.store, credentials, defaults: [
        { ...NOTION, url: servers.notion.url },
        { ...LITTLEBIRD, url: servers.littlebird.url, allowlist: ['search_meetings', 'get_meeting'] },
        { ...T3, url: servers.t3.loopbackUrl },
      ] })
      return mcpTools(manager, { current: context.current, actions: context.actions })
    },
  })
  if (opened._tag !== 'running' || manager === undefined) throw new Error('the engine did not open')
  for (const id of ['notion', 'littlebird', 't3']) await manager.authorize(id)
  return { turns: opened, manager, dir }
}

async function connectionTask(servers: Servers, task: ConnectionTask, mode: Row['mode']): Promise<Row> {
  const fake = fakeProvider()
  const script = mode === 'direct' ? task.direct : task.codemode
  fake.script(script)
  const { turns, manager, dir } = await engine(servers, fake, mode === 'codemode')
  try {
    const started = performance.now()
    turns.accept({ opId: 'bench-1', kind: 'send', text: task.ask })
    await turns.idle()
    const ms = performance.now() - started
    const read = fake.requests.filter((r) => r.model === SONNET.modelId).map((r) => JSON.stringify(r.context.messages)).join('\n')
    const run = turns.store.db.prepare('SELECT ending FROM runs').get() as { ending: string } | undefined
    const ok = run !== undefined && JSON.parse(run.ending)._tag === 'complete' && fake.pending() === 0 && task.facts.every((fact) => read.includes(fact))
    return { task: task.id, mode, ...measure(fake, script), ms, ok }
  } finally {
    await turns.close()
    await manager.close()
    await rm(dir, { recursive: true, force: true })
  }
}

/** Three running T3 threads with a last message each, launched through the same manager. */
async function seedThreads(servers: Servers): Promise<ReadonlyArray<string>> {
  const fake = fakeProvider()
  const { turns, manager, dir } = await engine(servers, fake, false)
  try {
    const launched: string[] = []
    for (const title of ['Fixing the sidebar flake', 'Docs build', 'Search index']) {
      const result = await manager.invoke('t3', 't3_thread_launch', { title, message: `Start: ${title}`, projectId: 'project-juno' }, 'write') as { structuredContent?: { threadId: string }; content: Array<{ text: string }> }
      launched.push(result.structuredContent?.threadId ?? (JSON.parse(result.content[0]!.text) as { threadId: string }).threadId)
    }
    servers.t3.advance(launched[0]!, { reply: 'Tests running, 2 of 5' })
    servers.t3.advance(launched[1]!, { reply: 'Docs build is green' })
    return launched
  } finally {
    await turns.close()
    await manager.close()
    await rm(dir, { recursive: true, force: true })
  }
}

// ---- Run and report

const progress = (row: Row) => {
  console.error(`${row.task} ${row.mode}: ${row.turns} turns, ${Math.round(row.ms)} ms, ${row.ok ? 'ok' : 'FAILED'}`)
  return row
}
const median = (xs: ReadonlyArray<number>) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const tokens = (bytes: number) => Math.round(bytes / 4)

async function main() {
  const rows: Row[] = []
  const reads = CASES.filter((c) => c.script.some(isRead))
  const others = CASES.filter((c) => !c.script.some(isRead))
  for (let round = 0; round < ROUNDS; round++) {
    for (const c of [...reads, ...others]) for (const mode of ['direct', 'codemode'] as const) rows.push(progress(await evalCase(c, mode)))
  }
  const servers: Servers = { notion: await startFakeNotion(), littlebird: await startFakeLittlebird(), t3: await startFakeT3({ lan: false }) }
  try {
    const threads = await seedThreads(servers)
    for (let round = 0; round < ROUNDS; round++) {
      for (const task of TASKS(threads)) for (const mode of ['direct', 'codemode'] as const) rows.push(progress(await connectionTask(servers, task, mode)))
    }
  } finally {
    await servers.notion.close()
    await servers.littlebird.close()
    await servers.t3.close()
  }

  const tasks = [...new Set(rows.map((r) => r.task))]
  const lines = ['| Task | Reads moved | Mode | Turns | Prompt tokens | Completion tokens | Wall ms (median) | Success |', '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |']
  const totals = { direct: { turns: 0, prompt: 0, completion: 0, ms: 0, ok: 0, n: 0 }, codemode: { turns: 0, prompt: 0, completion: 0, ms: 0, ok: 0, n: 0 } }
  for (const task of tasks) {
    const moved = reads.some((c) => c.id === task) || !CASES.some((c) => c.id === task) ? 'yes' : 'no'
    for (const mode of ['direct', 'codemode'] as const) {
      const of = rows.filter((r) => r.task === task && r.mode === mode)
      const first = of[0]!
      const ms = median(of.map((r) => r.ms))
      const ok = of.filter((r) => r.ok).length
      const t = totals[mode]
      t.turns += first.turns; t.prompt += first.promptBytes; t.completion += first.completionBytes; t.ms += ms; t.ok += ok === of.length ? 1 : 0; t.n += 1
      lines.push(`| ${task} | ${moved} | ${mode} | ${first.turns} | ${tokens(first.promptBytes)} | ${tokens(first.completionBytes)} | ${Math.round(ms)} | ${ok}/${of.length} |`)
    }
  }
  for (const mode of ['direct', 'codemode'] as const) {
    const t = totals[mode]
    lines.push(`| **All ${t.n} tasks** | | ${mode} | ${t.turns} | ${tokens(t.prompt)} | ${tokens(t.completion)} | ${Math.round(t.ms)} | ${t.ok}/${t.n} |`)
  }
  console.log(lines.join('\n'))
}

await main()
