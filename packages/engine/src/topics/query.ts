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
 * A `RowCache` carries the work of the last run for one subscription: a
 * topic whose joined columns and people did not change is not parsed or
 * built again, and its row object is reused, so a run where one row changed
 * shapes one row. The SQL still runs in full every time.
 */
import {
  canResolveOnHover,
  channelLabel,
  contextTint,
  defaultChannelStyle,
  defaultPersonColor,
  hashId,
  isDm,
  isResolved,
  isSubscribed,
  quietDaysOf,
  resolveTitle,
  rowTags,
  sidebarPlacement,
  topicStatus,
  tsToMillis,
  byLatestActivity,
  type ChannelId,
  type ChannelInfo,
  type Topic,
  type TopicStatus,
  type Ts,
  type UserId,
} from '@juno/domain'
import type { Person, TopicCounts, TopicRow } from '@juno/contract'
import { StoreReader, type SqlError, type TopicIndexRow } from '@juno/store'
import type { StoredPreview } from '@juno/sync'
import { Effect } from 'effect'
import type { ListRun } from '../protocol/live'

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
 * Make one per subscription and workspace with `makeRowCache()`. A run
 * replaces `entries` and `people` with what it read, so they never outgrow
 * one window; `users` grows to the people the windows have named.
 */
export interface RowCache {
  entries: ReadonlyMap<string, CacheEntry>
  people: ReadonlyMap<string, Person>
  selfId: string | undefined
  readonly keepUsers: boolean
  users: Map<string, UserRow | null> | undefined
  /** The users map the last run read people from, to tell whether any person can have changed since. */
  usersRead: Map<string, UserRow | null> | undefined
}

interface CacheEntry {
  readonly source: JoinedRow
  readonly parsed: Parsed
  readonly topic: Topic
  /** Every person the topic and row read, in any role. */
  readonly people: ReadonlyArray<Person>
  readonly partner: Person | undefined
  readonly participants: ReadonlyArray<Person>
  /** The preview's sender as the row shows it. */
  readonly sender: string
  readonly shaped?: { readonly section: TopicRow['section']; readonly status: TopicStatus; readonly row: TopicRow }
}

export const makeRowCache = (options?: { readonly keepUsers?: boolean }): RowCache => ({
  entries: new Map(),
  people: new Map(),
  selfId: undefined,
  keepUsers: options?.keepUsers === true,
  users: undefined,
  usersRead: undefined,
})

/** Drops the users a `keepUsers` cache has read, so the next run reads them again. */
export function forgetUsers(cache: RowCache): void {
  cache.users = undefined
}

export interface ListFilter {
  readonly kind: 'all' | 'channels' | 'dms'
  readonly unreadOnly: boolean
  readonly scope?: string | undefined
}

export interface QueryOptions {
  /** Wall-clock millis. */
  readonly now: number
  /** The window size; capped by the handler. */
  readonly limit: number
}

const DAY = 24 * 60 * 60 * 1000
const MAX_PARTICIPANTS = 4

interface JoinedRow extends TopicIndexRow {
  readonly c_kind: 'public' | 'private' | 'im' | 'mpim'
  readonly c_name: string | null
  readonly c_user_id: string | null
  readonly c_members: string | null
  readonly manual_title: string | null
  readonly ai_title: string | null
  readonly resolved_at: string | null
  readonly resolved_activity_ts: string | null
  readonly reopened_at: string | null
  readonly pinned_at: string | null
  readonly unsubscribed_at: string | null
  readonly subscribed: 0 | 1 | null
  /** Main rows only: the latest `last_activity_ts` of any topic in the channel. */
  readonly channel_activity_ts: string | null
}

interface UserRow {
  readonly id: string
  readonly name: string | null
  readonly display_name: string | null
  readonly real_name: string | null
  readonly avatar_url: string | null
}

const millis = (value: string | null): number | undefined => {
  if (value === null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** The quiet window from prefs (clamped by the domain rule) and the signed-in user. */
const settings = Effect.gen(function* () {
  const sql = yield* StoreReader
  const prefs = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = 'quietDays'`
  const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
  const raw = prefs[0] === undefined ? undefined : (JSON.parse(prefs[0].value_json) as unknown)
  return { quietDays: typeof raw === 'number' ? raw : undefined, selfId: team[0]?.self_user_id ?? undefined }
})

const COLUMNS = `
  SELECT i.*, c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members,
    o.manual_title, o.ai_title, o.resolved_at, o.resolved_activity_ts, o.reopened_at, o.pinned_at, o.unsubscribed_at,
    s.subscribed AS subscribed`

/**
 * The latest activity anywhere in a Main row's channel (one probe on
 * `topic_index_channel_activity`), which only the quiet rule reads. Rows
 * inside the activity window are never quiet, so the window skips the probe.
 */
const SELECT = `${COLUMNS},
    CASE WHEN i.kind = 'main' THEN (SELECT max(t.last_activity_ts) FROM topic_index t WHERE t.channel = i.channel) END AS channel_activity_ts`
const SELECT_IN_WINDOW = `${COLUMNS}, NULL AS channel_activity_ts`

const FROM = `
  FROM topic_index i
  JOIN conversations c ON c.id = i.channel
  LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
  LEFT JOIN ignored_channels ig ON ig.channel = i.channel
  LEFT JOIN thread_subs s ON i.kind = 'thread' AND s.channel = i.channel AND s.thread_ts = i.root_ts`

/**
 * Spec section 5, "Which threads": a thread row is a candidate when followed
 * in Slack, or when it carries an unread mention of the user and Slack has
 * said nothing about it (an explicit unfollow is `unsubscribed`, hidden).
 */
const THREAD_RULE = ` AND (i.kind <> 'thread' OR s.subscribed = 1 OR (s.subscribed IS NULL AND i.mentions_me = 1 AND i.unread_count > 0))`

const kindClause = (kind: ListFilter['kind']): string =>
  kind === 'channels' ? ` AND c.kind IN ('public', 'private')` : kind === 'dms' ? ` AND c.kind IN ('im', 'mpim')` : ''

/**
 * The rows `topicStatus` calls `open` or `resolved`-then-reopened, in SQL,
 * for the activity window only: there the prefilter matches the pure rule
 * (quiet cannot apply inside the window), so the window's row count says
 * whether the older statements can still add a row.
 */
const OPEN_RULE = ` AND o.unsubscribed_at IS NULL AND (o.resolved_at IS NULL OR (o.resolved_activity_ts IS NOT NULL AND i.last_activity_ts > o.resolved_activity_ts))`

/**
 * The four statements, as SQL text with positional parameters, so the plan
 * test can run them too. In order: the activity window, the pinned rows,
 * then rows older than the window (unread, and Main kept alive by threads).
 * Older rows sort after every row inside the window, so `listTopics` runs
 * the last two only when the window alone leaves room.
 */
export function listStatements(filter: ListFilter, cutoff: string, limit: number): ReadonlyArray<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }> {
  const common = ` AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL${kindClause(filter.kind)}${filter.unreadOnly ? ' AND i.unread_count > 0' : ''}`
  const scope = filter.scope === undefined ? '' : ' AND i.channel = ?'
  const scopeParams = filter.scope === undefined ? [] : [filter.scope]
  return [
    {
      sql: `${SELECT_IN_WINDOW}${FROM} WHERE i.last_activity_ts >= ?${scope}${common}${THREAD_RULE}${OPEN_RULE} ORDER BY i.last_activity_ts DESC LIMIT ?`,
      params: [cutoff, ...scopeParams, limit],
    },
    {
      sql: `${SELECT}${FROM} WHERE o.pinned_at IS NOT NULL${scope}${common}`,
      params: scopeParams,
    },
    {
      sql: `${SELECT}${FROM} WHERE i.unread_count > 0 AND i.last_activity_ts < ?${scope}${common}${THREAD_RULE} ORDER BY i.last_activity_ts DESC LIMIT ?`,
      params: [cutoff, ...scopeParams, limit],
    },
    {
      // Main rows kept alive by replies in the channel's threads: one indexed probe per member conversation for a topic
      // inside the window (the channel index is newest first, so the probe reads one row), then each Main by key.
      sql: `${SELECT}${FROM} WHERE i.topic_id IN (
          SELECT 'm:' || cv.id FROM conversations cv
          WHERE cv.is_member = 1${filter.scope === undefined ? '' : ' AND cv.id = ?'}
            AND EXISTS (SELECT 1 FROM topic_index t WHERE t.channel = cv.id AND t.last_activity_ts >= ?))
        AND i.last_activity_ts < ?${common} LIMIT ?`,
      params: [...scopeParams, cutoff, cutoff, limit],
    },
  ]
}

/**
 * The counts statement: unread topics the sidebar would show, per
 * conversation kind. An unread topic is never quiet, so it shows when it is
 * pinned, or when it is open (not unsubscribed, not resolved without later
 * activity) and passes the thread rule; the same rule as `sidebarPlacement`.
 */
export function countsStatement(scope: string | undefined): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  return {
    sql: `SELECT c.kind AS kind, count(*) AS n FROM topic_index i
      JOIN conversations c ON c.id = i.channel
      LEFT JOIN ignored_channels ig ON ig.channel = i.channel
      LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
      LEFT JOIN thread_subs s ON i.kind = 'thread' AND s.channel = i.channel AND s.thread_ts = i.root_ts
      WHERE i.unread_count > 0 AND i.last_activity_ts > '0' AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
        AND (o.pinned_at IS NOT NULL OR (1${OPEN_RULE}${THREAD_RULE}))${scope === undefined ? '' : ' AND i.channel = ?'}
      GROUP BY c.kind`,
    params: scope === undefined ? [] : [scope],
  }
}

/**
 * The sidebar window as `TopicRow`s, pinned first, then recent, both newest
 * first. Pass the subscription's `RowCache` to reuse unchanged rows between
 * runs; without one every run shapes every row.
 */
export const listTopics = (filter: ListFilter, options: QueryOptions, cache: RowCache = makeRowCache()): Effect.Effect<ListRun<TopicRow>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const { quietDays, selfId } = yield* settings
    const ctx = { now: options.now, ...(quietDays === undefined ? {} : { quietDays }) }
    const cutoffMillis = options.now - quietDaysOf(ctx) * DAY
    const cutoff = `${Math.floor(cutoffMillis / 1000)}.000000`

    const byId = new Map<string, JoinedRow>()
    const run = (statement: ReturnType<typeof listStatements>[number]) =>
      Effect.map(sql.unsafe<JoinedRow>(statement.sql, statement.params), (rows) => {
        for (const row of rows) byId.set(row.topic_id, row)
        return rows
      })
    const [window, pinnedRows, ...older] = listStatements(filter, cutoff, options.limit)
    const inWindow = yield* run(window!)
    yield* run(pinnedRows!)
    // A pinned row in the window sits in Pinned, not Recent. The rest fill Recent; the older statements only matter when they leave room.
    if (inWindow.filter((row) => row.pinned_at === null).length < options.limit) for (const statement of older) yield* run(statement)

    // A different signed-in user changes every group DM name; start over.
    if (cache.selfId !== selfId) {
      cache.selfId = selfId
      cache.entries = new Map()
      cache.people = new Map()
    }
    const previous = cache.entries

    // Names and photos: participants, DM partners, group DM members and senders, in one lookup.
    const userIds = new Set<string>()
    const parsed = new Map<JoinedRow, Parsed>()
    for (const row of byId.values()) {
      const hit = previous.get(row.topic_id)
      const columns: Parsed =
        hit !== undefined && hit.source.participants_json === row.participants_json && hit.source.preview_json === row.preview_json && hit.source.c_members === row.c_members
          ? hit.parsed
          : {
              participants: parseIds(row.participants_json).slice(0, MAX_PARTICIPANTS),
              preview: parsePreview(row.preview_json),
              members: row.c_kind === 'mpim' ? parseIds(row.c_members) : [],
            }
      parsed.set(row, columns)
      for (const id of columns.participants) userIds.add(id)
      for (const id of columns.members) userIds.add(id)
      if (row.c_user_id !== null) userIds.add(row.c_user_id)
      if (columns.preview.senderId !== undefined) userIds.add(columns.preview.senderId)
    }
    // Only the ids no earlier run has read, when the cache keeps users; every id otherwise.
    const users: Map<string, UserRow | null> = cache.keepUsers ? (cache.users ??= new Map()) : new Map()
    const missing: Array<string> = []
    for (const id of userIds) if (!users.has(id)) missing.push(id)
    if (missing.length > 0) {
      const found = yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in(missing)}`
      for (const id of missing) users.set(id, null)
      for (const user of found) users.set(user.id, user)
    }
    // A person keeps its object from the last run while its name and photo hold, so a row can tell "same people" by identity.
    // When no user was read or forgotten since the last run, every known person holds as it is.
    const peopleHold = cache.keepUsers && missing.length === 0 && users === cache.usersRead
    const knownPeople = cache.people
    const people = new Map<string, Person>()
    const personOf = (id: string): Person => {
      let person = people.get(id)
      if (person === undefined && peopleHold) {
        person = knownPeople.get(id)
        if (person !== undefined) people.set(id, person)
      }
      if (person === undefined) {
        const user = users.get(id) ?? undefined
        const name = user?.display_name ?? user?.real_name ?? user?.name ?? id
        const avatarUrl = user?.avatar_url ? user.avatar_url : undefined
        const known = knownPeople.get(id)
        person = known !== undefined && known.name === name && known.avatarUrl === avatarUrl ? known : { id, name, ...(avatarUrl === undefined ? {} : { avatarUrl }), color: defaultPersonColor(id) }
        people.set(id, person)
      }
      return person
    }

    // Build or reuse the domain topic of every row, then let the pure rules place it.
    const next = new Map<string, CacheEntry>()
    const pinned: Array<CacheEntry> = []
    const recent: Array<CacheEntry> = []
    for (const row of byId.values()) {
      if (row.last_activity_ts === null) continue
      const hit = previous.get(row.topic_id)
      const columns = parsed.get(row)!
      const entry: CacheEntry =
        hit !== undefined && sameSource(hit.source, row) && (peopleHold || samePeople(hit.people, personOf))
          ? hit
          : { ...topicOf(row, columns, selfId, personOf), source: row, parsed: columns }
      next.set(row.topic_id, entry)
      const placement = sidebarPlacement(entry.topic, ctx)
      if (placement === 'pinned') pinned.push(entry)
      else if (placement === 'recent') recent.push(entry)
    }
    pinned.sort((a, b) => byLatestActivity(a.topic, b.topic))
    recent.sort((a, b) => byLatestActivity(a.topic, b.topic))

    const rows: Array<TopicRow> = []
    const place = (entry: CacheEntry, section: TopicRow['section']) => {
      const status = topicStatus(entry.topic, ctx)
      const shaped = entry.shaped !== undefined && entry.shaped.section === section && entry.shaped.status === status ? entry.shaped : { section, status, row: shape(entry, section, status) }
      if (shaped !== entry.shaped) next.set(entry.topic.id, { ...entry, shaped })
      rows.push(shaped.row)
    }
    for (const entry of pinned) place(entry, 'pinned')
    for (const entry of recent) {
      if (rows.length >= options.limit) break
      place(entry, 'recent')
    }
    // Committed together, at the end, so a run that fails halfway leaves the last good state.
    cache.entries = next
    cache.people = people
    cache.usersRead = users
    return { rows, total: rows.length }
  })

interface Parsed {
  readonly participants: ReadonlyArray<string>
  readonly preview: StoredPreview
  /** Group DM members, empty for any other kind. */
  readonly members: ReadonlyArray<string>
}

/** Every column of the joined row equal: the topic built from it still holds. */
function sameSource(a: JoinedRow, b: JoinedRow): boolean {
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

/** The domain topic for an index row, with the people it was built from. */
function topicOf(row: JoinedRow, columns: Parsed, selfId: string | undefined, personOf: (id: string) => Person): Pick<CacheEntry, 'topic' | 'people' | 'partner' | 'participants' | 'sender'> {
  const { participants, preview } = columns
  const used: Array<Person> = []
  const use = (id: string): Person => {
    const person = personOf(id)
    used.push(person)
    return person
  }
  const channel = channelOf(row, columns, selfId, (id) => use(id).name)
  const partner = row.c_kind === 'im' && row.c_user_id !== null ? use(row.c_user_id) : undefined
  const people = participants.map(use)
  const sender = preview.senderId !== undefined && preview.sender !== 'You' ? use(preview.senderId).name : preview.sender
  const topic: Topic = {
    id: row.topic_id as Topic['id'],
    kind: row.kind,
    channel,
    activity: {
      lastActivityTs: row.last_activity_ts as Ts,
      ...(row.channel_activity_ts === null ? {} : { channelLastActivityTs: row.channel_activity_ts as Ts }),
      messageCount: row.message_count,
      unreadCount: row.unread_count,
      unreadExact: row.unread_exact === 1,
      mentionsMe: row.mentions_me === 1,
      participants: participants as unknown as ReadonlyArray<UserId>,
    },
    overlay: {
      ...(row.manual_title === null ? {} : { manualTitle: row.manual_title }),
      ...(row.ai_title === null ? {} : { aiTitle: row.ai_title }),
      ...(millis(row.resolved_at) === undefined ? {} : { resolvedAt: millis(row.resolved_at)! }),
      ...(row.resolved_activity_ts === null ? {} : { resolvedActivityTs: row.resolved_activity_ts as Ts }),
      ...(millis(row.reopened_at) === undefined ? {} : { reopenedAt: millis(row.reopened_at)! }),
      ...(millis(row.pinned_at) === undefined ? {} : { pinnedAt: millis(row.pinned_at)! }),
      ...(millis(row.unsubscribed_at) === undefined ? {} : { unsubscribedAt: millis(row.unsubscribed_at)! }),
    },
    ...(row.subscribed === null ? {} : { slackSubscribed: row.subscribed === 1 }),
    ...(preview.rootText === undefined ? {} : { firstMessageText: preview.rootText }),
  }
  return { topic, people: used, partner, participants: people, sender }
}

/** The row for a topic in a section. `rev` hashes every input, so equal inputs give an equal rev on any run and in any subscription. */
function shape(entry: CacheEntry, section: TopicRow['section'], status: TopicStatus): TopicRow {
  const { topic, source: row, partner, participants: people, sender } = entry
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
    row.unsubscribed_at,
    row.subscribed,
    row.c_name,
    row.c_kind,
    topic.channel.name,
    label,
    section,
    status,
    sender,
    ...(partner === undefined ? [] : [partner.name, partner.avatarUrl]),
    ...people.flatMap((p) => [p.name, p.avatarUrl]),
  ].join('\u0001')

  const title = resolveTitle(topic)
  const resolved = isResolved(topic)
  const style = defaultChannelStyle(topic.channel.id, topic.channel.kind)
  return {
    id: topic.id,
    rev: hashId(key),
    kind: topic.kind,
    section,
    status: status === 'ignored' ? 'open' : status,
    title: title.text,
    titleSource: title.source,
    preview: { sender, text: stored.text },
    channel: {
      id: topic.channel.id,
      kind: topic.channel.kind,
      name: topic.channel.kind === 'public' || topic.channel.kind === 'private' ? topic.channel.name : label,
      label,
      tint: contextTint(topic.channel.kind),
      icon: style.icon,
      color: style.color,
      ...(partner === undefined ? {} : { partner }),
    },
    participants: people,
    messageCount: topic.activity.messageCount,
    unreadCount: topic.activity.unreadCount,
    unreadExact: topic.activity.unreadExact !== false,
    mentionsMe: topic.activity.mentionsMe,
    tags: rowTags(topic),
    pinned: topic.overlay.pinnedAt !== undefined,
    resolved,
    canResolveOnHover: canResolveOnHover(topic),
    subscribed: isSubscribed(topic),
    lastActivityTs: topic.activity.lastActivityTs,
    lastActivityAt: tsToMillis(topic.activity.lastActivityTs),
  }
}

function channelOf(row: JoinedRow, columns: Parsed, selfId: string | undefined, nameOf: (id: string) => string): ChannelInfo {
  const id = row.channel as ChannelId
  switch (row.c_kind) {
    case 'im':
      return { id, kind: 'im', name: row.c_user_id === null ? (row.c_name ?? id) : nameOf(row.c_user_id) }
    case 'mpim': {
      const members = columns.members.filter((member) => member !== selfId)
      return { id, kind: 'mpim', name: row.c_name ?? id, memberNames: members.map(nameOf) }
    }
    default:
      return { id, kind: row.c_kind, name: row.c_name ?? id }
  }
}

function parseIds(json: string | null): ReadonlyArray<string> {
  if (json === null) return []
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function parsePreview(json: string | null): StoredPreview {
  if (json === null) return { sender: '', text: '' }
  try {
    return JSON.parse(json) as StoredPreview
  } catch {
    return { sender: '', text: '' }
  }
}

/** Unread topics per group for the filter dots. */
export const countTopics = (scope: string | undefined): Effect.Effect<TopicCounts, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statement = countsStatement(scope)
    const rows = yield* sql.unsafe<{ kind: 'public' | 'private' | 'im' | 'mpim'; n: number }>(statement.sql, statement.params)
    let channelsUnread = 0
    let dmsUnread = 0
    for (const row of rows) {
      if (isDm(row.kind)) dmsUnread += row.n
      else channelsUnread += row.n
    }
    return { channelsUnread, dmsUnread }
  })
