import { parseSearchQuery, type SearchQuery } from '@juno/domain'
import { StoreReader } from '@juno/store'
import { Effect } from 'effect'
import type { ResolvedSearch } from './searchCompiler'

export const resolveSearch = (input: SearchQuery | string) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const query = typeof input === 'string' ? parseSearchQuery(input) : input
  const [self] = yield* sql<{ id: string; tz: string | null }>`SELECT u.id, u.tz FROM team t JOIN users u ON u.id = t.self_user_id LIMIT 1`
  const timeZone = query.timeZone ?? self?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const identities = new Map<number, ReadonlyArray<{ id: string; slack: string }>>()
  const diagnostics = [...query.diagnostics]
  for (const clause of query.clauses) {
    if (clause.kind !== 'identity') continue
    const value = clause.value.replace(/^<[@#]([^|>]+)(?:\|[^>]*)?>$/, '$1').replace(/^[@#]/, '')
    const name = value.toLowerCase() === 'me' ? self?.id ?? value : value
    const rows = clause.operator === 'from'
      ? yield* sql<{ id: string; peer: string | null }>`SELECT id, NULL AS peer FROM users WHERE id = ${name} OR lower(name) = ${name.toLowerCase()} OR lower(real_name) = ${name.toLowerCase()} OR lower(display_name) = ${name.toLowerCase()}`
      : yield* sql<{ id: string; peer: string | null }>`SELECT id, CASE WHEN kind = 'im' THEN user_id END AS peer FROM conversations WHERE id = ${name} OR lower(name) = ${name.toLowerCase()} OR (kind = 'im' AND user_id = ${name})`
    if (rows.length === 1) identities.set(clause.span.start, rows.map((r) => ({ id: r.id, slack: clause.operator === 'from' || r.peer !== null ? `<@${r.peer ?? r.id}>` : `<#${r.id}>` })))
    else diagnostics.push({ code: 'unresolved', span: clause.span, message: rows.length === 0 ? `Unknown ${clause.operator === 'from' ? 'person' : 'conversation'}: ${clause.value}` : `Choose which ${clause.value} you mean.` })
  }
  let topicSlack: string | undefined
  if (query.scope.topic !== undefined) {
    const [topic] = yield* sql<{ id: string; kind: string; user_id: string | null }>`SELECT id, kind, user_id FROM conversations WHERE id = ${query.scope.topic.channel}`
    if (topic !== undefined) topicSlack = topic.kind === 'im' && topic.user_id !== null ? `<@${topic.user_id}>` : `<#${topic.id}>`
    else diagnostics.push({ code: 'unresolved', span: { start: 0, end: 0 }, message: 'Unknown conversation in topic scope.' })
  }
  return { query: { ...query, timeZone, diagnostics }, timeZone, identities, ...(topicSlack === undefined ? {} : { topicSlack }) } satisfies ResolvedSearch
})
