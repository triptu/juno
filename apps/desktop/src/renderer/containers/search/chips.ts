/**
 * The Search field's rules for chips (SPEC 10a, "The query"): typed
 * operators become chips once finished, from: and in: through the picker,
 * the Date menu's presets, and what a chip turns back into when clicked to
 * edit it. One `SearchQuery` model underneath: a chip is the text of one
 * operator (`token`), which the parser reads with the typed words.
 */
import { parseSearchQuery, type SearchQuery } from '@juno/contract'
import type { SearchChip, SearchSession } from '@juno/state'

type SearchClause = SearchQuery['clauses'][number]

const monthDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const monthYear = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })

const dateOf = (value: string) => {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** "On Oct 20", "Before Oct 20", "Oct 2026". */
function dateLabel(clause: Extract<SearchClause, { kind: 'date' }>): string {
  const day = clause.value.length === 10 ? monthDay.format(dateOf(clause.value)) : undefined
  switch (clause.operator) {
    case 'on':
      return `On ${day ?? clause.value}`
    case 'before':
      return `Before ${day ?? clause.value}`
    case 'after':
      return `After ${day ?? clause.value}`
    default:
      return clause.value.length === 4 ? clause.value : clause.value.length === 7 ? monthYear.format(dateOf(`${clause.value}-01`)) : `On ${day ?? clause.value}`
  }
}

/** A finished operator as a chip; words, and from: and in: (which the picker makes), stay text. */
function chipOf(clause: SearchClause, raw: string, identities: boolean): SearchChip | undefined {
  const token = raw.slice(clause.span.start, clause.span.end)
  switch (clause.kind) {
    case 'date':
      return { op: 'date', token, label: dateLabel(clause) }
    case 'has':
      return { op: 'has', token, label: clause.value }
    case 'thread':
      return { op: 'is', token, label: 'thread' }
    case 'identity':
      return identities ? { op: clause.operator, token, label: clause.value } : undefined
    default:
      return undefined
  }
}

/**
 * Moves the operators finished in `text` (a space typed after them) into chips. `identities`: from: and
 * in: too, with their typed value as the label, for text that arrives whole (⌘K's handoff, a recent search).
 */
export function takeChips(text: string, caret: number, identities = false): { readonly text: string; readonly chips: ReadonlyArray<SearchChip>; readonly caret: number } {
  const query = parseSearchQuery(text)
  const chips: SearchChip[] = []
  let kept = ''
  let at = 0
  let moved = caret
  for (const clause of query.clauses) {
    const finished = clause.span.end < text.length || identities
    const chip = finished && clause.span.end !== caret ? chipOf(clause, text, identities) : undefined
    if (chip === undefined) continue
    chips.push(chip)
    // Drop the token and one space after it.
    const end = text[clause.span.end] === ' ' ? clause.span.end + 1 : clause.span.end
    kept += text.slice(at, clause.span.start)
    if (caret >= end) moved -= end - clause.span.start
    else if (caret > clause.span.start) moved = kept.length
    at = end
  }
  if (chips.length === 0) return { text, chips, caret }
  return { text: kept + text.slice(at), chips, caret: moved }
}

/** ⌘K's handoff (`openSearch`): its query's filters as chips and its words as text. */
export function sessionFromQuery(query: SearchQuery): Pick<SearchSession, 'text' | 'chips' | 'sort'> {
  const chips: SearchChip[] = []
  const words: string[] = []
  for (const clause of query.clauses) {
    const chip = chipOf(clause, query.raw, true)
    if (chip !== undefined) chips.push(chip)
    else words.push(query.raw.slice(clause.span.start, clause.span.end))
  }
  return { text: words.join(' '), chips, sort: query.scope.sort }
}

/** The operator being typed at the caret, for the picker: "from:ma" with the caret after it. */
export function operatorAt(text: string, caret: number): { readonly op: 'from' | 'in'; readonly negated: boolean; readonly at: number; readonly end: number; readonly query: string } | undefined {
  const match = /(^|\s)(-?)(from|in):(\S*)$/i.exec(text.slice(0, caret))
  if (match === null) return undefined
  const at = match.index + (match[1]?.length ?? 0)
  const after = /^\S*/.exec(text.slice(caret))?.[0].length ?? 0
  return { op: match[3]!.toLowerCase() as 'from' | 'in', negated: match[2] === '-', at, end: caret + after, query: (match[4] ?? '') + text.slice(caret, caret + after) }
}

/** What a chip turns back into when clicked: its operator and value as text, to change and finish again. */
export function chipText(chip: SearchChip): string {
  if (chip.op === 'from' || chip.op === 'in') return `${chip.token.startsWith('-') ? '-' : ''}${chip.op}:${chip.label.split(/\s+/)[0] ?? ''}`
  return chip.token
}

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const shift = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

export type DatePreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month'

export const datePresets: ReadonlyArray<{ readonly id: DatePreset; readonly label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
]

/** A Date preset as a chip, in days of this Mac's calendar. Weeks start on Monday. `after:` is the day before the range. */
export function dateChip(preset: DatePreset, now = new Date()): SearchChip {
  const today = shift(now, 0)
  const monday = shift(today, -((today.getDay() + 6) % 7))
  const label = datePresets.find((item) => item.id === preset)!.label
  switch (preset) {
    case 'today':
      return { op: 'date', token: `on:${iso(today)}`, label }
    case 'yesterday':
      return { op: 'date', token: `on:${iso(shift(today, -1))}`, label }
    case 'this-week':
      return { op: 'date', token: `after:${iso(shift(monday, -1))}`, label }
    case 'last-week':
      return { op: 'date', token: `after:${iso(shift(monday, -8))} before:${iso(monday)}`, label }
    case 'this-month':
      return { op: 'date', token: `during:${iso(today).slice(0, 7)}`, label }
  }
}

/** The ids a session's from: chips name, for the reader's matches. */
export const fromIds = (chips: ReadonlyArray<SearchChip>): ReadonlySet<string> =>
  new Set(chips.filter((chip) => chip.op === 'from' && !chip.token.startsWith('-') && chip.person !== undefined).map((chip) => chip.person!.id))
