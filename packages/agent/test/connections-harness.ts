// MCP connections on the real turn engine, for the connection and T3 flow tests: the manager and its
// model tools, the scripted chat model, the fake decision model for the auto-review and, with `t3`,
// the T3 Code adapter with a poll clock the test moves by hand. Each test file calls
// `afterEach(closeConnections)`.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeProvider, fakeReview, fakeReviewer, reply, type FakeReviewAnswers, type FakeReviewRequest } from '@juno/agent-testing'
import { createProviderGuard, openTurns, type TurnEvent, type Turns } from '../src'
import { createMcpManager, MCP_MIGRATIONS, mcpExecutors, mcpTools, type Credentials, type McpManagerApi } from '../src/mcp'
import type { ConnectionConfig } from '../src/mcp/types'
import { createT3Adapter } from '../src/t3'
import type { Sleep } from '../src/t3/watch'
import { SONNET } from './turns-harness'

const cleanups: Array<() => Promise<void>> = []
/** Closes every engine, server and directory the file's tests opened. */
export async function closeConnections() {
  for (const close of cleanups.splice(0).toReversed()) await close()
}
/** Closes `close` after the test, before anything opened earlier. */
export function closeAfter(close: () => Promise<void> | void) {
  cleanups.push(async () => { await close() })
}

/** Credentials that sign in by approving the fake server's OAuth page; `opened` records each sign-in. */
export function credentials(approve: (url: URL) => URL = (url) => url, opened: string[] = []): Credentials {
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

/**
 * The T3 watcher's waits. None ends on its own: `tick` ends the current one and resolves when the
 * watcher waits again, so each tick is one more read of the session.
 */
export function pollClock() {
  const waits: number[] = []
  const sleeping = new Set<() => void>()
  const listeners = new Set<() => void>()
  const sleep: Sleep = (ms, signal) => new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      sleeping.delete(done)
      signal.removeEventListener('abort', done)
      resolve()
    }
    sleeping.add(done)
    signal.addEventListener('abort', done, { once: true })
    waits.push(ms)
    for (const listener of [...listeners]) listener()
  })
  /** Resolves once the watcher has started `n` waits in all. */
  const waited = (n: number) => new Promise<void>((resolve) => {
    const check = () => {
      if (waits.length < n) return
      listeners.delete(check)
      resolve()
    }
    listeners.add(check)
    check()
  })
  return {
    sleep, waits, waited,
    tick: async () => {
      const n = waits.length
      for (const done of [...sleeping]) done()
      await waited(n + 1)
    },
  }
}

type Answer = (request: FakeReviewRequest) => FakeReviewAnswers | 'fail' | 'hang'

export interface ConnectionsOptions {
  /** The connections the manager installs; the presets when absent. */
  readonly defaults?: ReadonlyArray<ConnectionConfig>
  /** The fake decision model's answer; `null` runs with no decision model at all. */
  readonly review?: Answer | null
  /** Only for a review that hangs: the default leaves a review that answers nothing to race. */
  readonly reviewTimeoutMs?: number
  readonly credentials?: Credentials
  /** Wires the T3 Code adapter, its jobs and Stop, on a `pollClock`. */
  readonly t3?: boolean
}

/** A model step that calls `name` with `args`. */
export interface Step { readonly name: string; readonly args: unknown }
export const callTool = (server: string, tool: string, args: unknown): Step => ({ name: 'call_tool', args: { server, tool, args } })
export const findTools = (args: { readonly server?: string; readonly query?: string; readonly tool?: string } = {}): Step => ({ name: 'find_tools', args })

export async function connections(options: ConnectionsOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'juno-connections-'))
  closeAfter(() => rm(dir, { recursive: true, force: true }))
  const creds = options.credentials ?? credentials()
  const fake = fakeProvider()
  const reviewer = fakeReviewer(options.review ?? fakeReview)
  const clock = pollClock()
  const open = async () => {
    let manager: McpManagerApi | undefined
    let t3: ReturnType<typeof createT3Adapter> | undefined
    const turns = await openTurns({
      agentDir: dir, model: SONNET, migrations: [MCP_MIGRATIONS],
      provider: (store) => {
        manager = createMcpManager({ store, credentials: creds, ...(options.defaults ? { defaults: options.defaults } : {}) })
        if (options.t3) t3 = createT3Adapter(manager, { sleep: clock.sleep })
        return createProviderGuard({ store, transport: fake.models })
      },
      jobDrivers: () => t3 ? [t3.driver] : [],
      stopExternalJob: async (job, click) => t3?.stop(job, click) ?? false,
      actions: { executors: () => [...(manager ? mcpExecutors(manager) : []), ...(t3?.executors ?? [])] },
      tools: (context) => {
        if (!manager) throw new Error('No manager')
        const review = options.review === null ? {} : { review: reviewer.model }
        const timeout = options.reviewTimeoutMs === undefined ? {} : { reviewTimeoutMs: options.reviewTimeoutMs }
        return [...mcpTools(manager, { current: context.current, actions: context.actions, ...review, ...timeout }), ...(t3?.tools(context) ?? [])]
      },
    })
    if (turns._tag !== 'running' || !manager) throw new Error('No engine')
    const m: McpManagerApi = manager
    const events: TurnEvent[] = []
    turns.subscribe((event) => events.push(event))
    m.subscribe(() => turns.actions.kick())
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      await m.close()
      await turns.close()
    }
    closeAfter(close)
    return { turns: turns as Turns, manager: m, events, close }
  }
  let engine = await open()
  let serial = 0

  /** One owner message whose run makes `steps` in order, then says one bubble. Returns the run's id and op. */
  const ask = async (text: string, ...steps: ReadonlyArray<Step>) => {
    const n = ++serial
    fake.script([
      ...steps.map((step, i) => reply({ type: 'toolCall', id: `call-${n}-${i}`, name: step.name, arguments: step.args as never })),
      reply('<say>Done.</say>'),
    ])
    const opId = `owner-${n}`
    engine.turns.accept({ opId, kind: 'send', text })
    await engine.turns.idle()
    const ended = engine.events.find((e): e is Extract<TurnEvent, { _tag: 'ended' }> => e._tag === 'ended' && e.opId === opId)
    if (!ended) throw new Error(`No run for ${opId}`)
    return { runId: ended.runId, opId }
  }

  /** Clicks the first open card (or the card `id`) and waits for what it runs. */
  const click = async (id?: string) => {
    const view = engine.turns.actions.views().find((v) => v.binding && (id === undefined || v.card.id === id))
    if (!view?.binding) throw new Error('No open card')
    engine.turns.actions.approve(`click-${++serial}`, view.binding.identity, view.binding.children)
    await engine.turns.actions.idle()
    // A click that settles a card starts a run that reads its outcome.
    await engine.turns.idle()
    return view.binding
  }

  /** The tool results the model read in request `n` (the latest by default), in order. */
  const results = (n = fake.requests.length - 1) => (fake.requests[n]?.context.messages ?? []).flatMap((m) => {
    const message = m as { role: string; content: ReadonlyArray<{ type: string; text?: string }> }
    return message.role === 'toolResult' ? [message.content.map((part) => part.text ?? '').join('')] : []
  })

  return {
    dir, fake, reviewer, clock, ask, click, results,
    get turns() { return engine.turns },
    get manager() { return engine.manager },
    /** Closes the engine and opens it again on the same directory and sign-ins, as a relaunch does. */
    restart: async () => {
      await engine.close()
      engine = await open()
    },
  }
}

/** The calls of `tool` that reached `server`. */
export const callsOf = (server: { readonly calls: ReadonlyArray<{ readonly name: string; readonly args: Record<string, unknown> }> }, tool: string) =>
  server.calls.filter((call) => call.name === tool)

/**
 * Resolves when `test` holds, checking after each change `subscribe` reports: the manager's
 * (a refresh, a sign-in) or the cards' (`turns.actions.subscribe`).
 */
export function until(subscribe: (listener: () => void) => () => void, test: () => boolean) {
  return new Promise<void>((resolve) => {
    if (test()) return resolve()
    const off = subscribe(() => {
      if (!test()) return
      off()
      resolve()
    })
  })
}
