import { VIEW_MIGRATIONS } from '../view-tools/schema'
import { createViewSettings } from '../view-tools/views'
import type { ViewHost } from '../view-tools/host'
import { createScheduler, SCHEDULE_MIGRATIONS, scheduleCreateTool, ownScheduleTool, scheduleExecutors, type Scheduler, type SchedulerOptions } from '../schedule'
import { driveScheduler } from '../schedule/driver'
/**
 * Opens the turn engine on an agent directory: WP8's durable core with
 * WP11's router in place of its serial loop (plan v3 §3, §8).
 *
 * The order is the startup order the providers need (backlog, WP9):
 *
 *   1. the owner lock, `agent.sqlite` and its migrations, recovery
 *      (classifying open actions before anything resumes);
 *   2. the guarded provider, built on the opened store by `provider`;
 *   3. pi on the journal, with only the guard's models and Juno's
 *      extension (the request builder, the tools, the hooks);
 *   4. the router rebuilds the live run, and only then does pi resume, so
 *      a request pi resumes is built and stamped like any other;
 *   5. jobs resume, the loop starts, and the compactor runs.
 *
 * So no deferred model facade is needed: pi never sees models before the
 * guard exists. Shutdown follows G9: jobs and the compactor stop, the loop
 * stops, pi closes, the projection finishes, `agent.sqlite` closes, and the
 * owner lock is released last.
 *
 * The open sequence mirrors `runtime/core.ts`'s `openCore`, which keeps the
 * serial loop for its crash tests. Steering needs the journal, which the
 * core does not expose, so the router owns this copy until the core takes a
 * router (see the README).
 */
import { join } from 'node:path'
import { createCompactionProvider, type ProviderGuardApi } from '../providers'
import { projector } from '../projection/projector'
import { commitRotation, currentIncarnation, deleteRetiredJournals } from '../recovery/incarnations'
import { recover } from '../recovery/recover'
import { AGENT_DATABASE_FILE, ROTATION_AGE_MS, type UpdateNeeded } from '../runtime/core'
import { crashPoint } from '../runtime/crash'
import { openJournalFile, type Extension, type Journal, type JournalSettings } from '../runtime/journal'
import { acquireOwnerLock } from '../runtime/lock'
import { SETTINGS_MIGRATIONS } from '../settings/schema'
import { SPEND_MIGRATIONS } from '../spend'
import { openDatabase, StoreTooNew, type Database } from '../store/database'
import type { MigrationSet } from '../store/schema'
import { initialize, type Store } from '../store/store'
import { createCompactor, type Compactor, type CompactorState } from '../compactor/scheduler'
import { delegateTool } from '../jobs/delegate'
import { createJobs, type Job, type Jobs, type JobDriver } from '../jobs/jobs'
import { JOBS_MIGRATIONS } from '../jobs/schema'
import { subagentDriver } from '../jobs/subagent'
import { rememberTool } from '../memory-tools/remember'
import { activePins, editPin, pinMessage, undoPin, type PinResult } from '../pins/pins'
import { createRequestBuilder } from '../request/builder'
import { instructions, JUNO_INSTRUCTIONS } from '../request/prompt'
import { declaration, type JunoTool, type ToolRun } from '../request/tool'
import { uuidv7 } from '../store/store'
import type { Pins } from '@juno/agent-memory'
import type { RunState, TurnEvent } from './events'
import { hostTools, type HostReads } from './host-tools'
import { createRouter, type Input, type Queued, type Retry } from './router'
import { TURNS_MIGRATIONS } from './schema'
import { assignHandles, type SourceRef } from './sources'
import { find, type InboxState } from '../inbox/inbox'
import { view, type CompactionModel, type MemoryView } from '../store/memory'
import type { JournalPosition, Mode } from '../store/ledger'
import { ACTIONS_MIGRATIONS, budgetCard, createActions, proposedTask, sendMessageTool, type Actions, type ActionsOptions } from '../actions'
import { mintGrant } from '../grants/grants'
import { createBackup, type Backup, type BackupKeychain } from '../backup/backup'
import { adoptRestoredKeys, clearStagedRestore, installStaged } from '../backup/restore'
import { BACKUP_MIGRATIONS, LOCAL_TABLES } from '../backup/schema'
import { enterRecovery, observeOwner } from '../ownership/ownership'
import { OWNERSHIP_MIGRATIONS } from '../ownership/schema'
import { createOwnership, type Ownership } from '../ownership/service'
import { ownerRules, rulesSection } from '../actions/rules'
import { createRedaction, REDACTION_MIGRATIONS, removeExecutor, removeTool, type Redaction, type RemovalBackup } from '../redaction'

/** One archive message (§4.1). `opId` is the inbox op whose run wrote it. */
export interface ArchiveMessage {
  readonly id: number
  readonly kind: 'user' | 'juno' | 'tool' | 'echo' | 'work' | 'wake' | 'card' | 'note'
  readonly text: string
  readonly at: number
  readonly opId: string | null
}

export interface ModelRef {
  readonly provider: string
  readonly modelId: string
}

export interface TurnsOptions {
  readonly agentDir: string
  /**
   * Builds the guarded provider on the opened store (`createOpenRouter`, or
   * `createProviderGuard` in tests). Called after recovery and before pi
   * starts. Only its models reach pi.
   */
  readonly provider: (store: Store) => ProviderGuardApi
  /** The chat model, or how to read it from the opened store (the owner's saved choice). `setModels` changes it. */
  readonly model: ModelRef | ((store: Store) => ModelRef)
  /** The compaction model. No compaction runs without one at open. */
  readonly compaction?: ModelRef | ((store: Store) => ModelRef | undefined)
  /** The subagents' cheaper model. Default: the compaction model; no `delegate` tool without either. */
  readonly subagent?: ModelRef
  /** Slack reads through the AgentHost port. No Slack tools without it. */
  readonly views?: ViewHost
  readonly host?: HostReads
  /** The host's actions and other folders' executors (WP15). No Slack send without `actions.host`. */
  readonly actions?: ActionsOptions
  /** Fixed tools supplied by a connection adapter; called before the journal resumes. */
  readonly tools?: (context: { readonly store: Store; readonly actions: Actions; readonly jobs: Jobs; readonly current: () => Promise<ToolRun | undefined> }) => ReadonlyArray<JunoTool & { readonly taints?: boolean }>
  /**
   * Stops a job whose work runs outside Juno (a T3 Code session). `click` is the Task
   * card's Stop. Without one (a removal) it only proposes a Stop card the owner clicks.
   * Resolves true once the work is confirmed stopped.
   */
  readonly stopExternalJob?: (job: Job, click: string | undefined) => Promise<boolean>
  readonly jobDrivers?: () => ReadonlyArray<JobDriver>
  /** Other folders' migration sets. Spend, turns and jobs are always applied. */
  readonly migrations?: ReadonlyArray<MigrationSet>
  /** Host socket availability. Stored input waits until it is online. */
  readonly online?: () => boolean
  readonly schedule?: Pick<SchedulerOptions, 'replies' | 'cachedReplies' | 'account' | 'enabled'>
  /** The encrypted backup, move and restore (WP21). Without it Juno keeps no backup and cannot move. */
  readonly backup?: {
    /** Main's keychain over the agent's port. */
    readonly keychain: BackupKeychain
    /** This Mac's name, for the other Mac's "Juno is working on your other Mac". */
    readonly deviceName: string
    /** Export interval; 0 exports only when asked. Default one minute. */
    readonly intervalMs?: number
    /** Restarts the agent process; the next open installs a staged restore. */
    readonly restart?: () => void
  }
  /**
   * Removal's backup hooks in place of the backup's own (`Backup.removal`), for tests. With neither, a
   * removal raises no deletion record and regenerates no backup.
   */
  readonly removalBackup?: RemovalBackup
  readonly now?: () => number
  readonly onReport?: (error: unknown) => void
}

export interface Turns {
  readonly _tag: 'running'
  readonly scheduler: Scheduler
  readonly checkSchedules: () => Promise<void>
  readonly store: Store
  readonly guard: ProviderGuardApi
  /** How the journal was found at open. */
  readonly opened: 'resumed' | 'rotated'
  readonly incarnation: () => string
  /** The journal's last commit now. A tool reads it inside its `execute()` and passes it to `authorize` (WP15). */
  readonly position: () => Promise<JournalPosition>
  /** A message (maybe a reply), a reaction, a report, a wake or a click. Durable before it returns; the same op again is a no-op. */
  readonly accept: (input: Input) => Queued
  /** Wake queued input after the host socket changes. */
  readonly networkChanged: () => void
  /** "Try again" on an interrupted or failed send. */
  readonly retry: (input: { readonly opId: string; readonly interruptedOpId: string }) => Retry
  readonly mode: () => Mode
  readonly setMode: (next: Mode) => void
  /** The models runs use now. */
  readonly models: () => { readonly chat: ModelRef; readonly compaction: ModelRef | undefined }
  /**
   * A model change from Settings. The chat model applies from the next run
   * (a run keeps its model); the compaction model from the next compaction
   * job. A model the guard does not serve is ignored.
   */
  readonly setModels: (next: { readonly chat?: ModelRef; readonly compaction?: ModelRef }) => void
  /** The live run, or undefined. */
  readonly run: () => RunState | undefined
  /** An inbox op's state: the owner bubble's delivery line and a run's settled inputs. */
  readonly op: (opId: string) => { readonly state: InboxState; readonly reason: string | null } | undefined
  /** Archive messages from id `from`, oldest first, at most `limit`. */
  readonly messages: (from?: number, limit?: number) => ReadonlyArray<ArchiveMessage>
  /** The published memory view (§4.2). */
  readonly memory: () => MemoryView
  readonly subscribe: (listener: (event: TurnEvent) => void) => () => void
  /** Resolves when no run is live and no input waits (while on). */
  readonly idle: () => Promise<void>
  readonly rotate: () => Promise<void>
  readonly pins: {
    readonly active: () => Pins
    /** "Remember this" on an owner message. */
    readonly pinMessage: (input: { readonly messageId: number; readonly from?: number; readonly to?: number }) => PinResult
    readonly edit: (expected: { readonly id: string; readonly version: number }, text: string) => PinResult
    readonly undo: (expected: { readonly id: string; readonly version: number }) => PinResult
  }
  /** Cards, clicks and dispatch (WP15). */
  readonly actions: Actions
  /** The owner's Remove and the purge after it (WP16). */
  readonly redaction: Redaction
  /** Who owns Juno, move, restore and Activate (WP21). */
  readonly ownership: Ownership
  /** The encrypted backup, when `backup` was given. Its `removal` hooks are WP16's `RemovalBackup`. */
  readonly backup?: Backup
  readonly jobs: {
    readonly list: () => ReadonlyArray<Job>
    readonly active: () => ReadonlyArray<Job>
    /** The Task card's Stop. */
    readonly stop: (jobId: string, opId?: string) => Promise<void>
    readonly idle: () => Promise<void>
  }
  readonly compaction: {
    readonly state: () => CompactorState
    /** Resolves when no compaction job runs and none is ready. */
    readonly idle: () => Promise<void>
  }
  readonly close: () => Promise<void>
}

export async function openTurns(options: TurnsOptions): Promise<Turns | UpdateNeeded> {
  const now = options.now ?? Date.now
  const lock = acquireOwnerLock(options.agentDir)
  let db: Database | undefined
  let backup: Backup | undefined
  try {
    // A restore staged before the restart replaces agent.sqlite now (§14.4).
    const install = await installStaged(options.agentDir, options.backup?.keychain)
    if (install._tag === 'quarantined') options.onReport?.(new Error('a staged restore was older than a removal and was not installed'))
    try {
      db = openDatabase(
        join(options.agentDir, AGENT_DATABASE_FILE),
        [SPEND_MIGRATIONS, TURNS_MIGRATIONS, JOBS_MIGRATIONS, SETTINGS_MIGRATIONS, ACTIONS_MIGRATIONS, SCHEDULE_MIGRATIONS, VIEW_MIGRATIONS, REDACTION_MIGRATIONS, BACKUP_MIGRATIONS, OWNERSHIP_MIGRATIONS, ...(options.migrations ?? []).filter((set) => set.name !== SCHEDULE_MIGRATIONS.name)],
        now,
      )
    } catch (error) {
      if (error instanceof StoreTooNew) return updateNeeded(lock.release)
      throw error
    }
    const store: Store = { db, now }
    initialize(store)
    if (install._tag === 'installed') {
      enterRecovery(store, install.restore)
      if (options.backup !== undefined) await adoptRestoredKeys(install.restore, options.backup.keychain)
      clearStagedRestore(options.agentDir)
    }
    // Capture starts before recovery writes anything, so a continued generation misses no row.
    const relay = { notify: noop }
    backup = openBackup(store, options, (name) => {
      observeOwner(store, name)
      relay.notify()
    }, () => relay.notify())
    const recovery = await recover(store, options.agentDir)
    if (recovery._tag === 'updateNeeded') {
      backup?.stop()
      db.close()
      return updateNeeded(lock.release)
    }
    const guard = options.provider(store)
    const models = {
      chat: typeof options.model === 'function' ? options.model(store) : options.model,
      compaction: typeof options.compaction === 'function' ? options.compaction(store) : options.compaction,
    }
    return await start(store, guard, models, recovery.file, recovery._tag === 'resume' ? 'resumed' : 'rotated', options, { backup, relay }, () => {
      store.db.close()
      lock.release()
    })
  } catch (error) {
    backup?.stop()
    if (db?.isOpen) db.close()
    lock.release()
    throw error
  }
}

const noop = () => {}

/** The backup, or undefined without a keychain. A backup that cannot start is reported, and Juno runs without it. */
function openBackup(store: Store, options: TurnsOptions, observed: (deviceName: string) => void, changed: () => void): Backup | undefined {
  if (options.backup === undefined) return undefined
  try {
    return createBackup({
      store,
      agentDir: options.agentDir,
      keychain: options.backup.keychain,
      deviceName: options.backup.deviceName,
      local: LOCAL_TABLES,
      observed: (owner) => observed(owner.name),
      changed,
      ...(options.backup.intervalMs !== undefined ? { intervalMs: options.backup.intervalMs } : {}),
      ...(options.onReport ? { onReport: options.onReport } : {}),
    })
  } catch (error) {
    options.onReport?.(error)
    return undefined
  }
}

/** The Because line of a card Juno proposes after reading untrusted content (SPEC 13.3). */
const UNTRUSTED_BECAUSE = 'Juno read Slack or a report in this reply'

function updateNeeded(release: () => void): UpdateNeeded {
  return { _tag: 'updateNeeded', close: async () => release() }
}

const sameRef = (a: ModelRef | undefined, b: ModelRef | undefined) => a?.provider === b?.provider && a?.modelId === b?.modelId

async function start(
  store: Store,
  guard: ProviderGuardApi,
  initial: { readonly chat: ModelRef; readonly compaction: ModelRef | undefined },
  file: { readonly start: (settings: JournalSettings) => Promise<Journal> },
  opened: 'resumed' | 'rotated',
  options: TurnsOptions,
  early: { readonly backup: Backup | undefined; readonly relay: { notify: () => void } },
  release: () => void,
): Promise<Turns> {
  const { backup, relay } = early
  let journal: Journal | undefined
  let projection: ReturnType<typeof projector> | undefined
  let unsubscribe: () => void = noop
  let compactor: Compactor | undefined
  const session = {
    journal: () => journal!,
    catchUp: () => projection!.catchUp(),
  }

  const tools = () => [...memoryTools, ...jobTools, ...slackTools, ...actionTools, ...scheduleTools, ...(viewSettings ? [viewSettings.tool] : []), ...redactionTools, ...extraTools, ...(guard.harnessTool ? [guard.harnessTool] : [])]
  const section = () => {
    const base = instructions(jobs.active().map((job) => ({ title: job.title, line: job.state ?? job.phase })))
    const rules = rulesSection(ownerRules(store))
    return rules === '' ? base : `${base}\n\n${rules}`
  }
  const builder = createRequestBuilder({ store, guard, systemAndTools: () => [`<juno>\n${section()}\n</juno>`, ...tools().map((t) => declaration(t.registration))] })
  // The chat model pi runs with (`running`) and the one Settings chose (`wanted`). They meet between runs.
  let wanted = initial.chat
  let running = initial.chat
  const applyModel = async () => {
    if (sameRef(running, wanted)) return
    const next = wanted
    await journal!.setModel(next)
    running = next
  }
  const router = createRouter({
    store, session, builder, model: () => running, tools,
    rotate: () => rotateNow(),
    beforeRun: applyModel,
    startWake: (opId, persist) => scheduler.start(opId, persist),
    rotationDue: () => {
      const row = store.db.prepare('SELECT created_at AS at FROM incarnations WHERE id = ?').get(journal!.incarnation) as { at: number }
      return store.now() - row.at >= ROTATION_AGE_MS
    },
    onRunEnded: () => compactor?.poke(),
    cards: { carry: (opId) => actions.carry(opId), quote: (cardId) => actions.quote(cardId) },
    admits: () => ownership.admits() && (options.online?.() ?? true),
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  const subagentModel = options.subagent ?? initial.compaction
  const jobs = createJobs({
    store,
    drivers: [...(subagentModel ? [subagentDriver({ store, guard, builder, model: subagentModel })] : []), ...(options.jobDrivers?.() ?? [])],
    accept: (input) => router.message(input),
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  const memoryTools = [
    rememberTool({
      store,
      current: () => router.toolRun(),
      remembered: (runId, pin) => router.emit({ _tag: 'remembered', runId, pinId: pin.id, version: pin.version, text: pin.text }),
    }),
  ]
  const position = async (): Promise<JournalPosition> => ({ incarnation: journal!.incarnation, seq: await journal!.lastCommitted() })
  const scheduler = createScheduler({
    store,
    ...options.schedule,
    onError: options.onReport ?? noop,
    replies: options.schedule?.replies ?? (async () => { throw new Error('Reply refresh is unavailable.') }),
    ...(options.schedule?.cachedReplies ? { cachedReplies: options.schedule.cachedReplies } : {}),
    changed: () => { router.kick(); actions.changed() },
  })
  const viewSettings = options.views ? createViewSettings({ store, host: options.views, current: () => router.toolRun(), actions: () => actions }) : undefined
  const actions: Actions = createActions({
    ...options.actions,
    ...(viewSettings ? { decorateCard: viewSettings.decorate, undoCard: viewSettings.undo } : {}),
    executors: () => [...(viewSettings ? [viewSettings.executor] : []), ...(typeof options.actions?.executors === 'function' ? options.actions.executors() : options.actions?.executors ?? []), ...scheduleExecutors({ store, scheduler, propose: (proposal) => actions.propose(proposal) }), removeExecutor(redaction, store)],
    onProposed: scheduler.bindNudge,
    store, position, jobs, spend: guard.spend, place: subagentModel?.modelId ?? '',
    accept: (input) => router.message(input),
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  const removalBackup = options.removalBackup ?? backup?.removal
  const redaction = createRedaction({
    store,
    ...(removalBackup ? { backup: removalBackup } : {}),
    rotate: () => router.rotate(),
    stopJob: async (jobId) => {
      actions.jobStopped(jobId)
      const job = jobs.get(jobId)
      if (job?.kind !== 't3') return jobs.stop(jobId)
      // A T3 Code session runs outside Juno. Juno stops watching it, so no report reaches the
      // model, without claiming it stopped; the interrupt waits on a Stop card the owner clicks.
      await jobs.release(jobId, 'Juno stopped watching after a removal. The session may still be running in T3 Code.')
      await options.stopExternalJob?.(job, undefined)
    },
    changed: () => {
      actions.changed()
      compactor?.poke()
    },
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  const redactionTools = [removeTool({ store, current: () => router.toolRun(), propose: actions.propose })]
  const scheduleContext = { store, scheduler, current: () => router.toolRun(), propose: actions.propose }
  const scheduleTools = [scheduleCreateTool(scheduleContext), ownScheduleTool(scheduleContext)]
  const jobTools = subagentModel
    ? [
        delegateTool({
          jobs, current: () => router.toolRun(), place: subagentModel.modelId,
          actions: {
            propose: (run, callId, task) =>
              actions.propose({ runId: run.runId, callId, payload: proposedTask(store, { ...task, place: subagentModel.modelId, because: UNTRUSTED_BECAUSE }) }),
            granted: (job, run) => {
              mintGrant(store, { opClass: 'job', target: job.id, authority: { _tag: 'cleanRun', run, sourceInRun: true }, sourceOp: run.opId })
            },
          },
        }),
      ]
    : []
  const handles = async (refs: ReadonlyArray<SourceRef>) => {
    const runId = router.state()?.runId
    return runId === undefined ? [] : assignHandles(store, runId, refs)
  }
  const slackTools = options.host ? hostTools(options.host, handles) : []
  const actionHost = options.actions?.host
  const extraTools = options.tools?.({ store, actions, jobs, current: () => router.toolRun() }) ?? []
  const actionTools = actionHost ? [sendMessageTool({ store, current: () => router.toolRun(), propose: actions.propose, host: actionHost })] : []
  // §5.4: a run the daily cap blocked brings the Budget card, one per day and raise.
  router.subscribe((event) => {
    if (event._tag !== 'ended' || event.ending._tag !== 'blocked' || event.ending.reason !== 'budget') return
    const today = guard.spend.snapshot()
    actions.propose({ runId: event.runId, callId: `budget:${today.day}:${today.raises}`, payload: budgetCard(store, guard.spend) })
  })

  const extension = {
    name: 'juno',
    tools: tools().map((tool) => tool.registration),
    sections: [{ key: 'juno', render: section }],
    hooks: [
      { task: 'pi.generation', handlers: router.hooks.generation },
      { task: 'pi.tool', handlers: router.hooks.tool },
    ],
  } as Extension
  const settings: JournalSettings = {
    models: guard.models, model: initial.chat, extensions: [extension],
    ...(options.onReport ? { onReport: options.onReport } : {}),
  }

  const attach = (next: Journal) => {
    journal = next
    projection = projector(store, next)
    unsubscribe = next.onCommit(() => {
      void projection!.catchUp().then(() => compactor?.poke(), options.onReport)
    })
  }

  // A rotation in flight; close waits for it before closing the journal.
  let rotating: Promise<void> | undefined
  const rotateNow = () => (rotating = rotateJournal().finally(() => (rotating = undefined)))
  const rotateJournal = async () => {
    // Called by the loop between runs: no run is live. Drain the projection.
    await projection!.catchUp()
    crashPoint('rotation.drained')
    const old = journal!
    const incarnation = commitRotation(store, 'rotation')
    unsubscribe()
    await old.close()
    deleteRetiredJournals(options.agentDir, incarnation)
    const next = await openJournalFile(options.agentDir, incarnation)
    if (next._tag !== 'opened') throw new Error(`a new journal could not be opened (${next._tag})`)
    attach(await next.file.start({ ...settings, model: running }))
    journal!.resume()
  }

  const ownership = createOwnership({
    store,
    agentDir: options.agentDir,
    ...(backup !== undefined ? { backup: { backup, keychain: options.backup!.keychain } } : {}),
    drain: async () => {
      await router.idle()
      await actions.idle()
      await projection!.catchUp()
    },
    // §14 and WP15: this Mac owns Juno now, so waiting clicks and inputs run.
    kick: () => {
      actions.kick()
      router.kick()
    },
    cards: () => actions.views(),
    ...(options.backup?.restart ? { restart: options.backup.restart } : {}),
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  // The chat's banner and cards and Settings › Juno read ownership; they rebuild on a card change.
  const ownershipChanged = () => actions.changed()
  ownership.subscribe(ownershipChanged)
  relay.notify = ownership.notify

  attach(await file.start(settings))
  // pi keeps the model of its last configure: a run it resumes uses that one.
  running = (await journal!.model()) ?? running

  // The compaction model: one provider per model, built when first used.
  let compaction = initial.compaction
  const compactionProviders = new Map<string, CompactionModel>()
  const compactionModel = (ref: ModelRef): CompactionModel | undefined => {
    const key = `${ref.provider}/${ref.modelId}`
    const known = compactionProviders.get(key)
    if (known !== undefined) return known
    const model = guard.models.getModel(ref.provider, ref.modelId)
    if (model === undefined) return undefined
    const built = createCompactionProvider({
      store, guard, model, system: JUNO_INSTRUCTIONS, sessionId: 'juno-compaction',
      // Declared, never called: the same tool block as a turn, as plain data (the guard copies the context).
      tools: tools().map(({ registration: { name, description, parameters } }) => ({ name, description, parameters })),
    })
    compactionProviders.set(key, built)
    return built
  }
  const firstCompaction = compaction === undefined ? undefined : compactionModel(compaction)
  if (firstCompaction !== undefined) {
    const current = () => (compaction === undefined ? undefined : compactionModel(compaction)) ?? firstCompaction
    compactor = createCompactor({
      store, spend: guard.spend, cutoff: () => router.cutoff(),
      model: { get id() { return current().id }, summarize: (task) => current().summarize(task) },
      ...(options.onReport ? { onReport: options.onReport } : {}),
    })
  }
  router.restore()
  journal!.resume()
  jobs.resume()
  router.start()
  actions.start()
  redaction.start()
  compactor?.poke()
  void ownership.resume().catch(options.onReport ?? noop)
  const scheduleDriver = driveScheduler(scheduler, options.onReport ?? noop)
  void scheduleDriver.tick()

  let closed: Promise<void> | undefined
  return {
    _tag: 'running',
    scheduler,
    checkSchedules: scheduleDriver.tick,
    store,
    guard,
    opened,
    incarnation: () => currentIncarnation(store)!,
    position,
    accept: router.accept,
    retry: router.retry,
    mode: router.mode,
    setMode: (next) => {
      actions.beforeMode(next)
      router.setMode(next)
      actions.afterMode(next)
      compactor?.poke()
    },
    models: () => ({ chat: wanted, compaction }),
    setModels: (next) => {
      if (next.chat !== undefined && guard.models.getModel(next.chat.provider, next.chat.modelId) !== undefined) wanted = next.chat
      if (next.compaction !== undefined) {
        try {
          if (compactionModel(next.compaction) !== undefined) compaction = next.compaction
        } catch (error) {
          // A window below the compaction minimum: keep the model in use.
          options.onReport?.(error)
        }
      }
    },
    run: router.state,
    op: (opId) => {
      const op = find(store, opId)
      return op === undefined ? undefined : { state: op.state, reason: op.reason }
    },
    messages: (from = 0, limit = 200) =>
      store.db
        .prepare('SELECT id, kind, text, at, origin_op AS opId FROM messages WHERE id >= ? ORDER BY id LIMIT ?')
        .all(from, limit) as unknown as ReadonlyArray<ArchiveMessage>,
    memory: () => view(store),
    subscribe: router.subscribe,
    networkChanged: router.kick,
    idle: router.idle,
    rotate: router.rotate,
    pins: {
      active: () => activePins(store),
      pinMessage: (input) => pinMessage(store, { id: uuidv7(store.now()), ...input }),
      edit: (expected, text) => editPin(store, expected, text),
      undo: (expected) => undoPin(store, expected),
    },
    actions,
    redaction,
    ownership,
    ...(backup !== undefined ? { backup } : {}),
    jobs: {
      list: jobs.list,
      active: jobs.active,
      stop: async (jobId, opId) => {
        const job = jobs.get(jobId)
        if (job?.kind === 't3' && !await options.stopExternalJob?.(job, opId ?? uuidv7(store.now()))) return
        actions.jobStopped(jobId)
        return jobs.stop(jobId)
      },
      idle: jobs.idle,
    },
    compaction: {
      state: () => compactor?.state() ?? 'idle',
      idle: () => compactor?.idle() ?? Promise.resolve(),
    },
    close: () =>
      (closed ??= (async () => {
        await scheduleDriver.close()
        await redaction.close()
        await actions.close()
        await jobs.close()
        await compactor?.close()
        const stopped = router.close()
        await rotating
        unsubscribe()
        await projection!.catchUp()
        await journal!.close()
        await stopped
        // The backup is the last writer: its final export sees every change.
        await backup?.close()
        release()
      })()),
  }
}
