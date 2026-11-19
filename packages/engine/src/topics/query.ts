/**
 * The sidebar query (architecture 4.4, 4.5, performance 6): four indexed
 * lookups on `topic_index`; then the pure rules in `@juno/domain` decide
 * placement, status, title and tags, and the rows are shaped as `TopicRow`.
 *
 * The lookups, each a `SEARCH` (the plan test checks), joined to the
 * overlay, the conversation, the ignored list and Slack's follow flag; the
 * root's text for the fallback title is in the index row itself:
 * 1. the activity window: `last_activity_ts >= cutoff`, newest first, at
 *    most the window size (`topic_index_activity`, or the channel index when
 *    scoped);
 * 2. pinned rows, whatever their age (`topic_overlay_pinned`);
 * 3. rows older than the cutoff that are still unread (`topic_index_unread`);
 * 4. Main rows whose own messages are older than the cutoff but whose
 *    channel has a topic with activity inside it (one probe per member
 *    conversation on `topic_index_channel_activity`, then the Main row by
 *    primary key).
 *
 * Threads are filtered in SQL before the LIMIT by the rule of spec section 5
 * ("What shows up"): followed in Slack (`thread_subs.subscribed`) or with an
 * unread mention of the user; `sidebarPlacement` applies the same rule again
 * on the shaped topic, so the pure rule stays the one that decides. Main
 * rows outside the window carry `channel_activity_ts`, the latest activity
 * anywhere in the channel, so the quiet rule counts thread replies.
 *
 * `rev` is a hash of every input the shaped row depends on (the index row's
 * own rev, the overlay, the conversation, the people on the row, the
 * placement), so a change in any joined table is a new rev and reaches the
 * renderer as a delta; an unchanged row keeps its identity there.
 *
 * Rows name their channel and people by id; the run also returns the
 * channels and people the window names (`ListRun.refs`), and the serve
 * helper sends each one only when the subscription has not seen it or it
 * changed. So a person's new photo is one `refs` entry: the rows that show
 * the person keep their `rev`.
 *
 * A `RowCache` carries the work of the last run for one subscription: a
 * topic whose joined columns and people did not change is not parsed or
 * built again, and its row object is reused, so a run where one row changed
 * shapes one row. The SQL still runs in full every time.
 */
import {
  channelLabel,
  hashId,
  isDm,
  isFollowed,
  isResolved,
  quietDaysOf,
  resolveTitle,
  rowTags,
  sidebarPlacement,
  topicStatus,
  tsToMillis,
  byLatestActivity,
  type ResolvedTitle,
  type Topic,
  type TopicStatus,
} from '@juno/domain'
import type { ChannelRef, Person, TopicArt, TopicCounts, TopicListRow } from '@juno/contract'
import type { UsergroupName } from '@juno/richtext'
import { StoreReader, syncState, type SqlError } from '@juno/store'
import { BOOT_KEY, QUICK_START_KEY } from '@juno/sync'
import { Effect } from 'effect'
import type { ListRun } from '../protocol/live'
import { countsStatement, IN_ALL, OPEN_RULE, THREAD_RULE } from '../sidebarUnread'
import {
  artRefOf,
  channelInfoOf,
  channelRefOf,
  parseColumns,
  personFrom,
  rowPreviewSender,
  SHOWN_PARTICIPANTS,
  tileMemberIds,
  topicFrom,
  TOPIC_COLUMNS,
  TOPIC_FROM,
  userIdsOf,
  type JoinedRow,
  type ParsedColumns,
  type UserRow,
} from '../topicRows'

/**
 * What one subscription remembers between runs. A run reads every row
 * again, but rebuilds only what changed:
 * - `entries`, by topic id: the joined row a topic was built from, its
 *   parsed JSON columns, the domain topic, the people it names, and the
 *   shaped row with the section and status it was shaped for. A row whose
 *   columns and people are the same keeps its topic; one whose section and
 *   status are also the same keeps its row object.
 * - `people`, by user id: the person objects of the last run, reused while
 *   the name and photo hold, so "same people" is an identity check.
 * - `users`: the `users` rows read so far (`null` for an id with no row),
 *   only when the cache was made with `keepUsers`. The owner must then call
 *   `forgetUsers` whenever the `users` table changes; the handler does it
 *   from a synchronous invalidation handler, so the forget always lands
 *   before the run that the same change triggers.
 * - `usergroups`: every user group, read once a fallback title mentions
 *   one. `forgetUsergroups` drops it and the entries when the table changes.
 * Make one per subscription and workspace with `makeRowCache()`. A run
 * replaces `entries` with one window. People and users are retained while
 * their source map is unchanged, up to the people the windows have named.
 */
export interface RowCache {
  entries: ReadonlyMap<string, CacheEntry>
  people: Map<string, Person>
  selfId: string | undefined
  readonly keepUsers: boolean
  users: Map<string, UserRow | null> | undefined
  /** The users map the last run read people from, to tell whether any person can have changed since. */
  usersRead: Map<string, UserRow | null> | undefined
  /** User groups by id, once a title needed one. */
  usergroups: ReadonlyMap<string, UsergroupName> | undefined
}

export interface CacheEntry {
  readonly source: ListRow
  readonly parsed: ParsedColumns
  readonly topic: Topic
  /** Every person the topic and row read, in any role. */
  readonly people: ReadonlyArray<Person>
  readonly channel: ChannelRef
  /** The people the row names: the participants and the DM partner. */
  readonly named: ReadonlyArray<Person>
  readonly participantIds: ReadonlyArray<string>
  /** The row's people beyond `participantIds`, for the stack's "+N". */
  readonly moreParticipants: number
  /** The preview's sender as the row shows it. */
  readonly sender: string
  /** The title, with the people a fallback title mentions named. */
  readonly title: ResolvedTitle
  readonly shaped?: { readonly section: TopicListRow['section']; readonly status: TopicStatus; readonly row: TopicListRow }
}

export const makeRowCache = (options?: { readonly keepUsers?: boolean }): RowCache => ({
  entries: new Map(),
  people: new Map(),
  selfId: undefined,
  keepUsers: options?.keepUsers === true,
  users: undefined,
  usersRead: undefined,
  usergroups: undefined,
})

/** Drops the users a `keepUsers` cache has read, so the next run reads them again. */
export function forgetUsers(cache: RowCache): void {
  cache.users = undefined
}

/** Drops the user groups and every built topic, so titles that name a group are built again. Groups change rarely. */
export function forgetUsergroups(cache: RowCache): void {
  cache.usergroups = undefined
  cache.entries = new Map()
}

export interface ListFilter {
  readonly kind: 'all' | 'channels' | 'dms'
  readonly unreadOnly: boolean
  readonly scope?: string | undefined
  /** A sidebar view's id (spec section 5, "Views"). `kind` is ignored; `scope` wins over it. */
  readonly view?: string | undefined
}

export interface QueryOptions {
  /** Wall-clock millis. */
  readonly now: number
  /** The window size; capped by the handler. */
  readonly limit: number
}

const DAY = 24 * 60 * 60 * 1000

/** The quiet window from prefs (clamped by the domain rule), the AI assist switch and the signed-in user. */
export const settings = Effect.gen(function* () {
  const sql = yield* StoreReader
  const prefs = yield* sql<{ key: string; value_json: string }>`SELECT key, value_json FROM prefs WHERE key IN ('quietDays', 'aiAssist')`
  const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
  const raw = (key: string): unknown => {
    const row = prefs.find((entry) => entry.key === key)
    return row === undefined ? undefined : (JSON.parse(row.value_json) as unknown)
  }
  const quietDays = raw('quietDays')
  return { quietDays: typeof quietDays === 'number' ? quietDays : undefined, aiAssist: raw('aiAssist') !== false, selfId: team[0]?.self_user_id ?? undefined }
})

/**
 * The latest activity anywhere in a Main row's channel (one probe on
 * `topic_index_channel_activity`), which only the quiet rule reads. Rows
 * inside the activity window are never quiet, so the window skips the probe.
 */
/**
 * Main rows: the threads started in the channel since Main's read pointer.
 * A thread started after the pointer has its root, and so its latest
 * activity, after it too, so the probe is a range on
 * `topic_index_channel_activity`. No pointer counts nothing. Threads you
 * started do not count: from Juno (`started_threads`, also before Slack
 * has the root) or from another client (the root's sender, one primary
 * key lookup per thread in the range).
 */
const NEW_THREADS = `CASE WHEN i.kind = 'main' THEN (SELECT count(*) FROM topic_index t
      WHERE t.channel = i.channel AND t.last_activity_ts > r.last_read_ts AND t.kind = 'thread' AND t.root_ts > r.last_read_ts
        AND NOT EXISTS (SELECT 1 FROM started_threads st WHERE st.topic_id = t.topic_id OR (st.channel = t.channel AND st.root_ts = t.root_ts))
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.channel = t.channel AND m.ts = t.root_ts AND m.user_id = (SELECT self_user_id FROM team LIMIT 1))) ELSE 0 END AS new_threads`

export const SELECT = `${TOPIC_COLUMNS}, ${NEW_THREADS},
    CASE WHEN i.kind = 'main' THEN (SELECT max(t.last_activity_ts) FROM topic_index t WHERE t.channel = i.channel) END AS channel_activity_ts`
const SELECT_IN_WINDOW = `${TOPIC_COLUMNS}, ${NEW_THREADS}, NULL AS channel_activity_ts`

export const FROM = `${TOPIC_FROM}
  LEFT JOIN topic_reads r ON r.topic_id = i.topic_id`

/** A sidebar row: the joined topic and its new-threads count. */
export interface ListRow extends JoinedRow {
  readonly new_threads: number
}

export const kindClause = (kind: ListFilter['kind']): string =>
  kind === 'channels' ? ` AND c.kind IN ('public', 'private')` : kind === 'dms' ? ` AND c.kind IN ('im', 'mpim')` : ''

/**
 * The topic's conversation is in a view that keeps it out of All (spec
 * section 5, "Views"): a probe on the views' channel index, then the view by
 * key. Or the first sync holds it until Automated's rules have read it
 * (`automated_holds`, a probe by key). Correlated, so it never changes how
 * SQLite walks `topic_index`.
 */
const KEPT_OUT = ` AND ${IN_ALL}`

/**
 * Which conversations the filter shows, after membership and the ignored
 * list: the scope's one channel; else a view's conversations; else the kind,
 * without the conversations a view keeps out of All. A view's list drives
 * the walk only where `drive` says so (the activity window, per channel on
 * `topic_index_channel_activity`); elsewhere it is `+i.channel`, a filter,
 * so the pinned and older-unread statements keep their own indexes instead
 * of reading every topic of every channel in the view.
 */
function placeClause(filter: ListFilter, drive: boolean): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  if (filter.scope !== undefined) return { sql: `${kindClause(filter.kind)} AND i.channel = ?`, params: [filter.scope] }
  if (filter.view !== undefined) return { sql: ` AND ${drive ? '' : '+'}i.channel IN (SELECT channel FROM sidebar_view_channels WHERE view_id = ?)`, params: [filter.view] }
  return { sql: `${kindClause(filter.kind)}${KEPT_OUT}`, params: [] }
}

/**
 * The four statements, as SQL text with positional parameters, so the plan
 * test can run them too. In order: the activity window, the pinned rows,
 * then rows older than the window (unread, and Main kept alive by threads).
 * Older rows sort after every row inside the window, so `listTopics` runs
 * the last two only when the window alone leaves room.
 */
export function listStatements(filter: ListFilter, cutoff: string, limit: number): ReadonlyArray<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }> {
  // Unread only is `+i.unread_count`: a filter, never a reason to walk `topic_index_unread` instead of each statement's own index.
  const common = (drive: boolean) => {
    const place = placeClause(filter, drive)
    return { sql: ` AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL${place.sql}${filter.unreadOnly ? ' AND +i.unread_count > 0' : ''}`, params: place.params }
  }
  const window = common(true)
  const rest = common(false)
  const scopeParams = filter.scope === undefined ? [] : [filter.scope]
  return [
    {
      sql: `${SELECT_IN_WINDOW}${FROM} WHERE i.last_activity_ts >= ?${window.sql}${THREAD_RULE}${OPEN_RULE} ORDER BY i.last_activity_ts DESC LIMIT ?`,
      params: [cutoff, ...window.params, limit],
    },
    {
      sql: `${SELECT}${FROM} WHERE o.pinned_at IS NOT NULL${rest.sql}`,
      params: rest.params,
    },
    {
      sql: `${SELECT}${FROM} WHERE i.unread_count > 0 AND i.last_activity_ts < ?${rest.sql}${THREAD_RULE} ORDER BY i.last_activity_ts DESC LIMIT ?`,
      params: [cutoff, ...rest.params, limit],
    },
    {
      // Main rows kept alive by replies in the channel's threads: one indexed probe per member conversation for a topic
      // inside the window (the channel index is newest first, so the probe reads one row), then each Main by key.
      sql: `${SELECT}${FROM} WHERE i.topic_id IN (
          SELECT 'm:' || cv.id FROM conversations cv
          WHERE cv.is_member = 1${filter.scope === undefined ? '' : ' AND cv.id = ?'}
            AND EXISTS (SELECT 1 FROM topic_index t WHERE t.channel = cv.id AND t.last_activity_ts >= ?))
        AND i.last_activity_ts < ?${rest.sql} LIMIT ?`,
      params: [...scopeParams, cutoff, cutoff, ...rest.params, limit],
    },
  ]
}

/** Every view's conversations, in pill order, with the view's Keep these out of All. */
export const VIEW_MEMBERS = `SELECT v.id AS view_id, v.keep_out_of_all AS keep_out, vc.channel AS channel
  FROM sidebar_views v JOIN sidebar_view_channels vc ON vc.view_id = v.id ORDER BY v.position, v.id`

/**
 * The sidebar window as `TopicListRow`s, pinned first, then recent, both
 * newest first, with the channels and people the rows name. Pass the
 * subscription's `RowCache` to reuse unchanged rows between runs; without
 * one every run shapes every row.
 */
export const listTopics = (filter: ListFilter, options: QueryOptions, cache: RowCache = makeRowCache()): Effect.Effect<ListRun<TopicListRow>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const { quietDays, aiAssist, selfId } = yield* settings
    const ctx = { now: options.now, ...(quietDays === undefined ? {} : { quietDays }) }
    const cutoff = cutoffTs(options.now, quietDaysOf(ctx))

    const byId = new Map<string, ListRow>()
    const run = (statement: ReturnType<typeof listStatements>[number]) =>
      Effect.map(sql.unsafe<ListRow>(statement.sql, statement.params), (rows) => {
        for (const row of rows) byId.set(row.topic_id, row)
        return rows
      })
    const [window, pinnedRows, ...older] = listStatements(filter, cutoff, options.limit)
    const inWindow = yield* run(window!)
    yield* run(pinnedRows!)
    // A pinned row in the window sits in Pinned, not Recent. The rest fill Recent; the older statements only matter when they leave room.
    if (inWindow.filter((row) => row.pinned_at === null).length < options.limit) for (const statement of older) yield* run(statement)

    const shaper = yield* shapeRows(byId.values(), { selfId, aiAssist }, cache)
    // Let the pure rules place every topic.
    const pinned: Array<CacheEntry> = []
    const recent: Array<CacheEntry> = []
    for (const entry of shaper.entries) {
      const placement = sidebarPlacement(entry.topic, ctx)
      if (placement === 'pinned') pinned.push(entry)
      else if (placement === 'recent') recent.push(entry)
    }
    pinned.sort((a, b) => byLatestActivity(a.topic, b.topic))
    recent.sort((a, b) => byLatestActivity(a.topic, b.topic))

    for (const entry of pinned) shaper.place(entry, 'pinned', topicStatus(entry.topic, ctx))
    for (const entry of recent.slice(0, Math.max(0, options.limit - pinned.length))) shaper.place(entry, 'recent', 'open')
    return { ...shaper.finish(), windowCovered: yield* rowsCovered, quietDays: quietDaysOf(ctx) }
  })

/**
 * Whether the list's rows are the user's own: the cold boot's quick start
 * (membership, the people of the DMs, the first followed threads) or a
 * whole boot has finished. The renderer holds an empty cache's list until
 * then; afterwards rows fill in as the sync stores them.
 */
export const rowsCovered: Effect.Effect<boolean, SqlError, StoreReader> = Effect.gen(function* () {
  if ((yield* syncState.get(QUICK_START_KEY)) !== undefined) return true
  return (yield* syncState.get(BOOT_KEY)) !== undefined
})

/** The quiet window's start as a ts, to the millisecond, so `ts < cutoff` is exactly the domain's quiet rule. */
export function cutoffTs(now: number, quietDays: number): string {
  const millis = now - quietDays * DAY
  return `${Math.floor(millis / 1000)}.${String(millis % 1000).padStart(3, '0')}000`
}

/** Builds the rows of one run, in the order `place` is called. */
export interface Shaper {
  /** The topic of every joined row with activity, in the order given. */
  readonly entries: ReadonlyArray<CacheEntry>
  /** Adds the entry's row to the run, shaped for this section and status. */
  readonly place: (entry: CacheEntry, section: TopicListRow['section'], status: TopicStatus) => void
  /** The run, with the channels, people and art its rows name. Commits the cache, so call it last. */
  readonly finish: (total?: number) => ListRun<TopicListRow>
}

/**
 * Turns joined index rows into domain topics, reusing the cache's topics
 * and people where nothing changed and reading the users no earlier run
 * has read. The sidebar and All topics share it; each decides which rows to
 * place and with what section and status.
 */
export const shapeRows = (
  source: Iterable<ListRow>,
  options: { readonly selfId: string | undefined; readonly aiAssist: boolean },
  cache: RowCache,
): Effect.Effect<Shaper, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const { selfId, aiAssist } = options
    // A different signed-in user changes every group DM name; start over.
    if (cache.selfId !== selfId) {
      cache.selfId = selfId
      cache.entries = new Map()
      cache.people = new Map()
    }
    const previous = cache.entries
    const joined = [...source]

    // Names and photos: participants, DM partners, group DM members and senders, in one lookup.
    const usersUnchanged = cache.keepUsers && cache.users !== undefined && cache.users === cache.usersRead
    const userIds = new Set<string>()
    const parsed: Array<ParsedColumns> = []
    for (const row of joined) {
      const hit = previous.get(row.topic_id)
      const columns =
        hit !== undefined && hit.source.participants_json === row.participants_json && hit.source.preview_json === row.preview_json && hit.source.c_members === row.c_members
          ? hit.parsed
          : parseColumns(row)
      parsed.push(columns)
      if (!usersUnchanged || columns !== hit?.parsed || row.c_user_id !== hit.source.c_user_id) userIdsOf(row, columns, userIds)
    }
    // Only the ids no earlier run has read, when the cache keeps users; every id otherwise.
    const users: Map<string, UserRow | null> = cache.keepUsers ? (cache.users ??= new Map()) : new Map()
    const missing: Array<string> = []
    for (const id of userIds) if (!users.has(id)) missing.push(id)
    if (missing.length > 0) {
      const found = yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url, is_bot FROM users WHERE id IN ${sql.in(missing)}`
      for (const id of missing) users.set(id, null)
      for (const user of found) users.set(user.id, user)
    }
    // A person keeps its object from the last run while its name and photo hold, so a row can tell "same people" by identity.
    // When no user was read or forgotten since the last run, every known person holds as it is.
    const peopleHold = cache.keepUsers && missing.length === 0 && users === cache.usersRead
    const knownPeople = cache.people
    const people = peopleHold ? cache.people : new Map<string, Person>()
    const personOf = (id: string): Person => {
      let person = people.get(id)
      if (person === undefined) {
        person = personFrom(id, users.get(id), knownPeople.get(id))
        people.set(id, person)
      }
      return person
    }

    // A fallback title can mention a user group ("<!subteam^S…>" in the root's text): read the groups once.
    if (cache.usergroups === undefined && joined.some((row) => row.preview_json?.includes('<!subteam^') === true)) {
      const groups = new Map<string, UsergroupName>()
      for (const group of yield* sql<{ id: string; handle: string; name: string | null }>`SELECT id, handle, name FROM usergroups`) {
        groups.set(group.id, { handle: group.handle, ...(group.name === null ? {} : { name: group.name }) })
      }
      cache.usergroups = groups
    }
    const usergroups = cache.usergroups

    // Build or reuse the domain topic of every row.
    const next = new Map<string, CacheEntry>()
    const entries: Array<CacheEntry> = []
    for (let index = 0; index < joined.length; index++) {
      const row = joined[index]!
      if (row.last_activity_ts === null) continue
      const hit = previous.get(row.topic_id)
      const columns = parsed[index]!
      const entry: CacheEntry =
        hit !== undefined && sameSource(hit.source, row) && (peopleHold || samePeople(hit.people, personOf))
          ? hit
          : { ...entryOf(row, columns, selfId, personOf, users, usergroups), source: row, parsed: columns }
      next.set(row.topic_id, entry)
      entries.push(entry)
    }

    const rows: Array<TopicListRow> = []
    const channels = new Map<string, ChannelRef>()
    const named = new Map<string, Person>()
    const art: Array<TopicArt> = []
    const place = (entry: CacheEntry, section: TopicListRow['section'], status: TopicStatus) => {
      const shaped = entry.shaped !== undefined && entry.shaped.section === section && entry.shaped.status === status ? entry.shaped : { section, status, row: shape(entry, section, status) }
      if (shaped !== entry.shaped) next.set(entry.topic.id, { ...entry, shaped })
      rows.push(shaped.row)
      channels.set(entry.channel.id, entry.channel)
      for (const person of entry.named) named.set(person.id, person)
      // The drawing is a ref, not part of the row: its arrival changes no `rev`.
      const drawing = artRefOf(entry.source, aiAssist)
      if (drawing !== undefined) art.push(drawing)
    }
    const finish = (total?: number): ListRun<TopicListRow> => {
      // Committed together, at the end, so a run that fails halfway leaves the last good state.
      cache.entries = next
      cache.people = people
      cache.usersRead = users
      return { rows, total: total ?? rows.length, refs: { channels: [...channels.values()], people: [...named.values()], art } }
    }
    return { entries, place, finish }
  })

/** Every column of the joined row equal: the topic built from it still holds. */
function sameSource(a: ListRow, b: ListRow): boolean {
  if (a.rev !== b.rev) return false
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  for (const key in right) if (left[key] !== right[key]) return false
  return true
}

/** Every person the entry was built from is the same object this run: no name or photo changed. */
function samePeople(people: ReadonlyArray<Person>, personOf: (id: string) => Person): boolean {
  for (const person of people) if (personOf(person.id) !== person) return false
  return true
}

/** The domain topic for an index row, the channel and people the row names, and the people it was built from. */
function entryOf(
  row: JoinedRow,
  columns: ParsedColumns,
  selfId: string | undefined,
  personOf: (id: string) => Person,
  users: ReadonlyMap<string, UserRow | null>,
  usergroups: ReadonlyMap<string, UsergroupName> | undefined,
): Pick<CacheEntry, 'topic' | 'people' | 'channel' | 'named' | 'participantIds' | 'moreParticipants' | 'sender' | 'title'> {
  const { participants } = columns
  const used: Array<Person> = []
  const use = (id: string): Person => {
    const person = personOf(id)
    used.push(person)
    return person
  }
  const info = channelInfoOf(row, columns, selfId, (id) => use(id).name)
  const partner = row.c_kind === 'im' && row.c_user_id !== null ? use(row.c_user_id) : undefined
  const members = tileMemberIds(columns, selfId).map(use)
  // The meta line's people (SPEC section 5): the senders of the unread messages, never you, and none in a DM,
  // whose title already names everyone. The stack draws four; the rest are a count.
  const people = row.c_kind === 'im' || row.c_kind === 'mpim' ? [] : participants.filter((id) => id !== selfId)
  const shown = people.slice(0, SHOWN_PARTICIPANTS)
  const named = shown.map(use)
  if (partner !== undefined) named.push(partner)
  named.push(...members)
  const sender = rowPreviewSender(row, columns, selfId, users, (id) => use(id).name)
  const topic = topicFrom(row, columns, info)
  return {
    topic,
    title: resolveTitle(topic, { user: (id) => use(id).name, usergroup: (id) => usergroups?.get(id) }),
    people: used,
    channel: channelRefOf(info, partner?.id, members.map((member) => member.id)),
    named,
    participantIds: shown,
    moreParticipants: people.length - shown.length,
    sender,
  }
}

/**
 * The row for a topic in a section. `rev` hashes every input the row itself
 * shows, so equal inputs give an equal rev on any run and in any
 * subscription. The channel and people are refs and not part of it.
 */
function shape(entry: CacheEntry, section: TopicListRow['section'], status: TopicStatus): TopicListRow {
  const { topic, source: row, sender, title } = entry
  const stored = entry.parsed.preview
  const label = channelLabel(topic.channel)
  // Everything the row is built from, in one short string; the row's rev is its hash.
  const key = [
    row.rev,
    row.manual_title,
    row.ai_title,
    row.resolved_at,
    row.resolved_activity_ts,
    row.reopened_at,
    row.pinned_at,
    row.subscribed,
    row.new_threads,
    row.c_name,
    row.c_kind,
    topic.channel.name,
    label,
    section,
    status,
    sender,
    title.text,
    title.source,
    title.sensitive,
    entry.moreParticipants,
    ...entry.participantIds,
  ].join('\u0001')

  return {
    id: topic.id,
    rev: hashId(key),
    kind: topic.kind,
    section,
    status: status === 'ignored' ? 'open' : status,
    title: title.text,
    titleSource: title.source,
    ...(title.sensitive ? { titleSensitive: true } : {}),
    preview: { sender, text: stored.text },
    channelId: topic.channel.id,
    participantIds: entry.participantIds,
    ...(entry.moreParticipants === 0 ? {} : { moreParticipants: entry.moreParticipants }),
    messageCount: topic.activity.messageCount,
    unreadCount: topic.activity.unreadCount,
    unreadExact: topic.activity.unreadExact !== false,
    mentionsMe: topic.activity.mentionsMe,
    tags: rowTags(topic),
    pinned: topic.overlay.pinnedAt !== undefined,
    resolved: isResolved(topic),
    subscribed: isFollowed(topic),
    newThreads: row.new_threads,
    lastActivityTs: topic.activity.lastActivityTs,
    lastActivityAt: tsToMillis(topic.activity.lastActivityTs),
  }
}

/**
 * Unread topics per group for the Channels and DMs dots, without the
 * conversations a view keeps out of All or the first sync holds (unless
 * scoped to one), and the
 * views with an unread mention, in pill order.
 */
export const countTopics = (scope: string | undefined): Effect.Effect<TopicCounts, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statement = countsStatement(scope)
    const rows = yield* sql.unsafe<{ channel: string; kind: 'public' | 'private' | 'im' | 'mpim'; n: number; mentions: number; in_all: number }>(statement.sql, statement.params)
    const members = yield* sql.unsafe<{ view_id: string; keep_out: number; channel: string }>(VIEW_MEMBERS)
    const viewsOf = new Map<string, Array<string>>()
    for (const member of members) {
      const views = viewsOf.get(member.channel)
      if (views === undefined) viewsOf.set(member.channel, [member.view_id])
      else views.push(member.view_id)
    }
    let channelsUnread = 0
    let dmsUnread = 0
    const mentioned = new Set<string>()
    for (const row of rows) {
      if (row.mentions > 0) for (const view of viewsOf.get(row.channel) ?? []) mentioned.add(view)
      if (scope === undefined && row.in_all === 0) continue
      if (isDm(row.kind)) dmsUnread += row.n
      else channelsUnread += row.n
    }
    // In pill order: the members come sorted by position.
    const viewMentions = [...new Set(members.map((member) => member.view_id))].filter((view) => mentioned.has(view))
    return { channelsUnread, dmsUnread, viewMentions }
  })
