import { compileSearchSql, searchFts, type ResolvedSearch } from './searchCompiler'
import { resolveSearch } from './searchResolve'
import { SEARCH_LIMIT_MAX, SEARCH_PLACES_MAX, type SearchMessage, type SearchPlace, type SearchResult, type SearchTopic } from '@juno/contract'
import { FALLBACK_TITLE_WORDS, firstWords, mainLabel, mentionedUserIds, mentionedUsergroupIds, mainTopicId, threadTopicId, tsToMillis, type ChannelId, type ConversationKind, type Ts } from '@juno/domain'
import { messageBody, readableText, type Lookups, type MessageContent, type UsergroupName } from '@juno/richtext'
import { StoreReader, type SqlClient } from '@juno/store'
import { Effect } from 'effect'
import { channelInfoOf, channelRefOf, parseIds, personFrom, userName, type UserRow } from './topicRows'
import { literalRanges, searchSnippet } from './searchMerge'

const topicColumns = `i.topic_id AS id, i.channel, i.kind, i.last_activity_ts,
  COALESCE(NULLIF(trim(o.manual_title), ''), NULLIF(trim(o.ai_title), '')) AS named_title,
  COALESCE(json_extract(i.preview_json, '$.rootText'), '') AS title`

interface TopicHit {
  readonly id: string
  readonly channel: string
  readonly kind: string
  readonly last_activity_ts: string | null
  readonly named_title: string | null
  readonly title: string
}

export interface MessageHit {
  readonly attachments_json?: string | null
  readonly blocks_json?: string | null
  readonly bot_name?: string | null
  readonly channel: string
  readonly ts: string
  readonly thread_ts: string | null
  readonly reply_count: number
  readonly user_id: string | null
  readonly text: string
}

interface ConversationRow {
  readonly id: string
  readonly kind: ConversationKind
  readonly name: string | null
  readonly user_id: string | null
  readonly member_ids_json: string | null
}

/** The statements used by the query, also compiled by the benchmark profiler. */
export function searchStatements(sql: SqlClient.SqlClient, search: ResolvedSearch, limit: number) {
  const query = searchFts(search.query, true)
  const titleQuery = compileSearchSql(search, { titles: true, prefix: true })
  const messageQuery = compileSearchSql(search, { prefix: true })
  const topics = sql.unsafe<TopicHit>(`SELECT ${topicColumns} FROM ${titleQuery.source} WHERE ${titleQuery.where} ORDER BY ${titleQuery.order} LIMIT ?`, [...titleQuery.params, limit])
  const places = Math.min(limit, SEARCH_PLACES_MAX)
  const channels = sql<{ id: string; main: 0 | 1 }>`SELECT c.id, EXISTS (SELECT 1 FROM topic_index t WHERE t.topic_id = 'm:' || c.id) AS main
    FROM channels_fts f JOIN conversations c ON c.rowid = f.rowid LEFT JOIN ignored_channels g ON g.channel = c.id
    WHERE channels_fts MATCH ${query} AND c.is_member = 1 AND g.channel IS NULL ORDER BY f.rank, c.id LIMIT ${places}`
  // The full name first: search is for telling apart people who share a first name.
  const people = sql<UserRow & { readonly dm: string | null }>`SELECT u.id, u.name, COALESCE(NULLIF(u.real_name, ''), NULLIF(u.display_name, '')) AS display_name, u.real_name, u.avatar_url, u.avatar_small_url, u.avatar_large_url,
      (SELECT d.id FROM conversations d WHERE d.kind = 'im' AND d.user_id = u.id AND d.is_member = 1
        AND EXISTS (SELECT 1 FROM topic_index t WHERE t.topic_id = 'm:' || d.id) ORDER BY d.id LIMIT 1) AS dm
    FROM people_fts f JOIN users u ON u.rowid = f.rowid WHERE people_fts MATCH ${query} AND u.deleted = 0 ORDER BY f.rank, u.id LIMIT ${places}`
  const messages = sql.unsafe<MessageHit>(`SELECT m.channel, m.ts, m.thread_ts, m.reply_count, m.user_id, m.text, m.blocks_json, m.attachments_json, m.bot_name
    FROM ${messageQuery.source} WHERE ${messageQuery.where} ORDER BY ${query === '' ? messageQuery.order : 'f.rank, m.channel, m.ts'} LIMIT ?`, [...messageQuery.params, limit])
  return { topics, channels, people, messages }
}

/** The thread a stored message is in (a root with replies is its own thread's first message), or its channel's Main. */
export function topicOfMessage(channel: string, ts: string, threadTs: string | null, replyCount: number): string {
  const thread = threadTs ?? (replyCount > 0 ? ts : undefined)
  return thread === undefined ? mainTopicId(channel as ChannelId) : threadTopicId(channel as ChannelId, thread as Ts)
}

const millisOf = (ts: string | null): number => (ts === null ? 0 : tsToMillis(ts as Ts))

/** Reads the users a set of ids names. */
export const readUsers = (sql: SqlClient.SqlClient, ids: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const users = new Map<string, UserRow>()
    if (ids.size === 0) return users
    const rows = yield* sql<UserRow>`SELECT id, name, NULLIF(display_name, '') AS display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in([...ids])}`
    for (const row of rows) users.set(row.id, row)
    return users
  })

/** The places of a set of conversations, named as rows name them: "eng", "Maya Chen", "Maya, Leo". */
export const readPlaces = (sql: SqlClient.SqlClient, channels: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const places = new Map<string, SearchPlace>()
    if (channels.size === 0) return places
    const rows = yield* sql<ConversationRow>`SELECT id, kind, name, user_id, member_ids_json FROM conversations WHERE id IN ${sql.in([...channels])}`
    const self = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
    const members = new Map(rows.map((row) => [row.id, row.kind === 'mpim' ? parseIds(row.member_ids_json) : []]))
    const ids = new Set<string>()
    for (const row of rows) {
      if (row.user_id !== null) ids.add(row.user_id)
      for (const id of members.get(row.id) ?? []) ids.add(id)
    }
    const users = yield* readUsers(sql, ids)
    for (const row of rows) {
      const info = channelInfoOf(
        { channel: row.id, c_kind: row.kind, c_name: row.name, c_user_id: row.user_id },
        { members: members.get(row.id) ?? [] },
        self,
        (id) => userName(id, users.get(id)),
      )
      const { partnerId: _partnerId, ...place } = channelRefOf(info, undefined)
      places.set(row.id, place)
    }
    return places
  })

/** A conversation the store no longer names still gets a place, so a result never drops. */
function placeOf(places: ReadonlyMap<string, SearchPlace>, id: string): SearchPlace {
  const known = places.get(id)
  if (known !== undefined) return known
  const { partnerId: _partnerId, ...place } = channelRefOf({ id: id as ChannelId, kind: 'public', name: id }, undefined)
  return place
}

/** `lookups` names the people a fallback title mentions: "@Maya fix the…", never `<@U…>`. */
const topicTitle = (hit: Pick<TopicHit, 'kind' | 'named_title' | 'title'>, place: SearchPlace, lookups: Lookups = {}): string =>
  hit.kind === 'main'
    ? mainLabel({ id: place.id as ChannelId, kind: place.kind, name: place.name })
    : hit.named_title || firstWords(hit.title, FALLBACK_TITLE_WORDS, lookups) || place.label

/** Handles for the user groups `texts` mention. */
const readUsergroups = (sql: SqlClient.SqlClient, texts: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const ids = [...new Set(texts.flatMap((text) => mentionedUsergroupIds(text)))]
    const groups = new Map<string, UsergroupName>()
    if (ids.length === 0) return groups
    for (const row of yield* sql<{ id: string; handle: string; name: string | null }>`SELECT id, handle, name FROM usergroups WHERE id IN ${sql.in(ids)}`) {
      groups.set(row.id, { handle: row.handle, ...(row.name === null ? {} : { name: row.name }) })
    }
    return groups
  })

/** Names for the people and groups the fallback titles of `texts` mention. */
const titleLookups = (sql: SqlClient.SqlClient, texts: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const users = yield* readUsers(sql, new Set(texts.flatMap((text) => mentionedUserIds(text))))
    const groups = yield* readUsergroups(sql, texts)
    return { user: (id: string) => (users.has(id) ? userName(id, users.get(id)) : undefined), usergroup: (id: string) => groups.get(id) } satisfies Lookups
  })

/** One line, for a result's sub line. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Messages as results: each with its topic's title, its sender and its place. Shared with `search.slack`. */
export const messageResults = (
  hits: ReadonlyArray<MessageHit & { readonly topicId: string; readonly stored: boolean; readonly username?: string | undefined }>,
) =>
  Effect.gen(function* () {
    if (hits.length === 0) return []
    const sql = yield* StoreReader
    const topicIds = [...new Set(hits.map((hit) => hit.topicId))]
    const titles = new Map<string, Pick<TopicHit, 'kind' | 'named_title' | 'title'>>()
    for (const row of yield* sql<TopicHit>`SELECT i.topic_id AS id, i.kind,
        COALESCE(NULLIF(trim(o.manual_title), ''), NULLIF(trim(o.ai_title), '')) AS named_title,
        COALESCE(json_extract(i.preview_json, '$.rootText'), '') AS title
      FROM topic_index i LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id WHERE i.topic_id IN ${sql.in(topicIds)}`) titles.set(row.id, row)
    const places = yield* readPlaces(sql, new Set(hits.map((hit) => hit.channel)))
    const mentioned = (pattern: RegExp) => hits.flatMap((hit) => [...hit.text.matchAll(pattern)].map((match) => match[1] as string))
    const users = yield* readUsers(
      sql,
      new Set([
        ...hits.flatMap((hit) => (hit.user_id === null ? [] : [hit.user_id])),
        ...mentioned(/<@([A-Z0-9]+)/g),
        ...[...titles.values()].flatMap((known) => mentionedUserIds(known.title)),
      ]),
    )
    const channelIds = [...new Set(mentioned(/<#([A-Z0-9]+)/g))]
    const channelNames = new Map(
      channelIds.length === 0 ? [] : (yield* sql<{ id: string; name: string | null }>`SELECT id, name FROM conversations WHERE id IN ${sql.in(channelIds)}`).map((row) => [row.id, row.name ?? row.id]),
    )
    const groups = yield* readUsergroups(sql, [...hits.map((hit) => hit.text), ...[...titles.values()].map((known) => known.title)])
    const lookups = { user: (id: string) => (users.has(id) ? userName(id, users.get(id)) : undefined), channel: (id: string) => channelNames.get(id), usergroup: (id: string) => groups.get(id) }
    return hits.map((hit): SearchMessage => {
      const place = placeOf(places, hit.channel)
      const known = titles.get(hit.topicId)
      const main = hit.topicId.startsWith('m:')
      const title =
        known !== undefined
          ? topicTitle(known, place, lookups)
          : main
            ? mainLabel({ id: place.id as ChannelId, kind: place.kind, name: place.name })
            : firstWords(hit.text, FALLBACK_TITLE_WORDS, lookups) || place.label
      return {
        kind: 'message',
        id: `${hit.channel}:${hit.ts}`,
        topicId: hit.topicId,
        title,
        ts: hit.ts,
        place,
        ...(hit.user_id === null ? {} : { senderId: hit.user_id }),
        sender: hit.bot_name ?? (hit.user_id === null ? (hit.username ?? '') : userName(hit.user_id, users.get(hit.user_id))),
        text: oneLine(readableText(messageBody({ text: hit.text, attachments: hit.attachments_json ? JSON.parse(hit.attachments_json) as MessageContent['attachments'] : undefined, blocks: hit.blocks_json ? JSON.parse(hit.blocks_json) as MessageContent['blocks'] : undefined }, lookups))),
        stored: hit.stored,
      }
    })
  })

/**
 * Indexed local search. Channels and people (at most `SEARCH_PLACES_MAX`
 * each) come first, since a name typed is most often a place to go; then
 * topic titles and message matches. FTS ranks each group, and a group runs
 * only while the window has room. Without `withPlaces`, only topics and messages.
 */
export const querySearch = Effect.fn('search.query')(function* (text: string, requestedLimit = SEARCH_LIMIT_MAX, withPlaces = true) {
  const sql = yield* StoreReader
  const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, requestedLimit))
  const resolved = yield* resolveSearch(text)
  const terms = searchFts(resolved.query, true)
  if (text.trim() === '') {
    const recent = yield* titleHits(resolved, limit)
    const places = yield* readPlaces(sql, new Set(recent.map((hit) => hit.channel)))
    const names = yield* titleLookups(sql, recent.map((hit) => hit.title))
    return recent.map((hit) => topicResult(hit, placeOf(places, hit.channel), names))
  }
  // Only the last word is a prefix, matching an input still being typed.
  const navigation = withPlaces && resolved.query.clauses.every((c) => c.kind === 'term' || c.kind === 'phrase') && terms !== ''
  const statements = searchStatements(sql, resolved, limit)
  const channels = navigation ? yield* statements.channels : []
  const people = navigation ? yield* statements.people : []
  const room = limit - channels.length - people.length
  const topics = room > 0 ? yield* titleHits(resolved, room, true) : []
  const messages = room - topics.length > 0 ? yield* messageHits(resolved, room - topics.length, { prefix: true, ranked: true }) : []
  const places = yield* readPlaces(sql, new Set([...channels.map((hit) => hit.id), ...topics.map((hit) => hit.channel)]))
  const names = yield* titleLookups(sql, topics.map((hit) => hit.title))
  const results: SearchResult[] = [
    ...channels.map((hit): SearchResult => ({ kind: 'channel', id: hit.id, place: placeOf(places, hit.id), ...(hit.main === 1 ? { mainId: mainTopicId(hit.id as ChannelId) } : {}) })),
    ...people.map((hit): SearchResult => ({ kind: 'person', id: hit.id, person: personFrom(hit.id, hit), ...(hit.dm === null ? {} : { mainId: mainTopicId(hit.dm as ChannelId) }) })),
    ...topics.slice(0, room).map((hit) => {
      const topic = topicResult(hit, placeOf(places, hit.channel), names)
      return { ...topic, ranges: literalRanges(topic.title, resolved.query) }
    }),
  ]
  const left = limit - results.length
  if (left <= 0) return results
  const found = messages.slice(0, left).map((hit) => ({ ...hit, topicId: topicOfMessage(hit.channel, hit.ts, hit.thread_ts, hit.reply_count), stored: true }))
  const marked = (yield* messageResults(found)).map((row) => ({ ...row, ...searchSnippet(row.text, literalRanges(row.text, resolved.query)) }))
  return [...results, ...marked]
})

function topicResult(hit: TopicHit, place: SearchPlace, names: Lookups): SearchTopic {
  return { kind: 'topic', id: hit.id, title: topicTitle(hit, place, names), place, at: millisOf(hit.last_activity_ts) }
}

export const messageHits = (search: ResolvedSearch, limit: number, options: { prefix?: boolean; ranked?: boolean; offset?: number } = {}) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const fts = searchFts(search.query, options.prefix)
  const needed = limit + (options.offset ?? 0)
  // A small FTS set is cheap to sort. A larger one uses the date index and stops at the requested window.
  const candidates = !options.ranked && fts !== '' ? yield* sql<{ rowid: number }>`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${fts} LIMIT ${needed + 1}` : []
  const compiled = compileSearchSql(search, { ...options, chronological: candidates.length > needed })
  const order = options.ranked && fts !== '' ? 'f.rank, m.channel, m.ts' : compiled.order
  return yield* sql.unsafe<MessageHit>(`SELECT m.channel, m.ts, m.thread_ts, m.reply_count, m.user_id, m.text, m.blocks_json, m.attachments_json, m.bot_name
    FROM ${compiled.source} WHERE ${compiled.where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...compiled.params, limit, options.offset ?? 0])
})

const titleHits = (search: ResolvedSearch, limit: number, prefix = false, offset = 0) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const compiled = compileSearchSql(search, { titles: true, prefix })
  return yield* sql.unsafe<TopicHit>(`SELECT ${topicColumns} FROM ${compiled.source} WHERE ${compiled.where} ORDER BY ${compiled.order} LIMIT ? OFFSET ?`, [...compiled.params, limit, offset])
})
export const titleResults = (search: ResolvedSearch, limit: number, offset = 0) => Effect.gen(function* () {
  if (searchFts(search.query) === '') return []
  const sql = yield* StoreReader
  const hits = yield* titleHits(search, limit, false, offset)
  const places = yield* readPlaces(sql, new Set(hits.map((h) => h.channel)))
  const names = yield* titleLookups(sql, hits.map((h) => h.title))
  return hits.map((hit) => topicResult(hit, placeOf(places, hit.channel), names))
})
