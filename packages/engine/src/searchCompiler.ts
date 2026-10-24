import { quoteSearchText, searchDateBounds, type SearchQuery } from '@juno/domain'
import type { SearchPageArgs } from '@juno/slack'

export interface ResolvedSearch {
  readonly query: SearchQuery
  readonly timeZone: string
  readonly topicSlack?: string
  /** Clause start offset → resolved ids and Slack identity forms. Missing means unresolved. */
  readonly identities: ReadonlyMap<number, ReadonlyArray<{ readonly id: string; readonly slack: string }>>
}
export interface SearchSql {
  readonly source: string
  readonly where: string
  readonly params: ReadonlyArray<string | number>
  readonly order: string
  readonly needsSlack: boolean
}
const marks = (values: ReadonlyArray<unknown>) => values.map(() => '?').join(', ')
export const searchNeedsSlack = (query: SearchQuery): boolean => query.clauses.some((c) => c.kind === 'has' && c.value === 'pin')
export const searchHasErrors = (query: SearchQuery): boolean => query.diagnostics.some((d) => d.code !== 'incomplete') || query.clauses.some((c) => c.kind === 'unsupported')
export const searchFts = (query: SearchQuery, prefix = false): string => {
  const terms = query.clauses.filter((c) => (c.kind === 'term' || c.kind === 'phrase') && !c.negated)
  return terms.map((c, i) => 'value' in c ? `"${c.value.replace(/"/g, '""')}"${prefix && i === terms.length - 1 && c.kind === 'term' ? '*' : ''}` : '').join(' AND ')
}
export function includedChannels(search: ResolvedSearch): ReadonlyArray<string> {
  return search.query.clauses.flatMap((c) => c.kind === 'identity' && c.operator === 'in' && !c.negated ? (search.identities.get(c.span.start) ?? []).map((r) => r.id) : [])
}
export const automatedChannelsSql = "SELECT channel FROM sidebar_view_channels WHERE view_id = 'automated'"

/** All values are bound parameters; only the fixed column vocabulary enters SQL. */
export function compileSearchSql(search: ResolvedSearch, options: { prefix?: boolean; titles?: boolean } = {}): SearchSql {
  const { query, timeZone } = search
  const titles = options.titles === true
  const fts = searchFts(query, options.prefix)
  const params: Array<string | number> = []
  const where = [titles ? '1 = 1' : 'm.deleted = 0', 'c.is_member = 1', 'NOT EXISTS (SELECT 1 FROM ignored_channels g WHERE g.channel = c.id)']
  let source = titles ? 'topic_index i LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id' : 'messages m'
  if (fts !== '') {
    if (titles) {
      source = `(SELECT i.topic_id FROM topic_titles_fts f JOIN topic_index i ON i.rowid = f.rowid WHERE topic_titles_fts MATCH ?
        UNION SELECT o.topic_id FROM overlay_titles_fts f JOIN topic_overlay o ON o.rowid = f.rowid WHERE overlay_titles_fts MATCH ?) hits
        JOIN topic_index i ON i.topic_id = hits.topic_id LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id`
      params.push(fts, fts)
    } else {
      source = 'messages_fts f JOIN messages m ON m.rowid = f.rowid'
      where.push('messages_fts MATCH ?')
      params.push(fts)
    }
  }
  source += ` JOIN conversations c ON c.id = ${titles ? 'i' : 'm'}.channel`
  const channel = titles ? 'i.channel' : 'm.channel'
  const ts = titles ? 'i.last_activity_ts' : 'm.ts'
  const member = `p.deleted = 0 AND p.rowid IN (
    SELECT rowid FROM messages WHERE i.kind = 'thread' AND channel = i.channel AND ts = i.root_ts
    UNION ALL SELECT rowid FROM messages WHERE i.kind = 'thread' AND channel = i.channel AND thread_ts = i.root_ts
    UNION ALL SELECT rowid FROM messages WHERE i.kind = 'main' AND channel = i.channel AND (thread_ts IS NULL OR thread_ts = ts))`
  if (searchHasErrors(query) || searchNeedsSlack(query)) where.push('0 = 1')
  for (const operator of ['in', 'from'] as const) for (const negated of [false, true]) {
    const clauses = query.clauses.filter((c) => c.kind === 'identity' && c.operator === operator && c.negated === negated)
    if (clauses.length === 0) continue
    const refs = clauses.flatMap((c) => search.identities.get(c.span.start) ?? [])
    if (clauses.some((c) => (search.identities.get(c.span.start)?.length ?? 0) === 0)) { where.push('0 = 1'); continue }
    const ids = [...new Set(refs.map((r) => r.id))]
    if (titles && operator === 'from') where.push(`${negated ? 'NOT ' : ''}EXISTS (SELECT 1 FROM messages p WHERE ${member} AND p.user_id IN (${marks(ids)}))`)
    else {
      const predicate = `${operator === 'in' ? channel : 'm.user_id'} ${negated ? 'NOT IN' : 'IN'} (${marks(ids)})`
      where.push(negated && operator === 'from' ? `(${predicate} OR m.user_id IS NULL)` : predicate)
    }
    params.push(...ids)
  }
  if (query.scope.hideAutomated) {
    const explicit = [...includedChannels(search), ...(query.scope.topic === undefined ? [] : [query.scope.topic.channel])]
    where.push(`(${channel} NOT IN (${automatedChannelsSql})${explicit.length === 0 ? '' : ` OR ${channel} IN (${marks(explicit)})`})`)
    params.push(...explicit)
  }
  const human = "COALESCE(m.subtype, '') != 'bot_message' AND m.bot_name IS NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id AND u.is_bot = 1) AND COALESCE(m.user_id, '') NOT LIKE 'B%'"
  if (query.scope.hideApps) where.push(humanPredicate(titles, human))
  const filters = contentPredicates(query, timeZone, titles, ts, member)
  where.push(...filters.where)
  params.push(...filters.params)
  if (query.scope.topic !== undefined) {
    where.push(`${channel} = ?`); params.push(query.scope.topic.channel)
    if (query.scope.topic.threadTs !== undefined) {
      where.push(titles ? 'i.root_ts = ?' : '(m.ts = ? OR m.thread_ts = ?)')
      params.push(query.scope.topic.threadTs)
      if (!titles) params.push(query.scope.topic.threadTs)
    }
  }
  return { source, where: where.join(' AND '), params, order: `${ts} ${query.scope.sort === 'oldest' ? 'ASC' : 'DESC'}, ${channel}, ${titles ? 'i.topic_id' : 'm.ts'}`, needsSlack: searchNeedsSlack(query) }
}

/** Topic scope is enforced after arrival too: Slack has no verified thread predicate. */
export function compileSearchSlack(search: ResolvedSearch, page = 1): SearchPageArgs | undefined {
  if (searchHasErrors(search.query)) return undefined
  const scope = search.query.scope.topic
  if (scope !== undefined) {
    const include = includedChannels(search)
    if (include.length > 0 && !include.includes(scope.channel)) return undefined
    if (search.query.clauses.some((c) => c.kind === 'identity' && c.operator === 'in' && c.negated && search.identities.get(c.span.start)?.some((r) => r.id === scope.channel))) return undefined
  }
  const tokens: string[] = []
  for (const clause of search.query.clauses) {
    switch (clause.kind) {
      case 'term': case 'phrase': tokens.push(`${clause.negated ? '-' : ''}${quoteSearchText(clause.value)}`); break
      case 'identity': {
        if (scope !== undefined && clause.operator === 'in' && !clause.negated) break
        const refs = search.identities.get(clause.span.start)
        if (refs === undefined || refs.length !== 1) return undefined
        tokens.push(...refs.map((ref) => `${clause.negated ? '-' : ''}${clause.operator}:${ref.slack}`)); break
      }
      case 'date': tokens.push(`${clause.operator}:${clause.value}`); break
      case 'has': tokens.push(`has:${clause.value}`); break
      case 'thread': tokens.push('is:thread'); break
      case 'incomplete': break
      case 'unsupported': return undefined
    }
  }
  if (search.query.scope.topic !== undefined) tokens.push(`in:${search.topicSlack ?? `<#${search.query.scope.topic.channel}>`}`)
  return { module: 'messages', query: tokens.join(' '), query_rewrite_disabled: true, search_exclude_bots: search.query.scope.hideApps, highlight: 1, extracts: 1, extra_message_data: 1, no_user_profile: 1, sort: 'timestamp', sort_dir: search.query.scope.sort === 'oldest' ? 'asc' : 'desc', count: 50, page }
}

function humanPredicate(titles: boolean, human: string): string {
  if (!titles) return `(${human})`
  const person = human.replaceAll('m.', 'p.')
  return `((i.kind = 'thread' AND (
    EXISTS (SELECT 1 FROM messages p WHERE p.channel = i.channel AND p.ts = i.root_ts AND p.deleted = 0 AND ${person})
    OR EXISTS (SELECT 1 FROM messages p WHERE p.channel = i.channel AND p.thread_ts = i.root_ts AND p.deleted = 0 AND ${person})))
    OR (i.kind = 'main' AND EXISTS (SELECT 1 FROM messages p WHERE p.channel = i.channel AND p.deleted = 0 AND (p.thread_ts IS NULL OR p.thread_ts = p.ts) AND ${person})))`
}

function contentPredicates(query: SearchQuery, timeZone: string, titles: boolean, ts: string, member: string) {
  const where: string[] = []
  const params: Array<string | number> = []
  for (const clause of query.clauses) {
    if (clause.kind === 'date') {
      const bounds = searchDateBounds(clause, timeZone)
      if (bounds.from !== undefined) { where.push(`${ts} >= ?`); params.push(`${String(bounds.from).padStart(10, '0')}.000000`) }
      if (bounds.to !== undefined) { where.push(`${ts} < ?`); params.push(`${String(bounds.to).padStart(10, '0')}.000000`) }
    } else if ((clause.kind === 'term' || clause.kind === 'phrase') && clause.negated) {
      const term = `"${clause.value.replace(/"/g, '""')}"`
      if (titles) {
        where.push('i.rowid NOT IN (SELECT rowid FROM topic_titles_fts WHERE topic_titles_fts MATCH ?) AND COALESCE(o.rowid, -1) NOT IN (SELECT rowid FROM overlay_titles_fts WHERE overlay_titles_fts MATCH ?)')
        params.push(term, term)
      } else { where.push('m.rowid NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)'); params.push(term) }
    } else if (clause.kind === 'thread') where.push(titles ? "i.kind = 'thread'" : '(m.thread_ts IS NOT NULL OR m.reply_count > 0)')
    else if (clause.kind === 'has' && clause.value !== 'pin') {
      let predicate: string
      if (clause.value === 'file') predicate = "json_array_length(COALESCE(m.files_json, '[]')) > 0"
      else if (clause.value === 'link') predicate = "(m.text LIKE '%http://%' OR m.text LIKE '%https://%' OR EXISTS (SELECT 1 FROM json_tree(COALESCE(m.attachments_json, '[]')) a WHERE a.type = 'text' AND (a.value LIKE '%https://%' OR a.value LIKE '%http://%')))"
      else {
        predicate = 'EXISTS (SELECT 1 FROM reactions r WHERE r.channel = m.channel AND r.ts = m.ts AND r.count > 0'
        if (clause.value !== 'reaction') { predicate += ' AND r.name = ?'; params.push(clause.value.slice(1, -1)) }
        predicate += ')'
      }
      where.push(titles ? `EXISTS (SELECT 1 FROM messages p WHERE ${member} AND ${predicate.replaceAll('m.', 'p.')})` : predicate)
    }
  }
  return { where, params }
}
