/**
 * The Search tab's view models (SPEC 10a, `docs/design/search/README.md`).
 * The container builds them from `@juno/state`'s session; the views only
 * draw them.
 */
import type { ConversationKind, Person, SearchPlace } from '@juno/contract'
import { messageTime, relativeTime } from '../time'
import type { TextRanges } from '../Highlighted'

/** What a chip in the field stands for. `topic` is ⌘F's scope, "in:" a topic's title. */
export type SearchChipOp = 'from' | 'in' | 'date' | 'has' | 'is' | 'topic'

export interface SearchChipView {
  /** Stable among the field's chips: the container's handle for edit and remove. */
  readonly key: string
  readonly op: SearchChipOp
  /** What follows the operator: "Maya Chen", "link", "Last week". */
  readonly label: string
  /** An excluding chip ("-from:"). */
  readonly negated?: boolean
  /** A from: chip's person, drawn as a 16px photo. */
  readonly person?: Person
  /** An in: chip's place, drawn as its kind's icon. */
  readonly place?: Pick<SearchPlace, 'kind'>
  /** A topic chip's art. */
  readonly topic?: { readonly id: string; readonly art?: string }
}

/** A row of the from: or in: picker: ⌘K's Conversations row, searched the same way. */
export interface SearchPickerRow {
  readonly id: string
  readonly name: string
  readonly highlight?: TextRanges
  readonly kind: ConversationKind
  readonly person?: Person
}

/** The operator names a chip shows before its label. Dates name themselves ("Last week"). */
export const chipOperator: Readonly<Record<SearchChipOp, string | undefined>> = {
  from: 'from:',
  in: 'in:',
  date: undefined,
  has: 'has:',
  is: 'is:',
  topic: 'in:',
}

const FORTNIGHT = 14 * 24 * 60 * 60 * 1000

/** A result's time: "2h", "Yesterday", "3d" for two weeks, then the date ("Sep 18"). */
export function searchTime(at: number, now: number): string {
  return now - at < FORTNIGHT ? relativeTime(at, now) : messageTime(at, now)
}

/** Epoch milliseconds of a Slack ts. */
export const tsMillis = (ts: string): number => Math.round(Number(ts) * 1000)
