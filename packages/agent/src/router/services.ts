import { budgetCard, createActions, proposedTask, resolveTool, sendMessageTool, type Actions } from '../actions'
import { ownerRules, rulesSection } from '../actions/rules'
import type { Backup } from '../backup/backup'
import { mintGrant } from '../grants/grants'
import { delegateTool } from '../jobs/delegate'
import { createJobs, type Jobs } from '../jobs/jobs'
import { subagentDriver } from '../jobs/subagent'
import { rememberTool } from '../memory-tools/remember'
import { createOwnership } from '../ownership/service'
import type { ProviderGuardApi } from '../providers'
import { createRedaction, removeExecutor, removeTool } from '../redaction'
import { createRequestBuilder } from '../request/builder'
import { instructions } from '../request/prompt'
import { declaration } from '../request/tool'
import { createScheduler, ownScheduleTool, scheduleCreateTool, scheduleExecutors } from '../schedule'
import type { JournalPosition } from '../store/ledger'
import type { Store } from '../store/store'
import { createViewSettings } from '../view-tools/views'
import { openScripts } from '../scripts'
import { hostTools } from './host-tools'
import type { ModelRef, TurnsOptions } from './open'
import type { Session } from './router'
import { createRouter } from './router'
import { assignHandles, type SourceRef } from './sources'

interface Setup {
  readonly store: Store
  readonly guard: ProviderGuardApi
  readonly initial: { readonly chat: ModelRef; readonly compaction: ModelRef | undefined }
  readonly options: TurnsOptions
  readonly session: Session & { readonly position: () => Promise<JournalPosition>; readonly rotate: () => Promise<void>; readonly rotationDue: () => boolean }
  readonly models: { readonly running: () => ModelRef; readonly apply: () => Promise<void> }
  readonly backup: Backup | undefined
  readonly poke: () => void
}

export function createTurnServices(setup: Setup) {
  const { store, guard, initial, options, session, models, backup, poke } = setup
  const tools = () => registeredTools()
  const scripting = options.codemode ? openScripts(store, options.codemode, () => router.state()?.runId) : undefined
  const section = () => {
    const base = instructions(jobs.active().map((job) => ({ title: job.title, line: job.state ?? job.phase })))
    const rules = rulesSection(ownerRules(store))
    return rules === '' ? base : `${base}\n\n${rules}`
  }
  // What the model is sent: Juno's section, the codemode section, and the tools offered to the model.
  // A tool only scripts call is in the codemode section instead.
  const systemAndTools = () => {
    const registered = tools().map((t) => t.registration)
    return [
      `<juno>\n${section()}\n</juno>`,
      ...(scripting ? [scripting.scripts.sectionText(registered)] : []),
      ...registered.filter((r) => r.callers?.includes('model') ?? true).map(declaration),
    ]
  }
  const builder = createRequestBuilder({ store, guard, systemAndTools })
  const router = createRouter({
    store, session, builder, model: models.running, tools,
    rotate: session.rotate,
    beforeRun: models.apply,
    startWake: (opId, persist) => scheduler.start(opId, persist),
    rotationDue: session.rotationDue,
    onRunEnded: poke,
    cards: { carry: (opId) => actions.carry(opId), carriesData: (opId) => actions.carriesData(opId), quote: (cardId) => actions.quote(cardId) },
    admits: () => ownership.admits() && (options.online?.() ?? true),
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  const subagentModel = options.subagent ?? initial.compaction
  const jobs = createJobs({
    store,
    drivers: [...(subagentModel ? [subagentDriver({ store, guard, builder, model: subagentModel })] : []), ...(options.jobDrivers?.() ?? [])],
    accept: (input) => router.message(input),
    onChange: () => actions.changed(),
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  const { scheduler, viewSettings, actions, redaction } = createActionServices({ ...setup, router, jobs, subagentModel })
  const ownTools = createTools({ ...setup, router, jobs, scheduler, viewSettings, actions, subagentModel })
  const registeredTools = scripting ? () => [...ownTools(), scripting.tool] : ownTools
  // §5.4: a run the daily cap blocked brings the Budget card, one per day and raise.
  router.subscribe((event) => {
    if (event._tag !== 'ended' || event.ending._tag !== 'blocked' || event.ending.reason !== 'budget') return
    const today = guard.spend.snapshot()
    actions.propose({ runId: event.runId, callId: `budget:${today.day}:${today.raises}`, payload: budgetCard(store, guard.spend) })
  })
  const ownership = openOwnership(store, options, backup, router, actions, session)
  return { router, jobs, scheduler, actions, redaction, ownership, tools, section, scripts: scripting?.scripts }
}

type Router = ReturnType<typeof createRouter>
interface ActionSetup extends Pick<Setup, 'store' | 'guard' | 'options' | 'session' | 'backup' | 'poke'> {
  readonly router: Router
  readonly jobs: Jobs
  readonly subagentModel: ModelRef | undefined
}

function createActionServices({ store, options, session, backup, poke, router, jobs, guard, subagentModel }: ActionSetup) {
  const position = session.position
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
      poke()
    },
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  return { scheduler, viewSettings, actions, redaction }
}

function createTools({ store, options, guard, router, jobs, scheduler, viewSettings, actions, subagentModel }: Pick<ActionSetup, 'store' | 'options' | 'guard' | 'router' | 'jobs' | 'subagentModel'> & Pick<ReturnType<typeof createActionServices>, 'scheduler' | 'viewSettings' | 'actions'>) {
  const memoryTools = [
    rememberTool({
      store,
      current: () => router.toolRun(),
      remembered: (runId, pin) => router.emit({ _tag: 'remembered', runId, pinId: pin.id, version: pin.version, text: pin.text }),
    }),
  ]
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
  const actionTools = actionHost ? [resolveTool({ store, current: () => router.toolRun(), propose: actions.propose, host: actionHost }), sendMessageTool({ store, current: () => router.toolRun(), propose: actions.propose, host: actionHost })] : []
  return () => [...memoryTools, ...jobTools, ...slackTools, ...actionTools, ...scheduleTools, ...(viewSettings ? [viewSettings.tool] : []), ...redactionTools, ...extraTools, ...(guard.harnessTool ? [guard.harnessTool] : [])]
}

function openOwnership(store: Store, options: TurnsOptions, backup: Backup | undefined, router: Router, actions: Actions, session: Session) {
  const ownership = createOwnership({
    store,
    agentDir: options.agentDir,
    ...(backup !== undefined ? { backup: { backup, keychain: options.backup!.keychain } } : {}),
    drain: async () => {
      await router.idle()
      await actions.idle()
      await session.catchUp()
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

  return ownership
}

/** The Because line after reading untrusted content (SPEC 13.3). */
const UNTRUSTED_BECAUSE = 'Juno read Slack or a report in this reply'
const noop = () => {}
