/**
 * Juno's memory of the owner (SPEC 13.8): the docs as the memory page shows
 * them, the changes Juno and the owner made, and Juno's proactive asks
 * (13.6), which show in the chat and as a Home card.
 */
import { Schema } from 'effect'

/** The docs, in the order the page shows them. */
export const MemoryDoc = Schema.Literals(['you', 'people', 'projects', 'preferences', 'style'])
export type MemoryDoc = typeof MemoryDoc.Type

/** One entry, as the model and the page name it: `e12`. */
export const MemoryEntryId = Schema.String.pipe(Schema.brand('MemoryEntryId'))
export type MemoryEntryId = typeof MemoryEntryId.Type

/** Where an entry came from: the owner's words, Slack, or a connection by name ("Littlebird"). */
export const MemorySource = Schema.Union([
  Schema.TaggedStruct('owner', {}),
  Schema.TaggedStruct('slack', {}),
  Schema.TaggedStruct('connection', { name: Schema.String }),
])
export type MemorySource = typeof MemorySource.Type

export const MemoryEntryRow = Schema.Struct({
  id: MemoryEntryId,
  text: Schema.String,
  source: MemorySource,
  /** Written in a run that had read outside content (Slack, a connection, a report). */
  outside: Schema.Boolean,
  /** When it last changed. */
  at: Schema.Number,
})
export type MemoryEntryRow = typeof MemoryEntryRow.Type

export const MemoryDocSection = Schema.Struct({
  doc: MemoryDoc,
  entries: Schema.Array(MemoryEntryRow),
})
export type MemoryDocSection = typeof MemoryDocSection.Type

/* Person files (SPEC 13.8) ------------------------------------------------- */

/** A person file's sections, in the order the page shows them. */
export const MemorySection = Schema.Literals(['role', 'work', 'talk', 'notes'])
export type MemorySection = typeof MemorySection.Type

/** Who a person is to the owner. */
export const PersonRelationship = Schema.Literals(['manager', 'report', 'peer', 'skip', 'crossTeam', 'external', 'customer'])
export type PersonRelationship = typeof PersonRelationship.Type

/** A person's file, keyed by their Slack user id. */
export const MemoryPersonId = Schema.String.pipe(Schema.brand('MemoryPersonId'))
export type MemoryPersonId = typeof MemoryPersonId.Type

export const MemoryPersonEntry = Schema.Struct({ ...MemoryEntryRow.fields, section: MemorySection })
export type MemoryPersonEntry = typeof MemoryPersonEntry.Type

/**
 * One person file on the page. `relationshipBy` says whether the owner set
 * the relationship or Juno guessed it. `work` is the file's one line, the
 * first entry of What they work on. `revision` moves with the relationship.
 */
export const MemoryPerson = Schema.Struct({
  id: MemoryPersonId,
  name: Schema.String,
  relationship: Schema.optionalKey(PersonRelationship),
  relationshipBy: Schema.optionalKey(Schema.Literals(['juno', 'owner'])),
  work: Schema.optionalKey(Schema.String),
  entries: Schema.Array(MemoryPersonEntry),
  revision: Schema.Int,
})
export type MemoryPerson = typeof MemoryPerson.Type

/** One change to the docs, newest first on the page. */
export const MemoryChange = Schema.Struct({
  id: Schema.String,
  doc: MemoryDoc,
  /** The person whose file changed, by name, while the file exists. */
  person: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(['add', 'update', 'remove']),
  by: Schema.Literals(['juno', 'owner']),
  /** The entry's text after the change, or before it for a removal. Absent once the owner deleted the entry. */
  text: Schema.optionalKey(Schema.String),
  source: MemorySource,
  outside: Schema.Boolean,
  at: Schema.Number,
  undone: Schema.optionalKey(Schema.Literal(true)),
})
export type MemoryChange = typeof MemoryChange.Type

export const MemoryDocsPage = Schema.Struct({
  docs: Schema.Array(MemoryDocSection),
  /** The person files, most in touch first. The People doc's own entries are the general notes. */
  people: Schema.Array(MemoryPerson),
  changes: Schema.Array(MemoryChange),
})
export type MemoryDocsPage = typeof MemoryDocsPage.Type

/* Proactive asks ----------------------------------------------------------- */

export const AskId = Schema.String.pipe(Schema.brand('AskId'))
export type AskId = typeof AskId.Type

/**
 * Where an ask stands. `running` carries the pass's live line. `done` says
 * how many entries it wrote. `failed` and `stopped` say why it ended early,
 * and both offer Try again.
 */
export const AskStatus = Schema.Union([
  Schema.TaggedStruct('open', {}),
  Schema.TaggedStruct('running', { line: Schema.String }),
  Schema.TaggedStruct('done', { written: Schema.Int }),
  Schema.TaggedStruct('failed', { reason: Schema.Literals(['budget', 'failed', 'noModel']), written: Schema.Int }),
  Schema.TaggedStruct('stopped', { reason: Schema.Literals(['owner', 'paused', 'interrupted']), written: Schema.Int }),
  Schema.TaggedStruct('dismissed', {}),
])
export type AskStatus = typeof AskStatus.Type

/**
 * A proactive ask. `learn`: a background pass that reads the owner's own
 * Slack messages and `sources` (connections that hold their context), and
 * fills Juno's memory of them. `reason` says why now: after setup, or a
 * connection (`connection`) was added.
 */
export const ProactiveAsk = Schema.Struct({
  id: AskId,
  kind: Schema.Literal('learn'),
  reason: Schema.Literals(['setup', 'connection']),
  connection: Schema.optionalKey(Schema.String),
  /** The connected sources the pass reads besides Slack, by name. */
  sources: Schema.Array(Schema.String),
  status: AskStatus,
  at: Schema.Number,
})
export type ProactiveAsk = typeof ProactiveAsk.Type

/** What a button on an ask asks for. */
export const AskAnswer = Schema.Literals(['start', 'dismiss', 'stop'])
export type AskAnswer = typeof AskAnswer.Type
