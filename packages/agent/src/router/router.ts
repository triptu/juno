/**
 * The router (plan v3 §5.2, §8; replaces WP8's serial loop and keeps its
 * bridge). It owns the live run: its history cutoff `H`, its clean flag, its
 * inputs, its text and status, and how it ends.
 *
 * The chat has two inputs and nothing else: queue an input (`accept`: a
 * message, a reply or a reaction) and listen to events (`subscribe`).
 * Nothing the owner does stops a run. To change course they send another
 * message, and Juno reads it at its next step.
 *
 * The owner sees only what the model marks (`output.ts`): each closed
 * `<say>` block is a `bubble` event, whole, and each `<react>` a `reaction`.
 * The rest of the model's text never leaves the agent.
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
import { takeSummary, type JunoTool, type ToolRun } from '../request/tool'
import type { Journal, Settled } from '../runtime/journal'
import { transaction } from '../store/database'
import { mode, setMode, type Mode } from '../store/ledger'
import { uuidv7, type Store } from '../store/store'
import { ownerFilesOf, THUMBS_UP, type JunoFileInput, type ReplyTarget } from '@juno/agent-contract'
import type { Origin, RunState, TurnEvent } from './events'
import { admittedFiles, clearBodies, copyFiles, storeFiles, withImages } from './files'
import { archivedBubble, carriesFiles, modelText, ownerOpOf, readsTopic, runText, type CardText } from './input'
import { parseOutput } from './output'
import { resolveSpans, sourceTable } from './sources'
import { stepLog, type StepLog } from './steps'

export interface Session {
  readonly journal: () => Journal
  /** Projects every journal commit into the archive. */
  readonly catchUp: () => Promise<void>
}

export interface RouterOptions {
  readonly store: Store
  readonly session: Session
  readonly builder: RequestBuilder
  /** The model pi runs with now. It changes only between runs (`beforeRun`). */
  readonly model: () => { readonly provider: string; readonly modelId: string }
  readonly tools: () => ReadonlyArray<JunoTool & { readonly taints?: boolean }>
  /** Rotation between runs (§3): when asked, or when the journal is a month old. */
  readonly rotate: () => Promise<void>
  readonly rotationDue: () => boolean
  /** Called with no run live, before the next one begins: a model change applies here. */
  readonly beforeRun?: () => Promise<void>
  readonly startWake?: (opId: string, persist: () => void) => boolean
  readonly onRunEnded?: () => void
  /** Card outcomes the model has not read, and a reply's quote of a card (WP15). */
  readonly cards?: CardText
  /** Whether this Mac may start or steer a run besides the run mode: it owns Juno (WP21). Default yes. */
  readonly admits?: () => boolean
  readonly onReport?: (error: unknown) => void
}

interface Live {
  readonly runId: string
  readonly opId: string
  readonly origin: Origin
  readonly h: number
  clean: boolean
  /**
   * `clean` when the current request was built: what the model had read when
   * it wrote this response's tool calls. A call in the response that taints the
   * run (a connection read) does not change what the model wrote beside it.
   */
  cleanAtRequest: boolean
  /** Inbox op → its pi submission, once delivered. */
  readonly inputs: Map<string, string | undefined>
  failure: Ending | undefined
  /** Text of the run's finished requests, and of the one streaming now. */
  done: string
  partial: string
  /** The current request's response has started. */
  streamed: boolean
  /** Bubbles and reactions already published, by index in the run's parsed text. */
  readonly bubbles: Array<RunState['bubbles'][number]>
  reactions: number
  /** The status bubble: dots, or a tool's line. */
  status: { text?: string }
  /** The run was started by an owner message, so Try again can resend it. */
  readonly retryable: boolean
  readonly calls: Map<string, number>
  flushing: Promise<void>
}

/** A tool call as pi's tool hooks give it. `parent` is set for a call a running script made. */
interface ToolHookCall {
  readonly name: string
  readonly id?: string
  readonly arguments?: unknown
  readonly parent?: unknown
}

/** A tool's result as pi's `afterTool` gives it. */
interface ToolResult {
  readonly output?: ReadonlyArray<{ readonly type: string; readonly text?: unknown }>
  readonly isError?: boolean
}

const originOf = (kind: InboxKind): Origin => (kind === 'send' || kind === 'steer' || kind === 'retry' || kind === 'react' ? 'owner' : kind)
const isMessage = (kind: InboxKind | undefined) => kind === 'send' || kind === 'steer' || kind === 'retry'
const join = (...parts: ReadonlyArray<string>) => parts.filter((part) => part !== '').join('\n\n')
const settledStates = new Set(['done', 'interrupted', 'failed'])

const live = (row: { id: string; op_id: string; origin: Origin; h: number; clean: number }, retryable: boolean): Live => ({
  runId: row.id, opId: row.op_id, origin: row.origin, h: row.h, clean: row.clean === 1, cleanAtRequest: row.clean === 1,
  inputs: new Map(), failure: undefined,
  done: '', partial: '', streamed: false, bubbles: [], reactions: 0, status: {}, retryable,
  calls: new Map(), flushing: Promise.resolve(),
})
/** The inbox state an op settles in for a run's ending. */
const stateFor = (ending: Ending): 'done' | 'interrupted' | 'failed' =>
  ending._tag === 'complete' ? 'done' : ending._tag === 'interrupted' ? 'interrupted' : 'failed'
const reasonFor = (ending: Ending) => ('reason' in ending ? `${ending._tag}:${ending.reason}` : ending._tag)

/** An input the owner queues: a message (maybe a reply), a reaction, or a report, wake or click. */
export type Input =
  | {
      readonly opId: string
      readonly kind: Exclude<InboxKind, 'react'>
      readonly text: string
      readonly data?: unknown
      /** A reply to a Juno bubble or card. Not a click. */
      readonly replyTo?: ReplyTarget
      /** Images and text files for the model, stored with the op. */
      readonly files?: ReadonlyArray<JunoFileInput>
    }
  | {
      readonly opId: string
      readonly kind: 'react'
      readonly target: Extract<ReplyTarget, { _tag: 'bubble' | 'card' }>
      /** `null` removes the owner's reaction. */
      readonly emoji: string | null
    }

export type Queued =
  | Accept
  /** A thumbs up or a removal: stored with the item, no run. */
  | { readonly _tag: 'recorded' }

export type Retry =
  | Accept
  /** The op is not an interrupted or failed owner send. */
  | { readonly _tag: 'refused'; readonly reason: 'notRetryable' }

export function createRouter(options: RouterOptions) {
  return new Router(options)
}

class Router {
  private readonly options: RouterOptions

  constructor(options: RouterOptions) {
    this.options = options
    this.steps = stepLog(options.store)
  }

  private get store() { return this.options.store }
  private get session() { return this.options.session }
  private get builder() { return this.options.builder }

  private listeners = new Set<(event: TurnEvent) => void>()

  emit = (event: TurnEvent) => {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        this.options.onReport?.(error)
      }
    }
  }

  private current: Live | undefined

  /** The run begun last, live or ended: a chat request the guard reports late still belongs to it. */
  private latest: string | undefined

  private readonly steps: StepLog

  private closing = false

  private signalled = false

  private wake: (() => void) | undefined

  private signal = () => {
    this.signalled = true
    this.wake?.()
  }

  private admitting = () => mode(this.store) === 'on' && (this.options.admits?.() ?? true)

  private idleWaiters: Array<() => void> = []

  private rotateWaiters: Array<() => void> = []

  private isIdle = () => this.current === undefined && (!this.admitting() || nextAccepted(this.store) === undefined)

  private notifyIdle = () => {
    if (this.isIdle()) for (const resolve of this.idleWaiters.splice(0)) resolve()
  }

  private archiveLength = () => (this.store.db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n

  private text = (run: Live) => join(run.done, run.partial)

  // ---- Endings

  private endingOf = (run: Live, results: ReadonlyMap<string, Settled | InboxOp['state']>): Ending => {
    const retry = run.retryable ? { retry: run.opId as OpId } : {}
    if (run.failure !== undefined) {
      return run.failure._tag === 'interrupted' || run.failure._tag === 'failed' ? { ...run.failure, ...retry } : run.failure
    }
    const answered = [...results.values()].every((result) => (typeof result === 'string' ? result === 'done' : result.status === 'done'))
    return answered ? { _tag: 'complete' } : { _tag: 'interrupted', ...retry }
  }

  private finish = (run: Live, ending: Ending) => {
    transaction(this.store.db, () => {
      this.store.db.prepare('UPDATE runs SET ended_at = ?, ending = ? WHERE id = ? AND ended_at IS NULL').run(this.store.now(), JSON.stringify(ending), run.runId)
    })
    for (const opId of run.inputs.keys()) settle(this.store, opId, stateFor(ending), reasonFor(ending))
    // Only the run a file arrived in sends it; Try again needs it after an interruption or a failure.
    if (ending._tag === 'complete') clearBodies(this.store, [...run.inputs.keys()])
    if (this.current === run) this.current = undefined
    this.emit({ _tag: 'ended', runId: run.runId, opId: run.opId, ending })
    this.options.onRunEnded?.()
  }

  // ---- Restore, before pi resumes

  restore = () => {
    // A run whose ending was committed before its ops were settled.
    const ended = this.store.db
      .prepare(
        `SELECT runs.ending, run_inputs.op_id AS opId FROM runs JOIN run_inputs ON run_inputs.run_id = runs.id JOIN inbox ON inbox.op_id = run_inputs.op_id
         WHERE runs.ended_at IS NOT NULL AND inbox.state IN ('accepted', 'submitted')`,
      )
      .all() as Array<{ ending: string; opId: string }>
    for (const row of ended) {
      const ending = JSON.parse(row.ending) as Ending
      settle(this.store, row.opId, stateFor(ending), reasonFor(ending))
    }
    const journal = this.session.journal()
    const open = unsettled(this.store, journal.incarnation)
    let row = this.store.db.prepare('SELECT id, op_id, origin, h, clean FROM runs WHERE ended_at IS NULL').get() as
      | { id: string; op_id: string; origin: Origin; h: number; clean: number }
      | undefined
    if (row === undefined) {
      const first = open[0]
      if (first === undefined) return
      // Submitted with no run row: adopt it, with H before its first message.
      const at = this.store.db.prepare('SELECT min(id) AS id FROM messages WHERE origin_op = ?').get(first.opId) as { id: number | null }
      const id = uuidv7(this.store.now())
      transaction(this.store.db, () => {
        this.store.db
          .prepare('INSERT INTO runs (id, op_id, origin, h, clean, started_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, first.opId, originOf(first.kind), at.id ?? this.archiveLength(), originOf(first.kind) === 'owner' ? 1 : 0, this.store.now())
        this.store.db.prepare('INSERT OR IGNORE INTO run_inputs (op_id, run_id, steer) VALUES (?, ?, 0)').run(first.opId, id)
      })
      row = { id, op_id: first.opId, origin: originOf(first.kind), h: at.id ?? this.archiveLength(), clean: 0 }
    }
    const run = live(row, isMessage(find(this.store, row.op_id)?.kind))
    // What the run already wrote, so bubble numbers carry on where they were.
    run.done = runText(this.store, run.runId)
    const published = parseOutput(run.done)
    const sources = sourceTable(this.store, run.runId)
    run.bubbles.push(...published.bubbles.map((bubble, n) => ({ id: `${run.runId}:${n}`, text: bubble.text, body: resolveSpans(bubble.spans, sources) })))
    run.reactions = published.reactions.length
    const inputs = this.store.db.prepare('SELECT op_id AS opId FROM run_inputs WHERE run_id = ?').all(run.runId) as Array<{ opId: string }>
    for (const input of inputs) run.inputs.set(input.opId, find(this.store, input.opId)?.submissionId ?? undefined)
    for (const op of open) {
      if (run.inputs.has(op.opId)) continue
      transaction(this.store.db, () => {
        this.store.db.prepare('INSERT OR IGNORE INTO run_inputs (op_id, run_id, steer) VALUES (?, ?, 1)').run(op.opId, run.runId)
      })
      run.inputs.set(op.opId, op.submissionId ?? undefined)
    }
    this.current = run
  }

  // ---- A run

  private persistInput = (op: InboxOp, persist: () => void): boolean => {
    if (op.kind === 'wake' && this.options.startWake !== undefined) {
      if (this.options.startWake(op.opId, persist)) return true
      settle(this.store, op.opId, 'interrupted', 'schedule cancelled')
      return false
    }
    transaction(this.store.db, persist)
    return true
  }

  private begin = async (op: InboxOp): Promise<Live | undefined> => {
    await this.session.catchUp()
    if (!this.admitting()) return undefined
    const origin = originOf(op.kind)
    // A message sent beside a topic carries Slack content (SPEC 7), and one with files carries their content: the run starts tainted.
    const row = { id: uuidv7(this.store.now()), op_id: op.opId, origin, h: this.archiveLength(), clean: origin === 'owner' && !readsTopic(op) && !carriesFiles(op) ? 1 : 0 }
    if (!this.persistInput(op, () => {
      this.store.db
        .prepare('INSERT INTO runs (id, op_id, origin, h, clean, started_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.id, row.op_id, row.origin, row.h, row.clean, this.store.now())
      this.store.db.prepare('INSERT INTO run_inputs (op_id, run_id, steer) VALUES (?, ?, 0)').run(op.opId, row.id)
    })) return undefined
    const run = live(row, isMessage(op.kind))
    run.inputs.set(op.opId, undefined)
    this.current = run
    this.latest = run.runId
    this.emit({ _tag: 'started', runId: run.runId, opId: run.opId, origin })
    return run
  }

  private runToEnd = async (run: Live) => {
    const journal = this.session.journal()
    const input = find(this.store, run.opId)
    if (input === undefined) throw new Error(`run ${run.runId} has no input`)
    if (input.state === 'accepted') run.inputs.set(input.opId, await deliver(this.store, journal, input, { steer: false, text: () => this.inputText(input, run) }))
    // A crash can leave a steered input recorded in run_inputs but not yet in pi.
    for (const opId of run.inputs.keys()) {
      if (opId === run.opId) continue
      const queued = find(this.store, opId)
      if (queued?.state === 'accepted') run.inputs.set(opId, await deliver(this.store, journal, queued, { steer: true, text: () => this.inputText(queued, run) }))
    }
    const results = new Map<string, Settled | InboxOp['state']>()
    for (;;) {
      const pending = [...run.inputs].filter(([opId]) => !results.has(opId))
      if (pending.length === 0) break
      for (const [opId, submission] of pending) {
        const state = find(this.store, opId)?.state
        if (state !== undefined && settledStates.has(state)) results.set(opId, state)
        else if (submission === undefined) results.set(opId, { status: 'unanswered', reason: 'missing' })
        else results.set(opId, await journal.wait(submission))
      }
      await run.flushing
    }
    await this.session.catchUp()
    this.finish(run, this.endingOf(run, results))
  }

  // ---- What the run shows

  /** A bubble's text: from the live run, or from the archive. */
  private bubbleText = (id: string) => this.current?.bubbles.find((bubble) => bubble.id === id)?.text ?? archivedBubble(this.store, id)

  private inputText = (op: InboxOp, run: Live) => {
    const text = withImages(this.store, op.opId, modelText(this.store, op, this.bubbleText, this.options.cards))
    // A connection call's result carried with the input is something Juno read (§6.4).
    if (this.options.cards?.carriesData?.(op.opId)) this.taint(run)
    return text
  }

  private recordReaction = (input: { opId: string; kind: 'bubble' | 'card' | 'owner'; id: string; by: 'owner' | 'juno'; emoji: string | null }) => {
    const added = transaction(this.store.db, () =>
      this.store.db
        .prepare('INSERT OR IGNORE INTO reactions (op_id, target_kind, target_id, by, emoji, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.opId, input.kind, input.id, input.by, input.emoji, this.store.now()).changes > 0,
    )
    if (added) this.emit({ _tag: 'reaction', target: { kind: input.kind, id: input.id }, by: input.by, emoji: input.emoji })
  }

  /** Publishes the blocks the model has closed since the last call: each bubble whole, each reaction once. */
  private publish = (run: Live) => {
    const output = parseOutput(this.text(run))
    for (const bubble of output.bubbles.slice(run.bubbles.length)) {
      const id = `${run.runId}:${run.bubbles.length}`
      const replyTo = bubble.replyTo === undefined ? undefined : ownerOpOf(this.store, bubble.replyTo)
      const body = resolveSpans(bubble.spans, sourceTable(this.store, run.runId))
      run.bubbles.push({ id, text: bubble.text, body, ...(replyTo ? { replyTo } : {}) })
      run.status = {}
      this.emit({ _tag: 'bubble', runId: run.runId, id, text: bubble.text, body, ...(replyTo ? { replyTo } : {}) })
    }
    for (const reaction of output.reactions.slice(run.reactions)) {
      const target = ownerOpOf(this.store, reaction.to)
      if (target !== undefined) this.recordReaction({ opId: `${run.runId}:r${run.reactions}`, kind: 'owner', id: target, by: 'juno', emoji: reaction.emoji })
      run.reactions += 1
    }
  }

  private progress = (run: Live, update: StreamProgress) => {
    if (run !== this.current) return
    if (update.status !== undefined) { this.showStatus(run, update.status); return }
    run.streamed = true
    if (update.text === run.partial) return
    run.partial = update.text
    this.publish(run)
  }

  private showStatus = (run: Live, line: string) => {
    run.status = { text: line }
    this.emit({ _tag: 'status', runId: run.runId, text: line })
  }

  private taint = (run: Live) => {
    if (!run.clean) return
    run.clean = false
    transaction(this.store.db, () => {
      this.store.db.prepare('UPDATE runs SET clean = 0 WHERE id = ?').run(run.runId)
    })
  }

  private toolStarted = (call: ToolHookCall) => {
    const run = this.current
    if (run === undefined) return
    const tool = this.options.tools().find((t) => t.name === call.name)
    const count = (run.calls.get(call.name) ?? 0) + 1
    run.calls.set(call.name, count)
    if (tool?.taints) this.taint(run)
    // A script's own calls are in `script_calls`; the run log keeps the model's.
    if (call.parent === undefined && call.id !== undefined) this.steps.started({ runId: run.runId, callId: call.id, tool: call.name, args: call.arguments })
    this.showStatus(run, tool?.status(count, call.arguments) ?? 'Working')
  }

  private toolEnded = (call: ToolHookCall, result: ToolResult) => {
    const run = this.current
    if (run === undefined || call.parent !== undefined || call.id === undefined) return
    const text = (result.output ?? []).flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])).join('\n')
    const reads = this.options.tools().find((t) => t.name === call.name)?.taints === true
    const summary = takeSummary(call.id)
    this.steps.ended({ runId: run.runId, callId: call.id, text, isError: result.isError === true, reads, ...(summary === undefined ? {} : { summary }) })
  }

  /** Delivers held input into the live run at a boundary, oldest first. */
  private flush = async () => {
    const run = this.current
    if (run === undefined || !this.admitting()) return
    const work = (async () => {
      for (;;) {
        const op = nextAccepted(this.store)
        if (op === undefined || run.inputs.has(op.opId) || run !== this.current) return
        const untrusted = originOf(op.kind) === 'report' || originOf(op.kind) === 'wake' || readsTopic(op) || carriesFiles(op)
        if (!this.persistInput(op, () => {
          if (untrusted) this.store.db.prepare('UPDATE runs SET clean = 0 WHERE id = ?').run(run.runId)
          this.store.db.prepare('INSERT OR IGNORE INTO run_inputs (op_id, run_id, steer) VALUES (?, ?, 1)').run(op.opId, run.runId)
        })) continue
        // §6.4: a steered report or wake is untrusted content, and so is a message sent beside a topic or with files.
        if (untrusted) run.clean = false
        run.inputs.set(op.opId, await deliver(this.store, this.session.journal(), op, { steer: true, text: () => this.inputText(op, run) }))
        this.emit({ _tag: 'steered', runId: run.runId, opId: op.opId })
      }
    })()
    run.flushing = run.flushing.then(() => work)
    await work
  }

  /** pi hooks of the root conversation's generation and tool tasks. */
  hooks = {
    generation: {
      beforeRequest: async (
        request: { readonly messages: ReadonlyArray<WireMessage> },
        api: { readonly models: { readonly getModel: (provider: string, id: string) => ChatModel | undefined } },
      ) => {
        const run = this.current
        if (run === undefined) throw new Error('no live run')
        await this.session.catchUp()
        run.streamed = false
        run.cleanAtRequest = run.clean
        const ref = this.options.model()
        const model = api.models.getModel(ref.provider, ref.modelId)
        if (model === undefined) {
          run.failure ??= { _tag: 'interrupted' }
          throw new Error('the chat model is not available')
        }
        const built = this.builder.chat({ h: run.h, messages: request.messages, model, observe: (update) => this.progress(run, update) })
        if (built._tag === 'refused') {
          // pi then sends its raw context, which the guard refuses: no provider call.
          run.failure ??= built.ending
          throw new Error('the request was refused before dispatch')
        }
        return { messages: built.messages }
      },
      afterResponse: (message: { readonly stopReason: string; readonly errorMessage?: string }) => {
        const run = this.current
        if (run === undefined) return
        if (message.stopReason === 'error') {
          const ending = providerFailure(message.errorMessage).ending
          // A response that started and then lost its stream cut the reply short: the run was interrupted.
          const lost = run.streamed && ending._tag === 'failed' && ending.reason === 'offline'
          run.failure ??= lost ? { _tag: 'interrupted' } : ending
        }
        run.done = this.text(run)
        run.partial = ''
        this.publish(run)
      },
      afterTools: () => this.flush(),
      onYield: async () => {
        await this.flush()
        return undefined
      },
    },
    tool: {
      beforeTool: (call: ToolHookCall) => {
        this.toolStarted(call)
        return undefined
      },
      // Only records the result for Activity; returning nothing keeps it as it is.
      afterTool: (call: ToolHookCall, result: ToolResult) => {
        this.toolEnded(call, result)
        return undefined
      },
    },
  }

  // ---- Input

  message = (input: Extract<Input, { kind: Exclude<InboxKind, 'react'> }>): Accept => {
    const { replyTo, files, ...rest } = input
    const kept = files === undefined ? [] : admittedFiles(files)
    const extra = { ...(replyTo === undefined ? {} : { replyTo }), ...(kept.length === 0 ? {} : { files: ownerFilesOf(kept) }) }
    const result = accept(
      this.store,
      Object.keys(extra).length === 0 ? rest : { ...rest, data: { ...(rest.data as object | undefined), ...extra } },
      kept.length === 0 ? undefined : () => void storeFiles(this.store, rest.opId, kept),
    )
    this.signal()
    return result
  }

  private react = (input: Extract<Input, { kind: 'react' }>): Queued => {
    const reaction = { opId: input.opId, kind: input.target._tag, id: input.target.id, by: 'owner' as const, emoji: input.emoji }
    if (input.emoji === null || input.emoji === THUMBS_UP) {
      this.recordReaction(reaction)
      return { _tag: 'recorded' }
    }
    const result = accept(this.store, { opId: input.opId, kind: 'react', text: input.emoji, data: { target: input.target, emoji: input.emoji } })
    if (result._tag === 'accepted') this.recordReaction(reaction)
    this.signal()
    return result
  }

  // ---- The loop

  /** One step: the live run to its end, a rotation, or the next run. False when nothing waits. */
  private step = async (): Promise<boolean> => {
    if (this.current !== undefined) {
      await this.runToEnd(this.current)
      return true
    }
    if (this.rotateWaiters.length > 0 || this.options.rotationDue()) {
      const waiting = this.rotateWaiters.splice(0)
      try {
        await this.options.rotate()
      } catch (error) {
        // A rotation asked for stands until one succeeds.
        this.rotateWaiters.unshift(...waiting)
        throw error
      }
      for (const resolve of waiting) resolve()
      return true
    }
    const op = this.admitting() ? nextAccepted(this.store) : undefined
    if (op === undefined) return false
    await this.options.beforeRun?.()
    try {
      await this.begin(op)
    } catch (error) {
      // The input never reached pi: it reads Interrupted with Try again, instead of holding every later message.
      try {
        settle(this.store, op.opId, 'interrupted', 'interrupted')
      } catch (again) {
        this.options.onReport?.(again)
      }
      throw error
    }
    return true
  }

  /** A run the loop could not carry to its end: it ends as interrupted, with Try again, so the chat does not show it live for good. */
  private endBroken = () => {
    const run = this.current
    if (run === undefined) return
    const ending: Ending = { _tag: 'interrupted', ...(run.retryable ? { retry: run.opId as OpId } : {}) }
    try {
      this.finish(run, ending)
    } catch (error) {
      this.options.onReport?.(error)
      this.current = undefined
      this.emit({ _tag: 'ended', runId: run.runId, opId: run.opId, ending })
    }
  }

  /** Runs steps until closed. An error ends the step's run visibly and the loop goes on at the next signal, never spinning. */
  private loop = async () => {
    for (;;) {
      if (this.closing) return
      this.signalled = false
      let busy = false
      try {
        busy = await this.step()
      } catch (error) {
        if (this.closing) return
        this.options.onReport?.(error)
        this.endBroken()
      }
      if (busy) continue
      this.notifyIdle()
      if (!this.signalled) await new Promise<void>((resolve) => (this.wake = resolve))
      this.wake = undefined
    }
  }

  private done: Promise<void> = Promise.resolve()

  kick = this.signal

  /** Starts the loop. Call after `restore` and pi's resume. */
  start = () => {
    this.done = this.loop().catch((error: unknown) => {
      // After close, pi rejects pending waits; the ops stay submitted and resume next time.
      if (!this.closing) this.options.onReport?.(error)
    })
  }

  /**
   * Queues an input: it joins the live run at its next step, or starts a run. A thumbs up or a
   * removed reaction is only recorded. A reaction is never a click and never a pin.
   */
  accept = (input: Input): Queued => (input.kind === 'react' ? this.react(input) : this.message(input))

  /** "Try again" on an interrupted or failed owner send: a new op with the same text. */
  retry = (input: { readonly opId: string; readonly interruptedOpId: string }): Retry => {
    const earlier = find(this.store, input.interruptedOpId)
    if (earlier === undefined || !isMessage(earlier.kind) || (earlier.state !== 'interrupted' && earlier.state !== 'failed')) {
      return { _tag: 'refused', reason: 'notRetryable' }
    }
    const { files, mentions } = earlier.data === null ? {} : (JSON.parse(earlier.data) as { files?: unknown; mentions?: unknown })
    const result = accept(
      this.store,
      { opId: input.opId, kind: 'retry', text: earlier.text, data: { retryOf: earlier.opId, ...(files === undefined ? {} : { files }), ...(mentions === undefined ? {} : { mentions }) } },
      files === undefined ? undefined : () => copyFiles(this.store, earlier.opId, input.opId),
    )
    this.signal()
    return result
  }

  mode = (): Mode => mode(this.store)

  setMode = (next: Mode) => {
    setMode(this.store, next)
    this.signal()
  }

  state = (): RunState | undefined => {
    const run = this.current
    if (run === undefined) return undefined
    return { runId: run.runId, opId: run.opId, origin: run.origin, bubbles: run.bubbles, status: run.status }
  }

  /** The live run's cutoff, for the compactor's ceiling (G2). */
  cutoff = (): number | undefined => this.current?.h

  /** The run begun last, if any since this process started. */
  latestRun = (): string | undefined => this.current?.runId ?? this.latest

  /** The live run as a tool sees it. Call it inside the tool's `execute()`. */
  toolRun = async (): Promise<ToolRun | undefined> => {
    const run = this.current
    if (run === undefined) return undefined
    const journal = this.session.journal()
    const position = { incarnation: journal.incarnation, seq: await journal.lastCommitted() }
    await this.session.catchUp()
    return { runId: run.runId, opId: run.opId, h: run.h, origin: run.origin, cutoff: this.archiveLength(), clean: run.clean, cleanAtRequest: run.cleanAtRequest, position }
  }

  subscribe = (listener: (event: TurnEvent) => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  rotate = () =>
    new Promise<void>((resolve) => {
      this.rotateWaiters.push(resolve)
      this.signal()
    })

  idle = () =>
    new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve)
      this.notifyIdle()
      this.signal()
    })

  close = async () => {
    this.closing = true
    this.signal()
    return this.done
  }

  /** Resolves when the loop has stopped. */
  stopped = () => this.done
}
