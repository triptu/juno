import { Schema } from 'effect'

export const SearchSpan = Schema.Struct({ start: Schema.Int, end: Schema.Int })
const located = { span: SearchSpan }
export const SearchClause = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['term', 'phrase']), value: Schema.String, negated: Schema.Boolean, ...located }),
  Schema.Struct({ kind: Schema.Literal('identity'), operator: Schema.Literals(['from', 'in']), value: Schema.String, negated: Schema.Boolean, ...located }),
  Schema.Struct({ kind: Schema.Literal('date'), operator: Schema.Literals(['before', 'after', 'on', 'during']), value: Schema.String, ...located }),
  Schema.Struct({ kind: Schema.Literal('has'), value: Schema.String, ...located }),
  Schema.Struct({ kind: Schema.Literal('thread'), ...located }),
  Schema.Struct({ kind: Schema.Literals(['incomplete', 'unsupported']), text: Schema.String, ...located }),
])
export type SearchClause = typeof SearchClause.Type
export const SearchDiagnostic = Schema.Struct({ code: Schema.Literals(['incomplete', 'unsupported', 'invalid', 'unresolved']), message: Schema.String, span: SearchSpan })
export type SearchDiagnostic = typeof SearchDiagnostic.Type
export const SearchScope = Schema.Struct({
  hideApps: Schema.Boolean,
  hideAutomated: Schema.Boolean,
  sort: Schema.Literals(['newest', 'oldest']),
  /** The Search tab's Group by thread: a thread's matches share one group. Without it each match is its own row. */
  groupByThread: Schema.optionalKey(Schema.Boolean),
  topic: Schema.optionalKey(Schema.Struct({ channel: Schema.String, threadTs: Schema.optionalKey(Schema.String) })),
})
export const SearchQuery = Schema.Struct({
  version: Schema.Literal(1),
  raw: Schema.String,
  clauses: Schema.Array(SearchClause),
  diagnostics: Schema.Array(SearchDiagnostic),
  timeZone: Schema.optionalKey(Schema.String),
  scope: SearchScope,
}).check(Schema.makeFilter((query) => {
  if (query.clauses.some((clause) => clause.span.start < 0 || clause.span.end < clause.span.start || clause.span.end > query.raw.length)) return false
  if (query.clauses.some((clause) => clause.kind === 'date' && calendarParts(clause.value, clause.operator === 'during') === undefined)) return false
  try { if (query.timeZone !== undefined) Intl.DateTimeFormat('en', { timeZone: query.timeZone }) } catch { return false }
  return true
}))
export type SearchQuery = typeof SearchQuery.Type

/** UTF-16 spans address the original input, including tokens still being edited. */
export function parseSearchQuery(raw: string, options: { timeZone?: string; scope?: Partial<SearchQuery['scope']> } = {}): SearchQuery {
  const clauses: SearchClause[] = []
  const diagnostics: SearchDiagnostic[] = []
  const report = (text: string, span: typeof SearchSpan.Type, code: SearchDiagnostic['code'], message: string) => {
    clauses.push({ kind: code === 'incomplete' ? 'incomplete' : 'unsupported', text, span })
    diagnostics.push({ code, message, span })
  }
  for (let start = 0; start < raw.length;) {
    if (/\s/.test(raw[start] ?? '')) { start++; continue }
    let end = start
    let quoted = false
    let escaped = false
    while (end < raw.length) {
      const char = raw[end]
      if (!quoted && /\s/.test(char ?? '')) break
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = !quoted
      end++
    }
    const text = raw.slice(start, end)
    const span = { start, end }
    start = end
    if (quoted || escaped || text === '-') { report(text, span, 'incomplete', 'Finish this token.'); continue }
    const negated = text.startsWith('-')
    const token = negated ? text.slice(1) : text
    const modifier = /^([a-z]+):(.*)$/i.exec(token)
    const unquote = (value: string) => value.replace(/^"(.*)"$/, '$1').replace(/\\(["\\])/g, '$1')
    if (modifier !== null) {
      const operator = modifier[1]?.toLowerCase()
      const value = unquote(modifier[2] ?? '')
      if (value === '') { report(text, span, 'incomplete', 'Choose a filter value.'); continue }
      if (operator === 'from' || operator === 'in') clauses.push({ kind: 'identity', operator, value, negated, span })
      else if (!negated && (operator === 'before' || operator === 'after' || operator === 'on' || operator === 'during')) {
        if (calendarParts(value, operator === 'during') !== undefined) clauses.push({ kind: 'date', operator, value, span })
        else report(text, span, /^\d{0,4}(?:-\d{0,2}){0,2}$/.test(value) && value.length < 10 ? 'incomplete' : 'invalid', 'Use a calendar date (YYYY-MM-DD), or a month with during:.')
      } else if (!negated && operator === 'has' && (/^(link|file|reaction|pin)$/.test(value) || /^:[\w+-]+:$/.test(value))) clauses.push({ kind: 'has', value, span })
      else if (!negated && operator === 'is' && value === 'thread') clauses.push({ kind: 'thread', span })
      else report(text, span, 'unsupported', `Unsupported filter: ${text}`)
    } else if (token.includes('*')) report(text, span, 'unsupported', 'Wildcard search is not supported.')
    else clauses.push({ kind: token.startsWith('"') ? 'phrase' : 'term', value: unquote(token), negated, span })
  }
  return { version: 1, raw, clauses, diagnostics, ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }), scope: { hideApps: true, hideAutomated: true, sort: 'newest', ...options.scope } }
}

export const quoteSearchText = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
export function printSearchQuery(query: SearchQuery): string {
  return query.clauses.map((clause) => {
    switch (clause.kind) {
      case 'term': return `${clause.negated ? '-' : ''}${/[\s":]/.test(clause.value) ? quoteSearchText(clause.value) : clause.value}`
      case 'phrase': return `${clause.negated ? '-' : ''}${quoteSearchText(clause.value)}`
      case 'identity': return `${clause.negated ? '-' : ''}${clause.operator}:${/\s|"/.test(clause.value) ? quoteSearchText(clause.value) : clause.value}`
      case 'date': return `${clause.operator}:${clause.value}`
      case 'has': return `has:${clause.value}`
      case 'thread': return 'is:thread'
      case 'incomplete': case 'unsupported': return clause.text
    }
  }).join(' ')
}

function calendarParts(value: string, period: boolean): { year: number; month: number; day: number; precision: number } | undefined {
  if (!(period ? /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return undefined
  const parts = value.split('-').map(Number)
  const year = parts[0] ?? 0, month = parts[1] ?? 1, day = parts[2] ?? 1
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return { year, month, day, precision: parts.length }
}

/** Calendar midnight in an IANA zone; each boundary is converted separately across DST. */
function midnight(year: number, month: number, day: number, timeZone: string): number {
  const target = Date.UTC(year, month - 1, day)
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  let instant = target
  for (let i = 0; i < 4; i++) {
    const fields = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]))
    const observed = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second))
    const next = instant + target - observed
    if (next === instant) break
    instant = next
  }
  return instant / 1000
}

export function searchDateBounds(clause: Extract<SearchClause, { kind: 'date' }>, timeZone: string): { from?: number; to?: number } {
  const parts = calendarParts(clause.value, clause.operator === 'during')
  if (parts === undefined) return {}
  const { year, month, day, precision } = parts
  const from = midnight(year, month, day, timeZone)
  const to = midnight(year + (precision === 1 ? 1 : 0), month + (precision === 2 ? 1 : 0), day + (precision === 3 ? 1 : 0), timeZone)
  return clause.operator === 'before' ? { to: from } : clause.operator === 'after' ? { from: to } : { from, to }
}
