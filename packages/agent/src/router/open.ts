import type { Pins } from '@juno/agent-memory'
import { ACTIONS_MIGRATIONS, type Actions, type ActionsOptions } from '../actions'
import { createBackup, type Backup, type BackupKeychain } from '../backup/backup'
import { adoptRestoredKeys, clearStagedRestore, installStaged } from '../backup/restore'
import { BACKUP_MIGRATIONS, LOCAL_TABLES } from '../backup/schema'
import { type Compactor, type CompactorState } from '../compactor/scheduler'
import type { InboxState } from '../inbox/inbox'
import { type Job, type JobDriver, type Jobs } from '../jobs/jobs'
import { JOBS_MIGRATIONS } from '../jobs/schema'
import { MEMORY_DOCS_MIGRATIONS } from '../memory-docs/schema'
import { enterRecovery, observeOwner } from '../ownership/ownership'
import { OWNERSHIP_MIGRATIONS } from '../ownership/schema'
import type { Ownership } from '../ownership/service'
import type { PinResult } from '../pins/pins'
import type { Learning } from '../memory-docs/learn'
import type { McpManagerApi } from '../mcp/manager'
import type { ProviderGuardApi } from '../providers'
import { REDACTION_MIGRATIONS, type Redaction, type RemovalBackup } from '../redaction'
import { type JunoTool, type ToolRun } from '../request/tool'
import { openCore, type UpdateNeeded } from '../runtime/core'
import { type Extension, type Journal, type JournalSettings } from '../runtime/journal'
import { SCRIPT_MIGRATIONS, type CodemodeRunner } from '../scripts'
import { SCHEDULE_MIGRATIONS, type Scheduler, type SchedulerOptions } from '../schedule'
import { driveScheduler } from '../schedule/driver'
import { SETTINGS_MIGRATIONS } from '../settings/schema'
import { SPEND_MIGRATIONS } from '../spend'
import type { JournalPosition, Mode } from '../store/ledger'
import type { MemoryView } from '../store/memory'
import type { MigrationSet } from '../store/schema'
import { type Store } from '../store/store'
import type { ViewHost } from '../view-tools/host'
import { VIEW_MIGRATIONS } from '../view-tools/schema'
import type { RunState, TurnEvent } from './events'
import type { HostReads } from './host-tools'
import { createTurnModels } from './models'
import { type Input, type Queued, type Retry } from './router'
import { TURNS_MIGRATIONS } from './schema'
import { createTurnServices } from './services'
import { createTurnSession } from './session'
import { closeTurns, turnApi } from './turns'
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
 * `openCore` owns the lock, database and recovery sequence. Its router hook
 * supplies the recovered journal file so steering can attach before resume.
 * The core's default serial loop uses the same open sequence.
 */

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
  /** The MCP manager once the store is open, for the learning pass's reads (`withMcp`). */
  readonly connections?: () => McpManagerApi | undefined
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
  /**
   * The `agent.codemode` flag: with it the model also gets pi's code mode tool,
   * whose scripts may only read (`scripts/`). Off without it.
   */
  readonly codemode?: CodemodeRunner
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
    readonly pinMessage: (input: { readonly id?: string; readonly messageId: number; readonly from?: number; readonly to?: number }) => PinResult
    readonly edit: (expected: { readonly id: string; readonly version: number }, text: string) => PinResult
    readonly undo: (expected: { readonly id: string; readonly version: number }) => PinResult
  }
  /** Cards, clicks and dispatch (WP15). */
  readonly actions: Actions
  /** The learning passes behind Juno's `learn` asks (SPEC 13.8). */
  readonly learning: Learning
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
  let install: Awaited<ReturnType<typeof installStaged>>
  let backup: Backup | undefined
  const relay = { notify: noop }
  return openCore({
    agentDir: options.agentDir,
    ...(options.now ? { now: options.now } : {}),
    migrations: [SPEND_MIGRATIONS, TURNS_MIGRATIONS, JOBS_MIGRATIONS, SETTINGS_MIGRATIONS, ACTIONS_MIGRATIONS, SCHEDULE_MIGRATIONS, VIEW_MIGRATIONS, SCRIPT_MIGRATIONS, REDACTION_MIGRATIONS, BACKUP_MIGRATIONS, OWNERSHIP_MIGRATIONS, MEMORY_DOCS_MIGRATIONS, ...(options.migrations ?? []).filter((set) => set.name !== SCHEDULE_MIGRATIONS.name)],
    router: {
      beforeOpen: async () => {
        // A restore staged before the restart replaces agent.sqlite now (§14.4).
        install = await installStaged(options.agentDir, options.backup?.keychain)
        if (install._tag === 'quarantined') options.onReport?.(new Error('a staged restore was older than a removal and was not installed'))
      },
      beforeRecovery: async (store) => {
        if (install._tag === 'installed') {
          enterRecovery(store, install.restore)
          if (options.backup !== undefined) await adoptRestoredKeys(install.restore, options.backup.keychain)
          clearStagedRestore(options.agentDir)
        }
        // Capture starts before recovery writes anything, so a continued generation misses no row.
        backup = openBackup(store, options, (name) => {
          observeOwner(store, name)
          relay.notify()
        }, () => relay.notify())
      },
      stop: () => backup?.stop(),
      start: ({ store, file, opened, release }) => {
        const guard = options.provider(store)
        const models = {
          chat: typeof options.model === 'function' ? options.model(store) : options.model,
          compaction: typeof options.compaction === 'function' ? options.compaction(store) : options.compaction,
        }
        return start(store, guard, models, file, opened, options, { backup, relay }, release)
      },
    },
  })
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
  let compactor: Compactor | undefined
  const session = createTurnSession(store, options, () => models.running(), () => compactor?.poke())
  const models = createTurnModels(store, guard, initial, options, session.journal, () => services.tools())
  const services = createTurnServices({ store, guard, initial, options, session, models, backup, poke: () => compactor?.poke() })
  const { router, jobs, actions, redaction, ownership, scheduler, tools, section, scripts } = services
  relay.notify = ownership.notify
  const extension = {
    name: 'juno',
    tools: tools().map((tool) => tool.registration),
    sections: [{ key: 'juno', render: section }, ...(scripts ? [scripts.section] : [])],
    hooks: [
      { task: 'pi.generation', handlers: router.hooks.generation },
      // A script's call that is not a read is refused before the router counts it.
      { task: 'pi.tool', handlers: scripts ? { beforeTool: (call: Parameters<typeof scripts.guard>[0]) => scripts.guard(call) ?? router.hooks.tool.beforeTool(call) } : router.hooks.tool },
    ],
  } as Extension
  const settings: JournalSettings = {
    models: guard.models, model: initial.chat, extensions: [extension],
    ...(options.onReport ? { onReport: options.onReport } : {}),
  }

  await session.start(file, settings)
  // pi keeps the model of its last configure: a run it resumes uses that one.
  await models.restore()
  compactor = models.compactor(router.cutoff)
  router.restore()
  session.journal().resume()
  jobs.resume()
  router.start()
  services.learning.recover()
  actions.start()
  redaction.start()
  compactor?.poke()
  void ownership.resume().catch(options.onReport ?? noop)
  const scheduleDriver = driveScheduler(scheduler, options.onReport ?? noop)
  void scheduleDriver.tick()

  const close = closeTurns({ scheduleDriver, services, compactor, session, backup, release })
  return turnApi({ store, guard, opened, options, services, session, models, compactor, backup, scheduleDriver, close })
}
