/** Pure memory rules. Callers own persistence, transactions, input snapshots and provider dispatch. */
export {
  limits,
  nodeKey,
  children,
  withinCutoff,
  utf8Bytes,
  context,
  renderSource,
  deps,
  taintClosure,
  mask,
  renderView,
  merge,
  batch,
  readyQueue,
  retryDelay,
} from './tree.ts';
export type { Key, Ref, Source, Node, Line } from './tree.ts';
export { start, complete, compactionTask } from './compaction.ts';
export type { Input, Completion } from './compaction.ts';
export { remember, editPin, deactivatePin } from './pins.ts';
export type { Pin, Pins, PinChange } from './pins.ts';
export { partition, upper, requiredWindow, buildRequest } from './request.ts';
export type { ActiveEntry } from './request.ts';
export { DOCS, DOC_TITLES, DOC_HINTS, docLimits, isDoc, looksSecret, checkEntry, renderDocs, searchDocs, outline } from './docs.ts';
export type { Doc, DocEntry, EntryRefusal } from './docs.ts';
export {
  SECTIONS,
  SECTION_TITLES,
  SECTION_HINTS,
  RELATIONSHIPS,
  peopleLimits,
  isSection,
  isRelationship,
  exchanged,
  qualifies,
  mayKeepFile,
  rankPeople,
  dueForUpdate,
  sensitiveKind,
  checkPersonEntry,
  renderPerson,
  peopleContext,
  peopleLine,
  peopleIn,
  splitPeopleNotes,
  workLine,
} from './people.ts';
export type { Section, Relationship, Interaction, PersonEntry, PersonRefusal, PersonFile, PersonSummary } from './people.ts';
