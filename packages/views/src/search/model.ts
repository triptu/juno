/**
 * The Search tab's view models (SPEC 10a, `docs/design/search/README.md`).
 * The container builds them from `@juno/state`'s session; the views only
 * draw them.
 */
import type { ConversationKind, Person, SearchPlace } from '@juno/contract'
import { messageHeaderTime, messageTime } from '../time'
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

/** A result's time: the date and time a message header shows ("Oct 22, 20:41", "Yesterday 19:42", "10:41"), or `short`, the day alone ("Yesterday"). */
export function searchTime(at: number, now: number, short = false): string {
  return short ? messageTime(at, now) : messageHeaderTime(at, now)
}

/** Epoch milliseconds of a Slack ts. */
export const tsMillis = (ts: string): number => Math.round(Number(ts) * 1000)
