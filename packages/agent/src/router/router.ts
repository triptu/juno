/**
 * The router (plan v3 §5.2, §8; replaces WP8's serial loop and keeps its
 * bridge). It owns the live run: its history cutoff `H`, its clean flag, its
 * inputs, its text and status, and how it ends.
 *
 * The chat has two inputs and nothing else: queue a message (`accept`) and
 * listen to events (`subscribe`). Nothing the owner does stops a run. To
 * change course they send another message, and Juno reads it at its next
 * step.
 *
 * One input, one run:
 *
 *   idle ─▶ begin: commit the run (H, origin) ─▶ deliver: reset, submit ─▶ live
 *   live ─▶ every request is built by the request builder (pi's beforeRequest)
 *   live ─▶ input that arrives is held, and joins at the next boundary as a
 *           pi steer: after a tool round (afterTools) or at an answer (onYield)
 *   live ─▶ settled: the ending is committed, then each input op is settled
 *
 * Why input is held until a boundary rather than submitted to pi at once:
 * pi places a steer only at a boundary of a working run. When a run fails,
 * pi keeps a queued steer until the next input places it, so a message
 * queued in pi during a failed run would wait for another message. Handed
 * over at the boundary, pi places it right there, exactly as a steer
 * submitted earlier would be. Held input that no boundary took starts the
 * next run.
 *
 * Endings (agent-contract `Ending`): the builder's refusal (`blocked`,
 * `interrupted`) or the guard's failure code from the failed response
 * (`failed`, `blocked`, `interrupted`); `complete` when pi answered every
 * input; `interrupted` otherwise. Owner runs carry the op to retry on
 * `interrupted` and `failed`.
 *
 * A crash anywhere resumes: the run row is committed before the input is
 * delivered, and an input op is settled only after the run's ending is
 * committed. `restore` rebuilds the live run before pi resumes it.
 */
import type { Ending, OpId } from '@juno/agent-contract'
import { deliver } from '../inbox/bridge'
import { accept, find, nextAccepted, settle, unsettled, type Accept, type InboxKind, type InboxOp } from '../inbox/inbox'
import { providerFailure, type StreamProgress } from '../providers'
import type { ChatModel, RequestBuilder, WireMessage } from '../request/builder'
import type { JunoTool, ToolRun } from '../request/tool'
import type { Journal, Settled } from '../runtime/journal'
import { transaction } from '../store/database'
import { mode, setMode, type Mode } from '../store/ledger'
import { uuidv7, type Store } from '../store/store'
import type { Origin, RunState, TurnEvent } from './events'

/** The status line changes at most this often (§8). */
export const STATUS_INTERVAL_MS = 2_000

export interface Session {
  readonly journal: () => Journal
  /** Projects every journal commit into the archive. */
  readonly catchUp: () => Promise<void>
}

export interface RouterOptions {
  readonly store: Store
  readonly session: Session
  readonly builder: RequestBuilder
  readonly model: { readonly provider: string; readonly modelId: string }
  readonly tools: () => ReadonlyArray<JunoTool & { readonly taints?: boolean }>
  /** Rotation between runs (§3): when asked, or when the journal is a month old. */
  readonly rotate: () => Promise<void>
  readonly rotationDue: () => boolean
  readonly onRunEnded?: () => void
  readonly onReport?: (error: unknown) => void
}

interface Live {
  readonly runId: string
  readonly opId: string
  readonly origin: Origin
  readonly h: number
  clean: boolean
  /** Inbox op → its pi submission, once delivered. */
  readonly inputs: Map<string, string | undefined>
  failure: Ending | undefined
  /** Text of the run's finished requests, and of the one streaming now. */
  done: string
  partial: string
  /** The current request's response has started. */
  streamed: boolean
  status: { text?: string } | undefined
  statusAt: number
  nextStatus: string | undefined
  statusTimer: ReturnType<typeof setTimeout> | undefined
  readonly calls: Map<string, number>
  flushing: Promise<void>
}

const originOf = (kind: InboxKind): Origin => (kind === 'send' || kind === 'steer' || kind === 'retry' ? 'owner' : kind)
const join = (...parts: ReadonlyArray<string>) => parts.filter((part) => part !== '').join('\n\n')
const settledStates = new Set(['done', 'interrupted', 'failed'])

const live = (row: { id: string; op_id: string; origin: Origin; h: number; clean: number }): Live => ({
  runId: row.id, opId: row.op_id, origin: row.origin, h: row.h, clean: row.clean === 1,
  inputs: new Map(), failure: undefined,
  done: '', partial: '', streamed: false, status: {}, statusAt: 0, nextStatus: undefined, statusTimer: undefined,
  calls: new Map(), flushing: Promise.resolve(),
})
/** The inbox state an op settles in for a run's ending. */
const stateFor = (ending: Ending): 'done' | 'interrupted' | 'failed' =>
  ending._tag === 'complete' ? 'done' : ending._tag === 'interrupted' ? 'interrupted' : 'failed'
const reasonFor = (ending: Ending) => ('reason' in ending ? `${ending._tag}:${ending.reason}` : ending._tag)

export type Retry =
  | Accept
  /** The op is not an interrupted or failed owner send. */
  | { readonly _tag: 'refused'; readonly reason: 'notRetryable' }

export function createRouter(options: RouterOptions) {
  const { store, session, builder } = options
  const listeners = new Set<(event: TurnEvent) => void>()
  const emit = (event: TurnEvent) => {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (error) {
        options.onReport?.(error)
      }
    }
  }
  let current: Live | undefined
  let closing = false
  let signalled = false
  let wake: (() => void) | undefined
  const signal = () => {
    signalled = true
    wake?.()
  }
  const idleWaiters: Array<() => void> = []
  const rotateWaiters: Array<() => void> = []
  const isIdle = () => current === undefined && (mode(store) !== 'on' || nextAccepted(store) === undefined)
  const notifyIdle = () => {
    if (isIdle()) for (const resolve of idleWaiters.splice(0)) resolve()
  }
  const archiveLength = () => (store.db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n

  const text = (run: Live) => join(run.done, run.partial)

  // ---- Endings

  const endingOf = (run: Live, results: ReadonlyMap<string, Settled | InboxOp['state']>): Ending => {
    const retry = run.origin === 'owner' ? { retry: run.opId as OpId } : {}
    if (run.failure !== undefined) {
      return run.failure._tag === 'interrupted' || run.failure._tag === 'failed' ? { ...run.failure, ...retry } : run.failure
    }
    const answered = [...results.values()].every((result) => (typeof result === 'string' ? result === 'done' : result.status === 'done'))
    return answered ? { _tag: 'complete' } : { _tag: 'interrupted', ...retry }
  }
  const finish = (run: Live, ending: Ending) => {
    transaction(store.db, () => {
      store.db.prepare('UPDATE runs SET ended_at = ?, ending = ? WHERE id = ? AND ended_at IS NULL').run(store.now(), JSON.stringify(ending), run.runId)
    })
    for (const opId of run.inputs.keys()) settle(store, opId, stateFor(ending), reasonFor(ending))
    if (run.statusTimer !== undefined) clearTimeout(run.statusTimer)
    if (current === run) current = undefined
    emit({ _tag: 'ended', runId: run.runId, opId: run.opId, ending })
    options.onRunEnded?.()
  }

  // ---- Restore, before pi resumes

  const restore = () => {
    // A run whose ending was committed before its ops were settled.
    const ended = store.db
      .prepare(
        `SELECT runs.ending, run_inputs.op_id AS opId FROM runs JOIN run_inputs ON run_inputs.run_id = runs.id JOIN inbox ON inbox.op_id = run_inputs.op_id
         WHERE runs.ended_at IS NOT NULL AND inbox.state IN ('accepted', 'submitted')`,
      )
      .all() as Array<{ ending: string; opId: string }>
    for (const row of ended) {
      const ending = JSON.parse(row.ending) as Ending
      settle(store, row.opId, stateFor(ending), reasonFor(ending))
    }
    const journal = session.journal()
    const open = unsettled(store, journal.incarnation)
    let row = store.db.prepare('SELECT id, op_id, origin, h, clean FROM runs WHERE ended_at IS NULL').get() as
      | { id: string; op_id: string; origin: Origin; h: number; clean: number }
      | undefined
    if (row === undefined) {
      const first = open[0]
      if (first === undefined) return
      // Submitted with no run row: adopt it, with H before its first message.
      const at = store.db.prepare('SELECT min(id) AS id FROM messages WHERE origin_op = ?').get(first.opId) as { id: number | null }
      const id = uuidv7(store.now())
      transaction(store.db, () => {
        store.db
          .prepare('INSERT INTO runs (id, op_id, origin, h, clean, started_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, first.opId, originOf(first.kind), at.id ?? archiveLength(), originOf(first.kind) === 'owner' ? 1 : 0, store.now())
        store.db.prepare('INSERT OR IGNORE INTO run_inputs (op_id, run_id, steer) VALUES (?, ?, 0)').run(first.opId, id)
      })
      row = { id, op_id: first.opId, origin: originOf(first.kind), h: at.id ?? archiveLength(), clean: 0 }
    }
    const run = live(row)
    const inputs = store.db.prepare('SELECT op_id AS opId FROM run_inputs WHERE run_id = ?').all(run.runId) as Array<{ opId: string }>
    for (const input of inputs) run.inputs.set(input.opId, find(store, input.opId)?.submissionId ?? undefined)
    for (const op of open) {
      if (run.inputs.has(op.opId)) continue
      transaction(store.db, () => {
        store.db.prepare('INSERT OR IGNORE INTO run_inputs (op_id, run_id, steer) VALUES (?, ?, 1)').run(op.opId, run.runId)
      })
      run.inputs.set(op.opId, op.submissionId ?? undefined)
    }
    current = run
  }

  // ---- A run

  const begin = async (op: InboxOp): Promise<Live> => {
    await session.catchUp()
    const origin = originOf(op.kind)
    const row = { id: uuidv7(store.now()), op_id: op.opId, origin, h: archiveLength(), clean: origin === 'owner' ? 1 : 0 }
    transaction(store.db, () => {
      store.db
        .prepare('INSERT INTO runs (id, op_id, origin, h, clean, started_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.id, row.op_id, row.origin, row.h, row.clean, store.now())
      store.db.prepare('INSERT INTO run_inputs (op_id, run_id, steer) VALUES (?, ?, 0)').run(op.opId, row.id)
    })
    const run = live(row)
    run.inputs.set(op.opId, undefined)
    current = run
    emit({ _tag: 'started', runId: run.runId, opId: run.opId, origin })
    return run
  }

  const runToEnd = async (run: Live) => {
    const journal = session.journal()
    const input = find(store, run.opId)
    if (input === undefined) throw new Error(`run ${run.runId} has no input`)
    if (input.state === 'accepted') run.inputs.set(input.opId, await deliver(store, journal, input, { steer: false }))
    const results = new Map<string, Settled | InboxOp['state']>()
    for (;;) {
      const pending = [...run.inputs].filter(([opId]) => !results.has(opId))
      if (pending.length === 0) break
      for (const [opId, submission] of pending) {
        const state = find(store, opId)?.state
        if (state !== undefined && settledStates.has(state)) results.set(opId, state)
        else if (submission === undefined) results.set(opId, { status: 'unanswered', reason: 'missing' })
        else results.set(opId, await journal.wait(submission))
      }
      await run.flushing
    }
    await session.catchUp()
    finish(run, endingOf(run, results))
  }

  // ---- What the run shows

  const progress = (run: Live, update: StreamProgress) => {
    if (run !== current) return
    run.streamed = true
    if (update.text === run.partial) return
    run.partial = update.text
    if (update.text === '') return
    run.status = undefined
    run.nextStatus = undefined
    emit({ _tag: 'text', runId: run.runId, text: text(run) })
  }

  const showStatus = (run: Live, line: string) => {
    const apply = (next: string) => {
      run.status = { text: next }
      run.statusAt = store.now()
      run.nextStatus = undefined
      emit({ _tag: 'status', runId: run.runId, text: next })
    }
    const wait = run.statusAt + STATUS_INTERVAL_MS - store.now()
    if (run.status?.text === undefined || wait <= 0) return apply(line)
    if (run.status.text === line) return
    run.nextStatus = line
    run.statusTimer ??= setTimeout(() => {
      run.statusTimer = undefined
      if (run === current && run.status !== undefined && run.nextStatus !== undefined) apply(run.nextStatus)
    }, wait)
  }

  const taint = (run: Live) => {
    if (!run.clean) return
    run.clean = false
    transaction(store.db, () => {
      store.db.prepare('UPDATE runs SET clean = 0 WHERE id = ?').run(run.runId)
    })
  }

  const toolStarted = (name: string) => {
    const run = current
    if (run === undefined) return
    const tool = options.tools().find((t) => t.name === name)
    const count = (run.calls.get(name) ?? 0) + 1
    run.calls.set(name, count)
    if (tool?.taints) taint(run)
    showStatus(run, tool?.status(count) ?? 'Working')
  }

  /** Delivers held input into the live run at a boundary, oldest first. */
  const flush = async () => {
    const run = current
    if (run === undefined || mode(store) !== 'on') return
    const work = (async () => {
      for (;;) {
        const op = nextAccepted(store)
        if (op === undefined || run.inputs.has(op.opId) || run !== current) return
        // §6.4: a steered report or wake is untrusted content.
        if (originOf(op.kind) === 'report' || originOf(op.kind) === 'wake') taint(run)
        transaction(store.db, () => {
          store.db.prepare('INSERT OR IGNORE INTO run_inputs (op_id, run_id, steer) VALUES (?, ?, 1)').run(op.opId, run.runId)
        })
        run.inputs.set(op.opId, await deliver(store, session.journal(), op, { steer: true }))
        emit({ _tag: 'steered', runId: run.runId, opId: op.opId })
      }
    })()
    run.flushing = run.flushing.then(() => work)
    await work
  }

  /** pi hooks of the root conversation's generation and tool tasks. */
  const hooks = {
    generation: {
      beforeRequest: async (
        request: { readonly messages: ReadonlyArray<WireMessage> },
        api: { readonly models: { readonly getModel: (provider: string, id: string) => ChatModel | undefined } },
      ) => {
        const run = current
        if (run === undefined) throw new Error('no live run')
        await session.catchUp()
        run.streamed = false
        const model = api.models.getModel(options.model.provider, options.model.modelId)
        if (model === undefined) {
          run.failure ??= { _tag: 'interrupted' }
          throw new Error('the chat model is not available')
        }
        const built = builder.chat({ h: run.h, messages: request.messages, model, observe: (update) => progress(run, update) })
        if (built._tag === 'refused') {
          // pi then sends its raw context, which the guard refuses: no provider call.
          run.failure ??= built.ending
          throw new Error('the request was refused before dispatch')
        }
        return { messages: built.messages }
      },
      afterResponse: (message: { readonly stopReason: string; readonly errorMessage?: string }) => {
        const run = current
        if (run === undefined) return
        if (message.stopReason === 'error') {
          const ending = providerFailure(message.errorMessage).ending
          // A response that started and then lost its stream cut the reply short: the run was interrupted.
          const lost = run.streamed && ending._tag === 'failed' && ending.reason === 'offline'
          run.failure ??= lost ? { _tag: 'interrupted' } : ending
        }
        run.done = text(run)
        run.partial = ''
      },
      afterTools: () => flush(),
      onYield: async () => {
        await flush()
        return undefined
      },
    },
    tool: {
      beforeTool: (call: { readonly name: string }) => {
        toolStarted(call.name)
        return undefined
      },
    },
  }

  // ---- The loop

  const loop = async () => {
    for (;;) {
      if (closing) return
      signalled = false
      if (current !== undefined) {
        await runToEnd(current)
        continue
      }
      if (rotateWaiters.length > 0 || options.rotationDue()) {
        const waiting = rotateWaiters.splice(0)
        await options.rotate()
        for (const resolve of waiting) resolve()
        continue
      }
      const op = mode(store) === 'on' ? nextAccepted(store) : undefined
      if (op === undefined) {
        notifyIdle()
        if (!signalled) await new Promise<void>((resolve) => (wake = resolve))
        wake = undefined
        continue
      }
      await begin(op)
    }
  }

  let done: Promise<void> = Promise.resolve()

  return {
    hooks,
    restore,
    /** Starts the loop. Call after `restore` and pi's resume. */
    start: () => {
      done = loop().catch((error: unknown) => {
        // After close, pi rejects pending waits; the ops stay submitted and resume next time.
        if (!closing) options.onReport?.(error)
      })
    },
    /** Queues input: it joins the live run at its next step, or starts a run. */
    accept: (input: { readonly opId: string; readonly kind: InboxKind; readonly text: string; readonly data?: unknown }): Accept => {
      const result = accept(store, input)
      signal()
      return result
    },
    /** "Try again" on an interrupted or failed owner send: a new op with the same text. */
    retry: (input: { readonly opId: string; readonly interruptedOpId: string }): Retry => {
      const earlier = find(store, input.interruptedOpId)
      if (earlier === undefined || originOf(earlier.kind) !== 'owner' || (earlier.state !== 'interrupted' && earlier.state !== 'failed')) {
        return { _tag: 'refused', reason: 'notRetryable' }
      }
      const result = accept(store, { opId: input.opId, kind: 'retry', text: earlier.text, data: { retryOf: earlier.opId } })
      signal()
      return result
    },
    mode: (): Mode => mode(store),
    setMode: (next: Mode) => {
      setMode(store, next)
      signal()
    },
    state: (): RunState | undefined => {
      const run = current
      if (run === undefined) return undefined
      return { runId: run.runId, opId: run.opId, origin: run.origin, text: text(run), status: run.status }
    },
    /** The live run's cutoff, for the compactor's ceiling (G2). */
    cutoff: (): number | undefined => current?.h,
    /** The live run as a tool sees it. Call it inside the tool's `execute()`. */
    toolRun: async (): Promise<ToolRun | undefined> => {
      const run = current
      if (run === undefined) return undefined
      const journal = session.journal()
      const position = { incarnation: journal.incarnation, seq: await journal.lastCommitted() }
      await session.catchUp()
      return { runId: run.runId, opId: run.opId, h: run.h, cutoff: archiveLength(), clean: run.clean, position }
    },
    emit,
    subscribe: (listener: (event: TurnEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    rotate: () =>
      new Promise<void>((resolve) => {
        rotateWaiters.push(resolve)
        signal()
      }),
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve)
        notifyIdle()
        signal()
      }),
    close: async () => {
      closing = true
      signal()
      return done
    },
    /** Resolves when the loop has stopped. */
    stopped: () => done,
  }
}

export type Router = ReturnType<typeof createRouter>
