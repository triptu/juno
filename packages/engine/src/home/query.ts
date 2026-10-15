/**
 * Home's items (SPEC section 12; `docs/design/home/README.md`, "Items: how
 * they are chosen and capped"), from the local cache only.
 *
 * - Waiting on you: in a followed thread or a DM with unread messages, the
 *   newest unread message from someone else that asks the user something
 *   (`asksUser`), with no message from the user after it.
 * - Pick up where you left off: the last topic the user had open for a
 *   minute (`topic_visits`), when it has unread messages.
 * - Moved a lot: the followed topic with the most unread messages, at least
 *   `MOVED_A_LOT_MIN`.
 * - Follow-up (AI assist on): the newest promise in `follow_ups` not marked
 *   done, found by the job (`job.ts`).
 * - Tidy up (AI assist on): followed topics the settled decision scored at
 *   least `SETTLED_MIN_SCORE`, scored after their latest activity.
 * - Automated: the most recently active conversation the rules and Juno
 *   could not place (`ask` in `automated_channels`, by `automated.ts`), in
 *   no view, while the user has not deleted the Automated view.
 *
 * "Followed" is a thread Slack follows or a DM's Main. Resolved topics and
 * ignored channels never appear. `rankHomeItems` keeps at most one of each
 * kind and three in all. An item's `aiTitle` is the assistant's rewrite
 * (`homeTitle` in `ai_cache`) when it was made after the topic's latest
 * activity and was confident.
 */
import { HOME_ITEM_LIMIT, type HomeItem, type HomeTopic, type HomeView } from '@juno/contract'
import {
  asksUser,
  AUTOMATED_SAMPLE,
  AUTOMATED_VIEW_ID,
  channelLabel,
  channelLabelBare,
  firstName,
  millisToTs,
  MOVED_A_LOT_MIN,
  rankHomeItems,
  resolveTitle,
  SETTLED_MIN_SCORE,
  tsToMillis,
  type HomeCandidate,
  type Ts,
} from '@juno/domain'
import { StoreReader, syncState, type SqlError } from '@juno/store'
import { BOOT_KEY } from '@juno/sync'
import { Clock, Effect } from 'effect'
import { aiAssistOn } from '../ai'
import { artRefOf, channelInfoOf, channelRefOf, parseColumns, topicFrom, TOPIC_COLUMNS, TOPIC_FROM, userIdsOf, userName, type JoinedRow, type UserRow } from '../topicRows'

/** A topic row with Juno's read pointer. */
export interface HomeRow extends JoinedRow {
  readonly last_read_ts: string | null
}

/** Open: a member of a live channel that is not ignored, and not resolved (or reopened by later activity). */
export const OPEN = `c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
  AND (o.resolved_at IS NULL OR (o.resolved_activity_ts IS NOT NULL AND i.last_activity_ts > o.resolved_activity_ts))`
/** Followed: a thread Slack follows, or a DM's Main. A channel's Main is a stream, not a topic the user follows. */
export const FOLLOWED = `((i.kind = 'thread' AND s.subscribed = 1) OR (i.kind = 'main' AND c.kind IN ('im', 'mpim')))`

export const HOME_SELECT = `${TOPIC_COLUMNS}, NULL AS channel_activity_ts, r.last_read_ts AS last_read_ts ${TOPIC_FROM}
  LEFT JOIN topic_reads r ON r.topic_id = i.topic_id`

/** Unread followed topics looked at for Waiting and Moved, newest first, from the last `UNREAD_DAYS`. */
const UNREAD_LIMIT = 100
const UNREAD_DAYS = 30
const DAY = 24 * 60 * 60 * 1000
/** Unread messages read per topic when looking for a question. */
const QUESTION_WINDOW = 50

interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<string | number>
}

/** The statements that read `topic_index` and `messages`, so the plan test can check each one uses an index. */
export const homeStatements = {
  /** Unread followed topics active since `since`, newest first, through the unread index. */
  unread: (since: string): Statement => ({
    sql: `${HOME_SELECT} WHERE i.unread_count > 0 AND i.last_activity_ts > ? AND ${OPEN} AND ${FOLLOWED} ORDER BY i.last_activity_ts DESC LIMIT ?`,
    params: [since, UNREAD_LIMIT],
  }),
  topics: (ids: ReadonlyArray<string>): Statement => ({
    sql: `${HOME_SELECT} WHERE i.topic_id IN (${ids.map(() => '?').join(', ')}) AND ${OPEN}`,
    params: [...ids],
  }),
  threadAfter: (channel: string, threadTs: string, after: string, limit = QUESTION_WINDOW): Statement => ({
    sql: `SELECT ts, user_id, text FROM messages WHERE channel = ? AND thread_ts = ? AND ts > ? AND deleted = 0 ORDER BY ts DESC LIMIT ?`,
    params: [channel, threadTs, after, limit],
  }),
  /** The Main of the newest conversation Home asks about for Automated. */
  automated: (): Statement => ({
    sql: `${HOME_SELECT}
      WHERE i.channel IN (SELECT channel FROM automated_channels WHERE verdict = 'ask') AND i.kind = 'main' AND ${OPEN}
        AND NOT EXISTS (SELECT 1 FROM sidebar_view_channels vc WHERE vc.channel = i.channel)
        AND NOT EXISTS (SELECT 1 FROM builtin_views b WHERE b.id = ? AND NOT EXISTS (SELECT 1 FROM sidebar_views v WHERE v.id = b.id))
      ORDER BY +i.last_activity_ts DESC LIMIT 1`,
    params: [AUTOMATED_VIEW_ID],
  }),
  /** How many of a conversation's latest messages came from apps, for the meta line. */
  fromApps: (channel: string): Statement => ({
    sql: `SELECT count(*) AS of, coalesce(sum(app), 0) AS apps FROM (
        SELECT (m.subtype = 'bot_message' OR u.is_bot = 1 OR m.user_id LIKE 'B%') AS app FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.channel = ? AND m.deleted = 0 AND (m.subtype IS NULL OR m.subtype IN ('bot_message', 'thread_broadcast', 'file_share', 'me_message'))
        ORDER BY m.ts DESC LIMIT ?)`,
    params: [channel, AUTOMATED_SAMPLE],
  }),
  mainAfter: (channel: string, after: string, limit = QUESTION_WINDOW): Statement => ({
    sql: `SELECT ts, user_id, text FROM messages WHERE channel = ? AND ts > ? AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast') AND deleted = 0
      ORDER BY ts DESC LIMIT ?`,
    params: [channel, after, limit],
  }),
}

export interface MessageRow {
  readonly ts: string
  readonly user_id: string | null
  readonly text: string
}

/** The messages after `after`, newest first: a thread's replies, or a Main's top-level messages. */
export const messagesAfter = (
  row: Pick<JoinedRow, 'kind' | 'channel' | 'root_ts'>,
  after: string,
  limit?: number,
): Effect.Effect<ReadonlyArray<MessageRow>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statement =
      row.kind === 'thread' && row.root_ts !== null ? homeStatements.threadAfter(row.channel, row.root_ts, after, limit) : homeStatements.mainAfter(row.channel, after, limit)
    return yield* sql.unsafe<MessageRow>(statement.sql, statement.params)
  })

export const NO_READ = '0000000000.000000'

/** The question waiting on the user in this topic, if any. */
function waitingQuestion(messages: ReadonlyArray<MessageRow>, selfId: string, directMessage: boolean): MessageRow | undefined {
  // Newest first: a message from the user before any question means they already answered.
  for (const message of messages) {
    if (message.user_id === selfId) return undefined
    if (message.user_id !== null && asksUser(message, selfId, directMessage)) return message
  }
  return undefined
}

interface Candidate {
  readonly item: Omit<HomeItem, 'topics' | 'aiTitle'>
  readonly rows: ReadonlyArray<HomeRow>
}

/** What `readHome` returns: the view, and the items whose title line the assistant may rewrite. */
export interface HomeRun {
  readonly view: HomeView
  readonly aiAssist: boolean
  readonly rewritable: ReadonlyArray<{ readonly item: HomeItem; readonly row: HomeRow }>
}

const parseScore = (json: string): number | undefined => {
  try {
    const value = JSON.parse(json) as { score?: unknown }
    return typeof value.score === 'number' ? value.score : undefined
  } catch {
    return undefined
  }
}

const parseTitle = (json: string): string | undefined => {
  try {
    const value = JSON.parse(json) as { title?: unknown; confident?: unknown }
    return value.confident === true && typeof value.title === 'string' && value.title.trim() !== '' ? value.title.trim() : undefined
  } catch {
    return undefined
  }
}

/** Was an `ai_cache` row (created at epoch millis) made after the topic's latest activity? */
export const freshFor = (createdAt: string, row: Pick<JoinedRow, 'last_activity_ts'>): boolean =>
  row.last_activity_ts === null || Number(createdAt) >= tsToMillis(row.last_activity_ts as Ts)

export const readHome = (): Effect.Effect<HomeRun, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const aiAssist = yield* aiAssistOn
    const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const selfId = team[0]?.self_user_id ?? undefined
    const run = (statement: Statement) => sql.unsafe<HomeRow>(statement.sql, statement.params)

    const now = yield* Clock.currentTimeMillis
    const unread = yield* run(homeStatements.unread(millisToTs(now - UNREAD_DAYS * DAY)))
    const candidates: Array<HomeCandidate<Candidate>> = []
    const add = (item: Candidate['item'], rows: ReadonlyArray<HomeRow>) => candidates.push({ kind: item.kind, topicIds: rows.map((row) => row.topic_id), value: { item, rows } })
    const senders = new Set<string>()

    // Waiting on you: the newest topic with a question first.
    if (selfId !== undefined) {
      for (const row of unread) {
        const messages = yield* messagesAfter(row, row.last_read_ts ?? NO_READ)
        const question = waitingQuestion(messages, selfId, row.kind === 'main' && row.c_kind === 'im')
        if (question === undefined) continue
        senders.add(question.user_id!)
        add({ id: `waiting:${row.topic_id}`, kind: 'waiting', title: question.user_id!, at: tsToMillis(question.ts as Ts) }, [row])
        break
      }
    }

    // Pick up where you left off: the last topic open for a minute, when something came after.
    const visit = (yield* sql<{ topic_id: string; seen_at: string }>`SELECT topic_id, seen_at FROM topic_visits ORDER BY seen_at DESC LIMIT 1`)[0]
    if (visit !== undefined) {
      const [row] = yield* run(homeStatements.topics([visit.topic_id]))
      if (row !== undefined && row.unread_count > 0) add({ id: `resume:${row.topic_id}`, kind: 'resume', title: 'Pick up where you left off', at: Number(visit.seen_at) }, [row])
    }

    // Moved a lot: the most new messages.
    const moved = unread.filter((row) => row.unread_count >= MOVED_A_LOT_MIN).toSorted((a, b) => b.unread_count - a.unread_count)
    for (const row of moved) add({ id: `moved:${row.topic_id}`, kind: 'moved', title: 'Moved a lot since you looked', newCount: row.unread_count }, [row])

    if (aiAssist) {
      const promises = yield* sql<{ topic_id: string; message_ts: string; text: string }>`
        SELECT topic_id, message_ts, text FROM follow_ups WHERE done_at IS NULL ORDER BY message_ts DESC LIMIT 10`
      const promiseRows = promises.length === 0 ? [] : yield* run(homeStatements.topics([...new Set(promises.map((p) => p.topic_id))]))
      for (const promise of promises) {
        const row = promiseRows.find((r) => r.topic_id === promise.topic_id)
        if (row === undefined) continue
        add({ id: `followUp:${row.topic_id}:${promise.message_ts}`, kind: 'followUp', title: promise.text, at: tsToMillis(promise.message_ts as Ts), messageTs: promise.message_ts }, [row])
      }

      const scored = yield* sql<{ key: string; output_json: string; created_at: string }>`
        SELECT key, output_json, created_at FROM ai_cache WHERE task = 'settledScore'`
      const high = scored.filter((entry) => (parseScore(entry.output_json) ?? 0) >= SETTLED_MIN_SCORE)
      if (high.length > 0) {
        const rows = yield* run(homeStatements.topics(high.map((entry) => entry.key)))
        const settled = rows
          .filter((row) => {
            const entry = high.find((h) => h.key === row.topic_id)
            return entry !== undefined && freshFor(entry.created_at, row) && (row.kind === 'thread' ? row.subscribed === 1 : row.c_kind === 'im' || row.c_kind === 'mpim')
          })
          .toSorted((a, b) => ((b.last_activity_ts ?? '') < (a.last_activity_ts ?? '') ? -1 : 1))
        add({ id: 'tidyUp', kind: 'tidyUp', title: `${settled.length} topics look settled` }, settled)
      }
    }

    // Automated: a conversation the rules and Juno could not place. Asked with AI on or off.
    const [asked] = yield* run(homeStatements.automated())
    if (asked !== undefined) {
      const counts = (yield* sql.unsafe<{ apps: number; of: number }>(homeStatements.fromApps(asked.channel).sql, homeStatements.fromApps(asked.channel).params))[0]
      add(
        {
          id: `automated:${asked.channel}`,
          kind: 'automated',
          title: '',
          ...(asked.last_activity_ts === null ? {} : { at: tsToMillis(asked.last_activity_ts as Ts) }),
          ...(counts === undefined ? {} : { fromApps: { apps: counts.apps, of: counts.of } }),
        },
        [asked],
      )
    }

    const ranked = rankHomeItems(candidates, HOME_ITEM_LIMIT)

    // Names: the shown topics' people and the senders of the questions, and the user for the greeting.
    const userIds = new Set<string>(senders)
    if (selfId !== undefined) userIds.add(selfId)
    const shownRows = ranked.flatMap((candidate) => candidate.value.rows.filter((row) => candidate.topicIds.includes(row.topic_id)))
    for (const row of shownRows) userIdsOf(row, parseColumns(row), userIds)
    const users = new Map<string, UserRow>()
    if (userIds.size > 0) for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in([...userIds])}`) users.set(user.id, user)
    const nameOf = (id: string) => userName(id, users.get(id))

    const topicOf = (row: HomeRow): HomeTopic => {
      const columns = parseColumns(row)
      const info = channelInfoOf(row, columns, selfId, nameOf)
      const topic = topicFrom(row, columns, info)
      const art = artRefOf(row, aiAssist)
      return {
        id: row.topic_id,
        title: row.kind === 'main' ? channelLabel(info) : resolveTitle(topic).text,
        place: channelLabelBare(info),
        ...(art === undefined || art.recipe === '' ? {} : { art: art.recipe }),
      }
    }

    const automatedChannelOf = (row: HomeRow) => {
      const info = channelInfoOf(row, parseColumns(row), selfId, nameOf)
      return channelRefOf(info, row.c_kind === 'im' ? (row.c_user_id ?? undefined) : undefined)
    }

    // Rewrites the assistant made after each topic's latest activity.
    const rewriteIds = ranked.filter((c) => c.kind === 'waiting' || c.kind === 'resume' || c.kind === 'moved').map((c) => c.value.item.id)
    const rewrites =
      !aiAssist || rewriteIds.length === 0
        ? []
        : yield* sql<{ key: string; output_json: string; created_at: string }>`SELECT key, output_json, created_at FROM ai_cache WHERE task = 'homeTitle' AND key IN ${sql.in(rewriteIds)}`

    const rewritable: Array<{ readonly item: HomeItem; readonly row: HomeRow }> = []
    const items = ranked.map((candidate): HomeItem => {
      const rows = candidate.value.rows.filter((row) => candidate.topicIds.includes(row.topic_id))
      const base = candidate.value.item
      const channel = base.kind === 'automated' && rows[0] !== undefined ? automatedChannelOf(rows[0]) : undefined
      const title =
        base.kind === 'waiting'
          ? `${firstName(nameOf(base.title))} asked you something`
          : base.kind === 'tidyUp'
            ? `${rows.length} topics look settled`
            : channel !== undefined
              ? `Move ${channel.label} to Automated?`
              : base.title
      const cached = rewrites.find((entry) => entry.key === base.id)
      const aiTitle = cached !== undefined && rows[0] !== undefined && freshFor(cached.created_at, rows[0]) ? parseTitle(cached.output_json) : undefined
      const item: HomeItem = { ...base, title, topics: rows.map(topicOf), ...(aiTitle === undefined ? {} : { aiTitle }), ...(channel === undefined ? {} : { channel }) }
      if (aiAssist && rewriteIds.includes(base.id) && rows[0] !== undefined && (cached === undefined || !freshFor(cached.created_at, rows[0]))) rewritable.push({ item, row: rows[0] })
      return item
    })

    const booted = yield* syncState.get(BOOT_KEY)
    const self = selfId === undefined ? undefined : users.get(selfId)
    const name = self === undefined ? '' : firstName(self.real_name ?? self.display_name ?? self.name ?? '')
    return {
      view: { ...(name === '' ? {} : { firstName: name }), items, unread: unread.length > 0, ready: booted !== undefined },
      aiAssist,
      rewritable,
    }
  })
