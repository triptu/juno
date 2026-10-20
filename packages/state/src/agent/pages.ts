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
  MemoryDoc,
  MemoryDocsPage,
  MemoryEntryId,
  MemoryPage,
  MemoryPersonId,
  MemorySection,
  PersonRelationship,
  PinId,
  ProactiveAsk,
  RemembersPage,
  ReviewPage,
  ScheduledPage,
  ScheduleId,
  JobId,
  T3Address,
} from '@juno/agent-contract'
import { junoAskCopy } from '@juno/agent-contract'
import type { HomeItem } from '@juno/contract'
import type { Registry } from '../client'
import { aiAssistOnAtom } from '../notifications'
import { afterPaint } from '../perf'
import type { JunoView } from '../tabs'
import { call, live, rememberCards } from './chat'
import { AgentClient } from './client'
import { uuidv7 } from './ids'
import { showToast } from '../undo'

const IDLE_TTL = '30 seconds'

type Revision = number

const page = <A>(tag: string, payload: unknown = undefined) => AgentClient.runtime.atom(live<A, never>(tag, payload)).pipe(Atom.setIdleTTL(IDLE_TTL))

export const junoSettingsAtom = page<JunoSettingsPage>('agent.settings.page')

/** The agent's settings page now, for a message that names today's limit. Undefined when the agent does not answer within a second. */
export async function junoSettingsNow(registry: Registry): Promise<JunoSettingsPage | undefined> {
  const unmount = registry.mount(junoSettingsAtom)
  const exit = await Effect.runPromiseExit(AtomRegistry.getResult(registry, junoSettingsAtom).pipe(Effect.timeoutOption('1 second'))).finally(unmount)
  return Exit.isSuccess(exit) && exit.value._tag === 'Some' ? exit.value.value : undefined
}
export const remembersPageAtom = page<{ readonly page: RemembersPage; readonly revisions: ReadonlyArray<{ readonly id: PinId; readonly revision: Revision }> }>('agent.remembers.page')
/** Juno's memory of the owner: the docs, the person files, the recent changes, and each entry's revision for an edit. */
export const docsPageAtom = page<{ readonly page: MemoryDocsPage; readonly revisions: ReadonlyArray<{ readonly id: MemoryEntryId; readonly revision: Revision }> }>('agent.docs.page')

/**
 * The person file open on What Juno remembers (SPEC 13.8), or none for the
 * whole page. "What Juno knows about {name}" sets it before the page opens.
 */
export const memoryPersonAtom = Atom.make<MemoryPersonId | undefined>(undefined).pipe(Atom.keepAlive)

/** Whether Juno keeps a file on `person` now, from the memory page. Undefined when the agent does not answer within a second. */
export async function hasPersonFile(registry: Registry, person: string): Promise<boolean | undefined> {
  const unmount = registry.mount(docsPageAtom)
  const exit = await Effect.runPromiseExit(AtomRegistry.getResult(registry, docsPageAtom).pipe(Effect.timeoutOption('1 second'))).finally(unmount)
  return Exit.isSuccess(exit) && exit.value._tag === 'Some' ? exit.value.value.page.people.some((file) => file.id === person) : undefined
}
/** What Juno remembers draws its notes and its pins together: Initial until both have answered. */
export const rememberedAtom = Atom.make((get) => {
  const docs = get(docsPageAtom)
  return docs._tag === 'Initial' ? docs : get(remembersPageAtom)
})
/** Juno's proactive asks, for Home's card. */
export const asksAtom = page<{ readonly asks: ReadonlyArray<ProactiveAsk> }>('agent.asks.list')

/**
 * The open asks as Home items, oldest first, while AI assist is on (SPEC
 * 13.6): "Let Juno learn how you work", with Not now and Start.
 */
export const homeAsksAtom = Atom.make((get): ReadonlyArray<HomeItem> => {
  // AI assist first, so Home opens no agent stream while it is off.
  if (!get(aiAssistOnAtom)) return []
  const result = get(asksAtom)
  if (result._tag !== 'Success') return []
  const learn = junoAskCopy.learn
  return result.value.asks.filter((ask) => ask.status._tag === 'open').map((ask): HomeItem => ({
    id: `ask:${ask.id}`,
    kind: 'ask',
    title: ask.reason === 'connection' ? learn.title.connection(ask.connection ?? '') : learn.title.setup,
    topics: [],
    at: ask.at,
    ask: { id: ask.id, ...(ask.connection === undefined ? {} : { connection: ask.connection }), sources: ask.sources },
  }))
})
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

/** Memory: the newest `limit` rows, oldest first. Activity: the newest `limit` runs, newest first. A larger limit is "Load more". */
const memoryFamily = Atom.family((limit: number) => page<MemoryPage>('agent.memory.page', { window: { limit } }))
const activityFamily = Atom.family((limit: number) => page<ActivityPage>('agent.activity.page', { window: { limit } }))
export const memoryPageAtom = (limit: number) => memoryFamily(limit)
export const activityPageAtom = (limit: number) => activityFamily(limit)

/** Runs Activity opens with, and adds for each "Show older runs"; the agent's page limit is 200, which Memory opens with. */
export const PAGE_ROWS = 50
export const PAGE_MAX = 200

/** The atom each Juno view draws first. The chat keeps its own window warm. */
function viewAtom(view: JunoView): Atom.Atom<{ readonly _tag: string }> | undefined {
  switch (view) {
    case 'chat':
      return undefined
    case 'activity':
      return activityPageAtom(PAGE_ROWS)
    case 'memory':
      return memoryPageAtom(PAGE_MAX)
    case 'remembers':
      return rememberedAtom
    case 'scheduled':
      return scheduledPageAtom
    case 'review':
      return reviewPageAtom
  }
}

/**
 * Resolves once a Juno view has what it draws first, or after `waitMs`: the
 * header's switcher then shows the finished page in one frame, never an
 * empty page under the header (performance 4.4). The page stays warm until
 * the frame after.
 */
export function junoViewReady(registry: Registry, view: JunoView, waitMs: number): Promise<void> {
  const atom = viewAtom(view)
  if (atom === undefined) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const release = registry.mount(atom)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      off()
      resolve()
      afterPaint(release)
    }
    const check = () => {
      if (registry.get(atom)._tag !== 'Initial') finish()
    }
    const timer = setTimeout(finish, waitMs)
    const off = registry.subscribe(atom, check, { immediate: false })
    check()
  })
}

/** A model family, the cap, Pause, the rules and the backup folder: what Settings › Juno changes. */
export type JunoSettingsChange =
  /** On a custom endpoint `family` is the model id, listed or typed. */
  | { readonly _tag: 'model'; readonly purpose: 'chat' | 'compaction' | 'fallback'; readonly provider: 'openrouter' | 'codex' | 'custom'; readonly family: string }
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
    /** The owner's own note, edit or delete on the memory page. A refusal answers with its line. */
    addDoc: (doc: MemoryDoc, text: string, file?: { readonly person: MemoryPersonId; readonly section: MemorySection }) =>
      answer(call(registry, 'agent.docs.add', { opId: op(), doc, text, ...(file === undefined ? {} : { person: file.person, section: file.section }) })),
    editDoc: (id: MemoryEntryId, revision: Revision, text: string) => answer(call(registry, 'agent.docs.edit', { opId: op(), id, revision, text })),
    deleteDoc: (id: MemoryEntryId, revision: Revision) => answer(call(registry, 'agent.docs.delete', { opId: op(), id, revision })),
    /** The owner corrects who a person is to them, or clears it. */
    relationship: (person: MemoryPersonId, revision: Revision, relationship: PersonRelationship | null) =>
      answer(call(registry, 'agent.docs.relationship', { opId: op(), person, revision, relationship })),
    /** Delete file: every note in a person's file. */
    deletePerson: (person: MemoryPersonId) => answer(call(registry, 'agent.docs.deletePerson', { opId: op(), person })),
    /** Start or Not now on a proactive ask, from Home. */
    answerAsk: (id: string, choice: 'start' | 'dismiss') => outcome(call(registry, 'agent.asks.answer', { opId: op(), id, answer: choice })),
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
