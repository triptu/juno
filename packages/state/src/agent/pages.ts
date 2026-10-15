/**
 * The pages behind the Juno menu and Settings › Juno (SPEC 13.10), live from
 * the agent (`packages/agent/src/serve/pages.ts`, `src/settings/`), and what
 * their buttons call. Review lists the cards pending after a restore; their
 * bindings join the chat's, so Approve works there too.
 *
 * Backup and This Mac (WP21) answer with the agent's own line when they
 * fail ("Juno can't write to that folder. Choose another one."), so the
 * page can say why.
 *
 * Commands on a pin or a schedule carry the revision the page was built
 * from, so an edit made over a newer version answers `stale`.
 */
import { Effect, Exit, Stream } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import type {
  CardBinding,
  ActivityPage,
  ConnectionId,
  ReviewRule,
  ConnectionsPage,
  JunoSettingsPage,
  MemoryPage,
  PinId,
  RemembersPage,
  ReviewPage,
  ScheduledPage,
  ScheduleId,
  JobId,
  T3Address,
} from '@juno/agent-contract'
import type { Registry } from '../client'
import { call, live, rememberCards } from './chat'
import { AgentClient } from './client'
import { uuidv7 } from './ids'
import { showToast } from '../undo'

const IDLE_TTL = '30 seconds'

type Revision = number

const page = <A>(tag: string, payload: unknown = undefined) => AgentClient.runtime.atom(live<A, never>(tag, payload)).pipe(Atom.setIdleTTL(IDLE_TTL))

export const junoSettingsAtom = page<JunoSettingsPage>('agent.settings.page')
export const remembersPageAtom = page<{ readonly page: RemembersPage; readonly revisions: ReadonlyArray<{ readonly id: PinId; readonly revision: Revision }> }>('agent.remembers.page')
export const scheduledPageAtom = page<{ readonly page: ScheduledPage; readonly revisions: ReadonlyArray<{ readonly id: ScheduleId; readonly revision: Revision }> }>('agent.scheduled.page')
export const connectionsPageAtom = page<ConnectionsPage>('agent.connections.page')
type ReviewSnapshot = { readonly page: ReviewPage; readonly cards: ReadonlyArray<typeof CardBinding.Type> }
export const reviewPageAtom = AgentClient.runtime
  .atom(
    live<ReviewSnapshot, never>('agent.review.page', undefined).pipe(
      Stream.map((snapshot) => {
        rememberCards(snapshot.page.pending, snapshot.cards)
        return snapshot
      }),
    ),
  )
  .pipe(Atom.setIdleTTL(IDLE_TTL))

/** Memory and Activity: the newest `limit` rows, oldest first. A larger limit is "Load more". */
const memoryFamily = Atom.family((limit: number) => page<MemoryPage>('agent.memory.page', { window: { limit } }))
const activityFamily = Atom.family((limit: number) => page<ActivityPage>('agent.activity.page', { window: { limit } }))
export const memoryPageAtom = (limit: number) => memoryFamily(limit)
export const activityPageAtom = (limit: number) => activityFamily(limit)

/** A model family, the cap, Pause, the rules and the backup folder: what Settings › Juno changes. */
export type JunoSettingsChange =
  /** On a custom endpoint `family` is the model id, listed or typed. */
  | { readonly _tag: 'model'; readonly purpose: 'chat' | 'compaction'; readonly provider: 'openrouter' | 'codex' | 'custom'; readonly family: string }
  | { readonly _tag: 'cap'; readonly usd: number }
  | { readonly _tag: 'paused'; readonly value: boolean }
  /** The whole list, in order. */
  | { readonly _tag: 'rules'; readonly rules: ReadonlyArray<{ readonly id: string; readonly text: string }> }
  /** An absolute path; the agent answers once the first backup is in it. */
  | { readonly _tag: 'backupFolder'; readonly path: string }

/** Export recovery phrase, Move to another Mac, or Restore from backup after the owner confirmed the old Mac is off. */
export type OwnershipAction =
  | { readonly _tag: 'exportPhrase' }
  | { readonly _tag: 'move' }
  | { readonly _tag: 'restore'; readonly backupPath: string; readonly oldDeviceOffOrErased: true }

/** `ok`, or the agent's reason and its line for the owner. */
export type CommandAnswer = { readonly outcome: 'ok' } | { readonly outcome: string; readonly message?: string }

/** `ok`, or why the agent refused (`stale`, `invalid`, `unavailable`, ...). */
export type PageOutcome = 'ok' | string

async function outcome(pending: Promise<Exit.Exit<unknown, unknown>>): Promise<PageOutcome> {
  const exit = await pending
  if (Exit.isSuccess(exit)) return 'ok'
  const error = exit.cause.reasons.find((reason) => reason._tag === 'Fail')?.error as { readonly reason?: string } | undefined
  return error?.reason ?? 'failed'
}

async function answer(pending: Promise<Exit.Exit<unknown, unknown>>): Promise<CommandAnswer> {
  const exit = await pending
  if (Exit.isSuccess(exit)) return { outcome: 'ok' }
  const error = exit.cause.reasons.find((reason) => reason._tag === 'Fail')?.error as { readonly reason?: string; readonly message?: string } | undefined
  return { outcome: error?.reason ?? 'failed', ...(typeof error?.message === 'string' && error.message !== '' ? { message: error.message } : {}) }
}

export function junoPageActions(registry: Registry) {
  const op = () => uuidv7()
  return {
    settings: (change: JunoSettingsChange) => outcome(call(registry, 'agent.settings.change', { opId: op(), change })),
    editPin: (id: PinId, revision: Revision, text: string) => outcome(call(registry, 'agent.remembers.edit', { opId: op(), id, revision, text })),
    removePin: (id: PinId, revision: Revision) => outcome(call(registry, 'agent.remembers.remove', { opId: op(), id, revision })),
    schedule: (id: ScheduleId, revision: Revision, action: 'pause' | 'resume' | 'delete') => outcome(call(registry, 'agent.scheduled.action', { opId: op(), id, revision, action })),
    /** One tool's Enabled switch or auto-review rule. */
    tool: (id: ConnectionId, tool: string, change: { readonly enabled?: boolean; readonly review?: ReviewRule }) => outcome(call(registry, 'agent.connections.tool', { opId: op(), id, tool, ...change })),
    /** The connection's own auto-review rule. */
    rule: (id: ConnectionId, review: ReviewRule) => outcome(call(registry, 'agent.connections.rule', { opId: op(), id, review })),
    /** Connect waits for the browser sign-in when the server asks for one. */
    connection: (id: ConnectionId, action: 'enable' | 'disable' | 'connect' | 'disconnect' | 'remove') => outcome(call(registry, 'agent.connections.action', { opId: op(), id, action })),
    addConnection: (label: string, url: string) => outcome(call(registry, 'agent.connections.add', { opId: op(), label, url })),
    t3Address: (address: T3Address) => outcome(call(registry, 'agent.connections.address', { opId: op(), address })),
    backupFolder: (path: string) => answer(call(registry, 'agent.settings.change', { opId: op(), change: { _tag: 'backupFolder', path } })),
    ownership: (action: OwnershipAction) => answer(call(registry, 'agent.settings.ownership', { opId: op(), action })),
    /** Activate on the Review page: `backupAt` names the restore the owner reviewed. */
    activate: (backupAt: number) => answer(call(registry, 'agent.review.activate', { opId: op(), backupAt, oldDeviceOffOrErased: true })),
    stopJob: (jobId: JobId) => outcome(call(registry, 'agent.jobs.stop', { opId: op(), jobId })),
  }
}

/** The owner's menu click sets a watch without starting a model run. */
export async function watchReply(registry: Registry, message: { readonly channelId: string; readonly ts: string; readonly threadTs?: string }): Promise<void> {
  const result = await call<{ readonly id: ScheduleId; readonly at: number }>(registry, 'agent.schedule.watchReply', { opId: uuidv7(), ...message })
  if (Exit.isFailure(result)) {
    showToast(registry, { text: 'Could not watch for a reply.' })
    return
  }
  const { id, at } = result.value
  const until = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(at)
  showToast(registry, { text: `Watching for a reply until ${until}`, onUndo: async () => {
    const unmount = registry.mount(scheduledPageAtom)
    const snapshot = await Effect.runPromiseExit(AtomRegistry.getResult(registry, scheduledPageAtom)).finally(unmount)
    if (Exit.isFailure(snapshot)) return false
    const row = snapshot.value.revisions.find((candidate) => candidate.id === id)
    return row !== undefined && await junoPageActions(registry).schedule(id, row.revision, 'delete') === 'ok'
  } }, true)
}
