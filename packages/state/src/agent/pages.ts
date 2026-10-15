/**
 * The pages behind the Juno menu and Settings › Juno (SPEC 13.10), live from
 * the agent (`packages/agent/src/serve/pages.ts`, `src/settings/`), and what
 * their buttons call. A page whose records come with a later work package
 * (Scheduled, Connections, Review) streams an empty page, and its commands
 * answer `unavailable`. Review's Activate needs the owner's word that the
 * old Mac is off (WP21), and recovery cannot happen before it, so it is
 * not here.
 *
 * Commands on a pin or a schedule carry the revision the page was built
 * from, so an edit made over a newer version answers `stale`.
 */
import { Exit } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import type {
  ActivityPage,
  ConnectionId,
  ConnectionsPage,
  JunoSettingsPage,
  MemoryPage,
  PinId,
  RemembersPage,
  ReviewPage,
  ScheduledPage,
  ScheduleId,
  T3Address,
} from '@juno/agent-contract'
import type { Registry } from '../client'
import { call, live } from './chat'
import { AgentClient } from './client'
import { uuidv7 } from './ids'

const IDLE_TTL = '30 seconds'

type Revision = number

const page = <A>(tag: string, payload: unknown = undefined) => AgentClient.runtime.atom(live<A, never>(tag, payload)).pipe(Atom.setIdleTTL(IDLE_TTL))

export const junoSettingsAtom = page<JunoSettingsPage>('agent.settings.page')
export const remembersPageAtom = page<{ readonly page: RemembersPage; readonly revisions: ReadonlyArray<{ readonly id: PinId; readonly revision: Revision }> }>('agent.remembers.page')
export const scheduledPageAtom = page<{ readonly page: ScheduledPage; readonly revisions: ReadonlyArray<{ readonly id: ScheduleId; readonly revision: Revision }> }>('agent.scheduled.page')
export const connectionsPageAtom = page<ConnectionsPage>('agent.connections.page')
export const reviewPageAtom = page<{ readonly page: ReviewPage }>('agent.review.page')

/** Memory and Activity: the newest `limit` rows, oldest first. A larger limit is "Load more". */
const memoryFamily = Atom.family((limit: number) => page<MemoryPage>('agent.memory.page', { window: { limit } }))
const activityFamily = Atom.family((limit: number) => page<ActivityPage>('agent.activity.page', { window: { limit } }))
export const memoryPageAtom = (limit: number) => memoryFamily(limit)
export const activityPageAtom = (limit: number) => activityFamily(limit)

/** A model family, the cap, Pause and the rules: what Settings › Juno changes today. The backup folder comes with WP21. */
export type JunoSettingsChange =
  | { readonly _tag: 'model'; readonly purpose: 'chat' | 'compaction'; readonly provider: 'openrouter' | 'codex'; readonly family: string }
  | { readonly _tag: 'cap'; readonly usd: number }
  | { readonly _tag: 'paused'; readonly value: boolean }
  /** The whole list, in order. */
  | { readonly _tag: 'rules'; readonly rules: ReadonlyArray<{ readonly id: string; readonly text: string }> }

/** `ok`, or why the agent refused (`stale`, `invalid`, `unavailable`, ...). */
export type PageOutcome = 'ok' | string

async function outcome(pending: Promise<Exit.Exit<unknown, unknown>>): Promise<PageOutcome> {
  const exit = await pending
  if (Exit.isSuccess(exit)) return 'ok'
  const error = exit.cause.reasons.find((reason) => reason._tag === 'Fail')?.error as { readonly reason?: string } | undefined
  return error?.reason ?? 'failed'
}

export function junoPageActions(registry: Registry) {
  const op = () => uuidv7()
  return {
    settings: (change: JunoSettingsChange) => outcome(call(registry, 'agent.settings.change', { opId: op(), change })),
    editPin: (id: PinId, revision: Revision, text: string) => outcome(call(registry, 'agent.remembers.edit', { opId: op(), id, revision, text })),
    removePin: (id: PinId, revision: Revision) => outcome(call(registry, 'agent.remembers.remove', { opId: op(), id, revision })),
    schedule: (id: ScheduleId, revision: Revision, action: 'pause' | 'resume' | 'delete') => outcome(call(registry, 'agent.scheduled.action', { opId: op(), id, revision, action })),
    connection: (id: ConnectionId, action: 'enable' | 'disable') => outcome(call(registry, 'agent.connections.action', { opId: op(), id, action })),
    t3Address: (address: T3Address) => outcome(call(registry, 'agent.connections.address', { opId: op(), address })),
  }
}

export type JunoPageActions = ReturnType<typeof junoPageActions>
