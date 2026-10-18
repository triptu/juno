/**
 * Juno's memory of the owner as the renderer sees it (SPEC 13.6, 13.8): the
 * memory page, the chat's "Updated memory · People · Undo" notes and the
 * proactive asks, for the chat and Home. Plain functions over the store.
 */
import { DOCS, workLine } from '@juno/agent-memory'
import { ChatMessageId, MemoryEntryId, MemoryPersonId, AskId, type ChatItem, type MemoryDocsPage, type MemorySource, type ProactiveAsk } from '@juno/agent-contract'
import { Revision } from '@juno/agent-cards'
import type { McpManagerApi } from '../mcp/manager'
import type { Store } from '../store/store'
import { asks, CONTEXT_CONNECTIONS, type Ask } from './asks'
import { people } from './people'
import { entries, recentWrites, runWrites, type Entry, type SourceKind } from './store'

/** Undo on a note stays until the owner's next message, or for a minute. */
export const UNDO_MS = 60_000

const sourceOf = (source: SourceKind, connection: string | null): MemorySource =>
  source === 'connection' ? { _tag: 'connection', name: connection ?? 'A connection' } : { _tag: source }

const rowOf = (entry: Entry) => ({
  id: MemoryEntryId.make(`e${entry.id}`), text: entry.text, source: sourceOf(entry.source, entry.connection), outside: entry.tainted, at: entry.updatedAt,
})

export function docsPage(store: Store): { readonly page: MemoryDocsPage; readonly revisions: ReadonlyArray<{ readonly id: MemoryEntryId; readonly revision: typeof Revision.Type }> } {
  const all = entries(store)
  const files = people(store)
  const names = new Map(files.map((p) => [p.id, p.name]))
  return {
    page: {
      docs: DOCS.map((doc) => ({ doc, entries: all.filter((entry) => entry.doc === doc && entry.person === null).map(rowOf) })),
      people: files.map((p) => {
        const own = all.filter((entry) => entry.person === p.id)
        const work = workLine(own.map((entry) => ({ id: `e${entry.id}`, section: entry.section ?? 'notes', text: entry.text })))
        return {
          id: MemoryPersonId.make(p.id), name: p.name,
          ...(p.relationship === null ? {} : { relationship: p.relationship }),
          ...(p.relationshipBy === null ? {} : { relationshipBy: p.relationshipBy }),
          ...(work === undefined ? {} : { work }),
          entries: own.map((entry) => ({ ...rowOf(entry), section: entry.section ?? 'notes' })),
          revision: p.version,
        }
      }),
      changes: recentWrites(store).map((write) => ({
        id: write.id, doc: write.doc, kind: write.kind, by: write.by,
        ...(write.person !== null && names.has(write.person) ? { person: names.get(write.person)! } : {}),
        ...((write.kind === 'remove' ? write.before : write.after) === null ? {} : { text: (write.kind === 'remove' ? write.before : write.after)! }),
        source: sourceOf(write.source, write.connection), outside: write.tainted, at: write.at,
        ...(write.undone ? { undone: true as const } : {}),
      })),
    },
    revisions: all.map((entry) => ({ id: MemoryEntryId.make(`e${entry.id}`), revision: Revision.make(entry.version) })),
  }
}

/** The chat's memory notes, one per run or pass, at its last change. A run whose changes were all undone has none. */
export function docNotes(store: Store): ReadonlyArray<{ readonly at: number; readonly item: ChatItem }> {
  const last = (store.db.prepare("SELECT max(at) AS at FROM inbox WHERE kind IN ('send', 'steer', 'retry')").get() as { at: number | null }).at ?? 0
  const now = store.now()
  return runWrites(store).filter((run) => !run.undone).map((run) => ({
    at: run.lastAt,
    item: {
      _tag: 'note', id: ChatMessageId.make(`memory:${run.runId}`), kind: 'memoryUpdated', docs: DOCS.filter((doc) => run.docs.includes(doc)), run: run.runId,
      ...(run.undoable && now < run.lastAt + UNDO_MS && last <= run.lastAt ? { undo: true as const } : {}),
    },
  }))
}

/** The context connections ready now, by name. */
function readySources(manager: McpManagerApi | undefined): ReadonlyArray<string> {
  if (manager === undefined) return []
  return manager.configs().filter((config) => CONTEXT_CONNECTIONS.has(config.id) && manager.state(config.id) === 'ready').map((config) => config.label)
}

const statusOf = (ask: Ask): ProactiveAsk['status'] => {
  const written = ask.result?.written ?? 0
  switch (ask.state) {
    case 'open':
    case 'covered':
      return { _tag: 'open' }
    case 'running':
      return { _tag: 'running', line: ask.line ?? 'Reading your messages' }
    case 'done':
      return { _tag: 'done', written }
    case 'failed':
      return { _tag: 'failed', reason: ask.result?.ended === 'budget' ? 'budget' : ask.result?.ended === 'noModel' ? 'noModel' : 'failed', written }
    case 'stopped':
      return { _tag: 'stopped', reason: ask.result?.ended === 'paused' ? 'paused' : ask.result?.ended === 'interrupted' ? 'interrupted' : 'owner', written }
    case 'dismissed':
      return { _tag: 'dismissed' }
  }
}

/** Every ask the owner has seen or may answer, oldest first. */
export function askViews(store: Store, manager: McpManagerApi | undefined): ReadonlyArray<ProactiveAsk> {
  const ready = readySources(manager)
  return asks(store).map((ask) => {
    const name = CONTEXT_CONNECTIONS.get(ask.connection) ?? ask.connection
    return {
      id: AskId.make(ask.id), kind: ask.kind, reason: ask.reason,
      ...(ask.reason === 'connection' ? { connection: name } : {}),
      sources: ask.reason === 'connection' ? [name] : ready,
      status: statusOf(ask), at: ask.at,
    }
  })
}

/** The asks as chat rows, at the time each was offered. */
export const askLines = (views: ReadonlyArray<ProactiveAsk>): ReadonlyArray<{ readonly at: number; readonly item: ChatItem }> =>
  views.map((ask) => ({ at: ask.at, item: { _tag: 'ask', ask } }))
