import type { SearchHit, SearchSnapshot } from '@juno/contract'
import type { SearchQuery } from '@juno/domain'
import { decodeSearchHighlights, type SearchPageMatch } from '@juno/slack'
import { StoreReader } from '@juno/store'
import { Effect } from 'effect'
import { literalRanges, searchSnippet } from './merge'
import { messageResults, readPlaces, readUsers, topicOfMessage, type MessageHit } from './query'
import { personFrom } from '../topicRows'

export const localHits = (rows: ReadonlyArray<MessageHit>, query: SearchQuery) => messageResults(rows.map((row) => ({ ...row, topicId: topicOfMessage(row.channel, row.ts, row.thread_ts, row.reply_count), stored: true }))).pipe(Effect.map((rows) => rows.map((row) => ({ ...row, ...searchSnippet(row.text, literalRanges(row.text, query)) }))))
export const threadOf = (match: SearchPageMatch) => match.thread_ts ?? /[?&]thread_ts=(\d+\.\d+)/.exec(match.permalink ?? '')?.[1]

export const remoteHits = (matches: ReadonlyArray<SearchPageMatch>, query: SearchQuery) => Effect.gen(function* () {
  const sql = yield* StoreReader
  if (matches.length === 0) return []
  const stored = new Map((yield* sql<{ channel: string; ts: string; deleted: number }>`SELECT channel, ts, deleted FROM messages WHERE channel IN ${sql.in([...new Set(matches.map((m) => m.channel))])} AND ts IN ${sql.in(matches.map((m) => m.ts))}`).map((r) => [`${r.channel}:${r.ts}`, r]))
  const rows = yield* messageResults(matches.filter((m) => stored.get(`${m.channel}:${m.ts}`)?.deleted !== 1).map((match) => {
    const channel = match.channel
    const ts = threadOf(match)
    return { channel, ts: match.ts, thread_ts: ts ?? null, reply_count: match.reply_count ?? 0, user_id: match.user ?? null, username: match.username, bot_name: match.bot_profile?.name, text: match.extracts?.find((e) => e.text !== '')?.text ?? match.text ?? '', attachments_json: JSON.stringify(match.attachments), topicId: topicOfMessage(channel, match.ts, ts ?? null, match.reply_count ?? 0), stored: stored.has(`${channel}:${match.ts}`) }
  }))
  return rows.map((row): SearchHit => {
    const decoded = decodeSearchHighlights(row.text)
    return { ...row, ...searchSnippet(decoded.text, decoded.ranges.length > 0 ? decoded.ranges : literalRanges(decoded.text, query)) }
  })
})

/** Slack's facets with the person or place the store knows for each id, so the From and In menus can name them. */
export const namedFacets = (facets: { readonly from: ReadonlyArray<{ readonly id: string; readonly count: number }>; readonly in: ReadonlyArray<{ readonly id: string; readonly count: number }> }) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const users = yield* readUsers(sql, new Set(facets.from.map((f) => f.id)))
  const places = yield* readPlaces(sql, new Set(facets.in.map((f) => f.id)))
  return {
    from: facets.from.map((f) => (users.has(f.id) ? { ...f, person: personFrom(f.id, users.get(f.id)) } : f)),
    in: facets.in.map((f) => { const place = places.get(f.id); return place === undefined ? f : { ...f, place } }),
  } satisfies SearchSnapshot['facets']
})
