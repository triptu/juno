/**
 * Juno's memory tools (SPEC 13.8, 13.9 Local tier). `memory_read` and
 * `memory_search` read the docs; `memory_write` adds, changes or removes one
 * entry with no card, in any run. A write in a run that had read outside
 * content is marked so, and its source is the owner's words only in a run
 * that read nothing else. Each write shows a quiet note in the chat with
 * Undo. Nothing the docs say grants anything: the docs are context.
 */
import { DOC_HINTS, DOC_TITLES, DOCS, isDoc, renderDocs, searchDocs, type Doc, type EntryRefusal } from '@juno/agent-memory'
import { defineTool, type JunoTool, type ToolRun } from '../request/tool'
import type { Store } from '../store/store'
import { docEntries, entries, entryId, writeEntry, type SourceKind, type WriteResult } from './store'

export interface MemoryDocsToolContext {
  readonly store: Store
  readonly current: () => Promise<ToolRun | undefined>
  /** A write landed in `runId`: the chat shows "Updated memory · People · Undo". */
  readonly written: (runId: string, doc: Doc) => void
}

const docList = DOCS.map((doc) => `${doc} (${DOC_TITLES[doc]}: ${DOC_HINTS[doc]})`).join('; ')

export const refusalText: Record<EntryRefusal | 'unknownEntry' | 'stale', string> = {
  empty: 'Nothing was written: the text is empty.',
  tooLong: 'Nothing was written: an entry is at most 600 bytes. Keep it to a line or two.',
  secret: 'Nothing was written: it looks like a key, a token or a password, and Juno never keeps those.',
  docFull: 'Nothing was written: that doc is full. Merge or remove entries first.',
  full: 'Nothing was written: the memory is full. Merge or remove entries first.',
  unknownEntry: 'Nothing was written: there is no such entry. Read the doc for its ids.',
  stale: 'Nothing was written: that entry changed meanwhile. Read it again.',
}

/** Where a write came from, as the model named it, checked against what the run read. */
export function sourceOf(named: string | undefined, clean: boolean): { readonly source: SourceKind; readonly connection?: string } {
  const word = (named ?? '').trim()
  if (clean || word === '' || /^(owner|you|your words|chat)$/i.test(word)) return { source: 'owner' }
  if (/^slack$/i.test(word)) return { source: 'slack' }
  return { source: 'connection', connection: word.slice(0, 60) }
}

/** The tool's answer for one write. */
export function writeAnswer(result: WriteResult): { readonly text: string; readonly isError?: boolean } {
  if (result._tag === 'refused') return { text: refusalText[result.reason], isError: true }
  const { write, entry } = result
  const verb = write.kind === 'add' ? 'Added' : write.kind === 'update' ? 'Changed' : 'Removed'
  return { text: `${verb} e${entry.id} in ${DOC_TITLES[write.doc]}.` }
}

export function memoryDocsTools(context: MemoryDocsToolContext): ReadonlyArray<JunoTool> {
  const { store } = context
  const read = defineTool<{ readonly doc?: string }>({
    name: 'memory_read',
    description: `Read your memory of the owner: one doc, or all of them. The docs: ${docList}. Each entry starts with its id, such as [e12].`,
    parameters: { type: 'object', properties: { doc: { type: 'string', enum: [...DOCS] } }, additionalProperties: false },
    replay: 'safe',
    status: () => 'Reading what I know about you',
    run: async ({ doc }) => ({ text: renderDocs(docEntries(entries(store)), doc !== undefined && isDoc(doc) ? doc : undefined) }),
  })
  const search = defineTool<{ readonly query: string }>({
    name: 'memory_search',
    description: 'Search your memory of the owner for entries with these words, best match first.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    replay: 'safe',
    status: () => 'Looking through what I know about you',
    run: async ({ query }) => {
      const found = searchDocs(docEntries(entries(store)), query)
      return { text: found.length === 0 ? 'No entries match.' : found.map((entry) => `[${entry.id}] ${DOC_TITLES[entry.doc]}: ${entry.text}`).join('\n') }
    },
  })
  const write = defineTool<{ readonly doc?: string; readonly entry?: string; readonly text?: string; readonly remove?: boolean; readonly source?: string }>({
    name: 'memory_write',
    description:
      'Keep your memory of the owner current, with no card: add an entry (doc and text), change one (entry and text), or remove one (entry and remove). ' +
      'Keep entries short and lasting: facts and habits, not today\'s news. Prefer changing an entry to adding a near copy. ' +
      'source says where you learned it: owner (their words to you), slack, or the connection\'s name. ' +
      'Never write keys, tokens, passwords or other credentials. Leave out health, money, family, beliefs and other sensitive details unless the owner told you themselves.',
    parameters: {
      type: 'object',
      properties: {
        doc: { type: 'string', enum: [...DOCS] },
        entry: { type: 'string', description: 'The id of the entry to change or remove, such as e12.' },
        text: { type: 'string', description: 'The entry, in plain words or a little markdown. At most 600 bytes.' },
        remove: { type: 'boolean' },
        source: { type: 'string' },
      },
      additionalProperties: false,
    },
    replay: 'safe',
    status: () => 'Updating what I know about you',
    run: async (args, call) => {
      const run = await context.current()
      if (run === undefined) return { text: 'No active run.', isError: true }
      const entry = args.entry === undefined ? undefined : entryId(args.entry)
      if (args.entry !== undefined && entry === undefined) return { text: refusalText.unknownEntry, isError: true }
      if (entry === undefined && (args.doc === undefined || !isDoc(args.doc))) return { text: `Nothing was written: name the doc to add to, one of ${DOCS.join(', ')}.`, isError: true }
      const result = writeEntry(store, {
        id: `w-${call.callId}`, runId: run.runId, by: 'juno', tainted: !run.clean,
        ...sourceOf(args.source, run.clean),
        ...(entry === undefined ? {} : { entry }),
        ...(args.doc !== undefined && isDoc(args.doc) ? { doc: args.doc } : {}),
        ...(args.text === undefined ? {} : { text: args.text }),
        ...(args.remove === true ? { remove: true } : {}),
      })
      if (result._tag === 'written') context.written(run.runId, result.write.doc)
      return writeAnswer(result)
    },
  })
  return [read, search, write]
}
