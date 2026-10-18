/**
 * Juno's memory tools (SPEC 13.8, 13.9 Local tier). `memory_read` and
 * `memory_search` read the docs; `memory_write` adds, changes or removes one
 * entry with no card, in any run. A write in a run that had read outside
 * content is marked so, and its source is the owner's words only in a run
 * that read nothing else. Each write shows a quiet note in the chat with
 * Undo. Nothing the docs say grants anything: the docs are context.
 *
 * Each person the owner works with has a file (`person`, a Slack user id).
 * Juno starts one only for someone the owner exchanges messages with, or
 * when the owner asks in a clean run; it never writes a sensitive detail
 * about them that the owner did not say.
 */
import {
  DOC_HINTS, DOC_TITLES, DOCS, isDoc, isRelationship, isSection, mayKeepFile, RELATIONSHIPS, renderDocs, renderPerson, searchDocs,
  SECTION_HINTS, SECTION_TITLES, SECTIONS, type Doc, type DocEntry, type Relationship,
} from '@juno/agent-memory'
import { defineTool, type JunoTool, type ToolRun } from '../request/tool'
import type { Store } from '../store/store'
import { deletedFile, fileOf, findPerson, people, person, setRelationship, type Contacts, type RelationshipResult } from './people'
import { docEntries, entries, entryId, openFile, writeEntry, type SourceKind, type WriteRefusal, type WriteResult } from './store'

export interface MemoryDocsToolContext {
  readonly store: Store
  readonly current: () => Promise<ToolRun | undefined>
  /** A write landed in `runId`: the chat shows "Updated memory · People · Undo". */
  readonly written: (runId: string, doc: Doc) => void
  /** Who the owner exchanges messages with, as last counted: Juno starts a file on its own only for them. */
  readonly contacts?: Contacts
  /** A person's name from Slack, to start their file. */
  readonly lookup?: (userId: string) => Promise<string | undefined>
}

const docList = DOCS.map((doc) => `${doc} (${DOC_TITLES[doc]}: ${DOC_HINTS[doc]})`).join('; ')
export const sectionList = SECTIONS.map((section) => `${section} (${SECTION_TITLES[section]}: ${SECTION_HINTS[section]})`).join('; ')

export const refusalText: Record<WriteRefusal | 'notInTouch' | 'ownerSet', string> = {
  empty: 'Nothing was written: the text is empty.',
  tooLong: 'Nothing was written: an entry is at most 600 bytes. Keep it to a line or two.',
  secret: 'Nothing was written: it looks like a key, a token or a password, and Juno never keeps those.',
  sensitive: 'Nothing was written: it holds a sensitive detail about a person (health, money, family, performance, beliefs, legal matters or contact details), which Juno keeps only when the owner says it themselves.',
  docFull: 'Nothing was written: that doc is full. Merge or remove entries first.',
  full: 'Nothing was written: the memory is full. Merge or remove entries first.',
  sectionFull: 'Nothing was written: that section of the file is full. Merge or remove entries first.',
  fileFull: 'Nothing was written: that file is full. Merge or remove entries first.',
  unknownEntry: 'Nothing was written: there is no such entry. Read the doc for its ids.',
  stale: 'Nothing was written: that entry changed meanwhile. Read it again.',
  unknownPerson: 'Nothing was written: Juno has no file on that person. Name them by their Slack user id.',
  notInTouch: 'Nothing was written: Juno keeps files only on people the owner exchanges messages with, or when the owner asks.',
  ownerSet: 'Nothing was changed: the owner set this relationship, and only they change it.',
}

/** A person's file as the model reads it, or why there is none. */
export function readPerson(store: Store, named: string): { readonly text: string; readonly isError?: boolean } {
  const found = findPerson(store, named)
  if (found === undefined) return { text: `No file on ${named}. Files: ${people(store).map((p) => `${p.name} (${p.id})`).join(', ') || 'none yet'}.`, isError: true }
  return { text: renderPerson(fileOf(found, entries(store))) }
}

/** Every doc, then the files by name, without their notes. */
export function readAll(store: Store, all: ReadonlyArray<DocEntry>): string {
  const files = people(store)
  const roster = files.length === 0 ? '(none yet)' : files.map((p) => `- ${p.name} (${p.id})${p.relationship === null ? '' : `, ${p.relationship}`}`).join('\n')
  return `${renderDocs(all)}\n\n# Person files (read one with person)\n${roster}`
}

export interface PersonWrite {
  readonly person: string
  readonly name?: string
  readonly section?: string
  readonly text?: string
  readonly relationship?: string
}

/**
 * The person part of a write: starts the file when it may exist, then
 * sets the relationship or adds the entry. `asked`: the owner's own words
 * in a clean run. Answers the tool's result.
 */
export async function writePerson(
  context: Pick<MemoryDocsToolContext, 'store' | 'contacts' | 'lookup'>,
  args: PersonWrite,
  base: { readonly id: string; readonly runId: string; readonly tainted: boolean; readonly asked: boolean; readonly source: SourceKind; readonly connection?: string },
): Promise<{ readonly result?: WriteResult; readonly text: string; readonly isError?: boolean; readonly summary?: string }> {
  const { store } = context
  const named = args.person.trim()
  const existing = findPerson(store, named)
  const id = existing?.id ?? named
  if (existing === undefined) {
    if (!/^[UW][A-Z0-9]{2,}$/.test(id)) return { text: refusalText.unknownPerson, isError: true }
    const may = mayKeepFile({ asked: base.asked, interaction: context.contacts?.get(id), now: store.now() })
    if (!may || (deletedFile(store, id) && !base.asked)) return { text: refusalText.notInTouch, isError: true }
  }
  const name = existing?.name ?? (await context.lookup?.(id)) ?? args.name?.trim()
  const create = existing === undefined && name !== undefined ? { name, reason: base.asked ? ('asked' as const) : ('interaction' as const) } : undefined
  let relationship: RelationshipResult | undefined
  let result: WriteResult | undefined
  if (args.text !== undefined && args.text.trim() !== '') {
    result = writeEntry(store, {
      id: base.id, runId: base.runId, by: 'juno', tainted: base.tainted, source: base.source, ...(base.connection === undefined ? {} : { connection: base.connection }),
      person: id, section: args.section !== undefined && isSection(args.section) ? args.section : 'notes', text: args.text,
      ...(create === undefined ? {} : { create }),
    })
    if (result._tag === 'refused') return { result, text: refusalText[result.reason], isError: true }
  }
  if (args.relationship !== undefined) {
    if (!isRelationship(args.relationship)) return { text: `Nothing was changed: the relationship is one of ${RELATIONSHIPS.join(', ')}.`, isError: true }
    // A relationship alone starts the file too.
    if (person(store, id) === undefined && !openFile(store, id, create, store.now())) return { text: refusalText.unknownPerson, isError: true }
    relationship = setRelationship(store, { person: id, relationship: args.relationship as Relationship, by: base.asked ? 'owner' : 'juno' })
    if (relationship._tag === 'refused') return { ...(result === undefined ? {} : { result }), text: refusalText[relationship.reason === 'stale' ? 'stale' : relationship.reason], isError: true }
  }
  if (result === undefined && relationship === undefined) return { text: 'Nothing was written: give text for a section, or a relationship.', isError: true }
  const who = person(store, id)?.name ?? name ?? id
  const parts = [
    ...(result?._tag === 'written' ? [`Added e${result.entry.id} to ${who}, ${SECTION_TITLES[result.entry.section ?? 'notes']}.`] : []),
    ...(relationship?._tag === 'set' ? [`${who} is now ${relationship.person.relationship ?? 'not set'}.`] : []),
  ]
  return { ...(result === undefined ? {} : { result }), text: parts.join(' '), summary: DOC_TITLES.people }
}

/** Where a write came from, as the model named it, checked against what the run read. */
export function sourceOf(named: string | undefined, clean: boolean): { readonly source: SourceKind; readonly connection?: string } {
  const word = (named ?? '').trim()
  if (clean || word === '' || /^(owner|you|your words|chat)$/i.test(word)) return { source: 'owner' }
  if (/^slack$/i.test(word)) return { source: 'slack' }
  return { source: 'connection', connection: word.slice(0, 60) }
}

/** The tool's answer for one write. Its summary names the doc, for Activity's step ("Updated memory · People"). */
export function writeAnswer(result: WriteResult): { readonly text: string; readonly isError?: boolean; readonly summary?: string } {
  if (result._tag === 'refused') return { text: refusalText[result.reason], isError: true }
  const { write, entry } = result
  const verb = write.kind === 'add' ? 'Added' : write.kind === 'update' ? 'Changed' : 'Removed'
  const where = entry.person === null ? DOC_TITLES[write.doc] : `the file on ${entry.person}, ${SECTION_TITLES[entry.section ?? 'notes']}`
  return { text: `${verb} e${entry.id} in ${where}.`, summary: DOC_TITLES[write.doc] }
}

export const WRITE_DESCRIPTION =
  'Keep your memory of the owner current, with no card: add an entry (doc and text), change one (entry and text), or remove one (entry and remove). ' +
  'For a person the owner works with, add to their file with person (their Slack user id) and section, or set who they are to the owner with person and relationship. ' +
  `Sections: ${SECTIONS.join(', ')}. Relationships: ${RELATIONSHIPS.join(', ')}. ` +
  'Keep a file only on people the owner exchanges messages with, or when the owner asks. "How you talk with them" (talk) is how the owner writes to that person, not their general style. ' +
  'A Slack profile title is a hint, not the relationship. ' +
  'Keep entries short and lasting: facts and habits, not today\'s news. Prefer changing an entry to adding a near copy. ' +
  'source says where you learned it: owner (their words to you), slack, or the connection\'s name. ' +
  'Never write keys, tokens, passwords or other credentials. Never write health, pay or money, family, performance judgments, beliefs, legal matters or contact details about a person unless the owner told you themselves.'

export const WRITE_PARAMETERS = {
  type: 'object',
  properties: {
    doc: { type: 'string', enum: [...DOCS] },
    entry: { type: 'string', description: 'The id of the entry to change or remove, such as e12.' },
    text: { type: 'string', description: 'The entry, in plain words or a little markdown. At most 600 bytes.' },
    remove: { type: 'boolean' },
    source: { type: 'string' },
    person: { type: 'string', description: 'A Slack user id such as U0MAYA, for their file.' },
    section: { type: 'string', enum: [...SECTIONS] },
    relationship: { type: 'string', enum: [...RELATIONSHIPS] },
  },
  additionalProperties: false,
} as const

export function memoryDocsTools(context: MemoryDocsToolContext): ReadonlyArray<JunoTool> {
  const { store } = context
  const read = defineTool<{ readonly doc?: string; readonly person?: string }>({
    name: 'memory_read',
    description:
      `Read your memory of the owner: one doc, one person's file, or all the docs with the list of files. The docs: ${docList}. ` +
      `A person's file has the sections ${sectionList}. Each entry starts with its id, such as [e12].`,
    parameters: {
      type: 'object',
      properties: { doc: { type: 'string', enum: [...DOCS] }, person: { type: 'string', description: 'A Slack user id such as U0MAYA, or a name.' } },
      additionalProperties: false,
    },
    replay: 'safe',
    status: () => 'Reading what I know about you',
    run: async ({ doc, person: named }) => {
      if (named !== undefined) {
        const found = findPerson(store, named)
        const shown = found === undefined ? 0 : entries(store).filter((entry) => entry.person === found.id).length
        return { ...readPerson(store, named), summary: shown === 1 ? '1 note' : `${shown} notes` }
      }
      const all = docEntries(entries(store))
      const only = doc !== undefined && isDoc(doc) ? doc : undefined
      const shown = only === undefined ? all.length : all.filter((entry) => entry.doc === only).length
      return { text: only === undefined ? readAll(store, all) : renderDocs(all, only), summary: shown === 1 ? '1 note' : `${shown} notes` }
    },
  })
  const search = defineTool<{ readonly query: string }>({
    name: 'memory_search',
    description: 'Search your memory of the owner for entries with these words, best match first.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    replay: 'safe',
    status: () => 'Looking through what I know about you',
    run: async ({ query }) => {
      // A file's entries are searched with the person's name and the section's title in front.
      const all = entries(store)
      const names = new Map(people(store).map((p) => [p.id, p.name]))
      const where = new Map<string, string>()
      const searchable = all.map((entry): DocEntry => {
        if (entry.person === null) return { id: `e${entry.id}`, doc: entry.doc, text: entry.text }
        const label = `${names.get(entry.person) ?? entry.person} › ${SECTION_TITLES[entry.section ?? 'notes']}`
        where.set(`e${entry.id}`, label)
        return { id: `e${entry.id}`, doc: entry.doc, text: `${label}: ${entry.text}` }
      })
      const found = searchDocs(searchable, query)
      const summary = found.length === 1 ? '1 note' : `${found.length} notes`
      return { text: found.length === 0 ? 'No entries match.' : found.map((entry) => (where.has(entry.id) ? `[${entry.id}] ${entry.text}` : `[${entry.id}] ${DOC_TITLES[entry.doc]}: ${entry.text}`)).join('\n'), summary }
    },
  })
  const write = defineTool<{ readonly doc?: string; readonly entry?: string; readonly text?: string; readonly remove?: boolean; readonly source?: string; readonly person?: string; readonly section?: string; readonly relationship?: string }>({
    name: 'memory_write',
    description: WRITE_DESCRIPTION,
    parameters: WRITE_PARAMETERS,
    replay: 'safe',
    status: () => 'Updating what I know about you',
    run: async (args, call) => {
      const run = await context.current()
      if (run === undefined) return { text: 'No active run.', isError: true }
      if (args.entry === undefined && args.person !== undefined) {
        const answer = await writePerson(context, { ...args, person: args.person }, { id: `w-${call.callId}`, runId: run.runId, tainted: !run.clean, asked: run.clean, ...sourceOf(args.source, run.clean) })
        if (answer.result?._tag === 'written') context.written(run.runId, 'people')
        return { text: answer.text, ...(answer.isError ? { isError: true } : {}), ...(answer.summary ? { summary: answer.summary } : {}) }
      }
      const entry = args.entry === undefined ? undefined : entryId(args.entry)
      if (args.entry !== undefined && entry === undefined) return { text: refusalText.unknownEntry, isError: true }
      if (entry === undefined && (args.doc === undefined || !isDoc(args.doc))) return { text: `Nothing was written: name the doc to add to, one of ${DOCS.join(', ')}.`, isError: true }
      const result = writeEntry(store, {
        id: `w-${call.callId}`, runId: run.runId, by: 'juno', tainted: !run.clean,
        ...sourceOf(args.source, run.clean),
        ...(entry === undefined ? {} : { entry }),
        ...(args.doc !== undefined && isDoc(args.doc) ? { doc: args.doc } : {}),
        ...(args.section !== undefined && isSection(args.section) ? { section: args.section } : {}),
        ...(args.text === undefined ? {} : { text: args.text }),
        ...(args.remove === true ? { remove: true } : {}),
      })
      if (result._tag === 'written') context.written(run.runId, result.write.doc)
      return writeAnswer(result)
    },
  })
  return [read, search, write]
}
