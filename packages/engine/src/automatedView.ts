/**
 * The built-in Automated view (SPEC section 5, "Automated"): the writes the
 * sorting job (`home/automated.ts`) and the views commands share. Every
 * function runs inside the caller's writer transaction.
 *
 * `sortClearCases` is the rules' pass the sync runs at the end of each boot
 * (`onBooted`), before it reports live, so a clear bot channel is already
 * out of All when the first sync finishes. The job then asks Juno and the
 * user about the ambiguous ones.
 *
 * `automated_channels` holds one row per conversation whose place is
 * settled. The rules and Juno only ever write a conversation that has no
 * row, or one still asked about by them; a row by `you` is the user's
 * choice and stays.
 */
import { AUTOMATED_SAMPLE, AUTOMATED_VIEW, AUTOMATED_VIEW_ID, classifyConversation, type AutomatedVerdict, type Sender } from '@juno/domain'
import { invalidate, keys, StoreReader, StoreWriter, transaction, type Invalidation, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'

export type Verdict = 'automated' | 'kept' | 'ask'
export type SortedBy = 'rules' | 'juno' | 'you'

/** `missing`: Juno has not made the view yet. `deleted`: the user deleted it, so it is not made again. */
export type AutomatedViewState = 'live' | 'missing' | 'deleted'

export const automatedViewState: Effect.Effect<AutomatedViewState, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const rows = yield* sql<{ live: number; made: number }>`SELECT
    EXISTS (SELECT 1 FROM sidebar_views WHERE id = ${AUTOMATED_VIEW_ID}) AS live,
    EXISTS (SELECT 1 FROM builtin_views WHERE id = ${AUTOMATED_VIEW_ID}) AS made`
  const row = rows[0]
  return row?.live === 1 ? 'live' : row?.made === 1 ? 'deleted' : 'missing'
})

/** Records where a conversation stands. */
export const setVerdict = (channel: string, verdict: Verdict, by: SortedBy, now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO automated_channels (channel, verdict, by, at) VALUES (${channel}, ${verdict}, ${by}, ${String(now)})
      ON CONFLICT (channel) DO UPDATE SET verdict = excluded.verdict, by = excluded.by, at = excluded.at`
  })

export const clearVerdict = (channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM automated_channels WHERE channel = ${channel}`
  })

/**
 * Puts a conversation in Automated, making the view first if Juno never
 * has (last in the pill row). A view the user deleted is made again only
 * for the user's own Move; for the rules and Juno it stays deleted and
 * nothing is written. Resolves with whether the conversation is in the view.
 */
export const moveToAutomated = (channel: string, by: SortedBy, now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const state = yield* automatedViewState
    if (state === 'deleted' && by !== 'you') return false
    if (state !== 'live') {
      const last = (yield* sql<{ position: number | null }>`SELECT max(position) AS position FROM sidebar_views`)[0]?.position ?? -1
      yield* sql`INSERT INTO sidebar_views (id, name, icon, position, keep_out_of_all, created_at)
        VALUES (${AUTOMATED_VIEW_ID}, ${AUTOMATED_VIEW.name}, ${AUTOMATED_VIEW.icon}, ${last + 1}, ${AUTOMATED_VIEW.keepOutOfAll ? 1 : 0}, ${String(now)})`
      yield* sql`INSERT OR IGNORE INTO builtin_views (id, made_at) VALUES (${AUTOMATED_VIEW_ID}, ${String(now)})`
    }
    yield* sql`INSERT OR IGNORE INTO sidebar_view_channels (view_id, channel, added_at) VALUES (${AUTOMATED_VIEW_ID}, ${channel}, ${String(now)})`
    yield* setVerdict(channel, 'automated', by, now)
    return true
  })

/** Takes a conversation out of Automated, if it is there. */
export const leaveAutomated = (channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM sidebar_view_channels WHERE view_id = ${AUTOMATED_VIEW_ID} AND channel = ${channel}`
  })

/**
 * The user changed a view's conversations by hand (the sheet, Add to view,
 * or Juno from the user's words): each conversation added or removed is
 * settled by `you`, so the rules and Juno never move it again.
 */
export const placedByHand = (viewId: string, changes: ReadonlyArray<{ readonly channel: string; readonly member: boolean }>, now: number) =>
  Effect.forEach(
    changes,
    ({ channel, member }) =>
      Effect.gen(function* () {
        if (viewId === AUTOMATED_VIEW_ID) return yield* setVerdict(channel, member ? 'automated' : 'kept', 'you', now)
        // Another view: whether it is also in Automated does not change, only who decides.
        const sql = yield* StoreWriter
        yield* sql`INSERT INTO automated_channels (channel, verdict, by, at) VALUES (${channel}, 'kept', 'you', ${String(now)})
          ON CONFLICT (channel) DO UPDATE SET verdict = CASE WHEN verdict = 'automated' THEN 'automated' ELSE 'kept' END, by = 'you', at = excluded.at`
      }),
    { discard: true },
  )

/** A conversation the pass may sort. */
export interface Candidate {
  readonly id: string
  readonly kind: 'public' | 'private' | 'im' | 'mpim'
  readonly name: string | null
  readonly topic: string | null
  readonly partner_is_bot: number | null
  readonly activity: string
  readonly verdict: 'ask' | null
}

export interface SampleRow {
  readonly ts: string
  readonly user_id: string | null
  readonly subtype: string | null
  readonly text: string
  readonly is_bot: number | null
}

/** Message subtypes people and apps write; joins, topic changes and the like say nothing. */
const SAID = `(m.subtype IS NULL OR m.subtype IN ('bot_message', 'thread_broadcast', 'file_share', 'me_message'))`

const CANDIDATES = `SELECT c.id, c.kind, c.name, c.topic, u.is_bot AS partner_is_bot, a.verdict,
    (SELECT max(t.last_activity_ts) FROM topic_index t WHERE t.channel = c.id) AS activity
  FROM conversations c
  LEFT JOIN users u ON c.kind = 'im' AND u.id = c.user_id
  LEFT JOIN ignored_channels ig ON ig.channel = c.id
  LEFT JOIN automated_channels a ON a.channel = c.id
  WHERE c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
    AND (a.channel IS NULL OR (a.verdict = 'ask' AND a.by <> 'you'))
    AND NOT EXISTS (SELECT 1 FROM sidebar_view_channels vc WHERE vc.channel = c.id)`

/** The statements a pass runs, so the plan test can check each one uses an index. */
export const automatedStatements = {
  candidates: () => ({ sql: CANDIDATES, params: [] as ReadonlyArray<string | number> }),
  sample: (channel: string) => ({
    sql: `SELECT m.ts, m.user_id, m.subtype, m.text, u.is_bot FROM messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel = ? AND m.deleted = 0 AND ${SAID} ORDER BY m.ts DESC LIMIT ?`,
    params: [channel, AUTOMATED_SAMPLE] as ReadonlyArray<string | number>,
  }),
}

export const sampleOf = (channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statement = automatedStatements.sample(channel)
    return yield* sql.unsafe<SampleRow>(statement.sql, statement.params)
  })

/** A bot message, a bot user, or a bot id in place of a user. */
export const senderOf = (row: SampleRow, selfId: string | undefined): Sender =>
  row.subtype === 'bot_message' || row.is_bot === 1 || row.user_id?.startsWith('B') === true ? 'app' : row.user_id !== null && row.user_id === selfId ? 'you' : 'person'

/** Conversations with activity in the last `ACTIVE_DAYS` days. */
const ACTIVE_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

/** The conversations a pass may sort: active lately, not ignored, in no view, with no place settled except an open question by the rules or Juno. */
export const candidates = (now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const since = `${Math.floor((now - ACTIVE_DAYS * DAY) / 1000)}.000000`
    return (yield* sql.unsafe<Candidate>(CANDIDATES)).filter((row) => row.activity !== null && row.activity >= since)
  })

/** What the rules say about a conversation, with the sample they read. */
export const classify = (row: Candidate, selfId: string | undefined) =>
  Effect.gen(function* () {
    const sample = yield* sampleOf(row.id)
    const verdict: AutomatedVerdict = classifyConversation({
      kind: row.kind,
      name: row.name ?? '',
      partnerIsApp: row.partner_is_bot === 1,
      senders: sample.map((message) => senderOf(message, selfId)),
    })
    return { verdict, sample }
  })

export const selfIdOf = Effect.gen(function* () {
  const sql = yield* StoreReader
  return (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
})

/** One write in its own transaction, telling the sidebar and Home. */
export const write = <A>(effect: Effect.Effect<A, SqlError, StoreWriter>) =>
  transaction(Effect.tap(effect, () => invalidate([...keys.sidebarViews, ...keys.automatedChannels])))

/** The rules alone: clear cases go into the view. Ambiguous ones wait for the job. */
export const sortClearCases: Effect.Effect<void, SqlError, StoreReader | StoreWriter | Invalidation> = Effect.gen(function* () {
  if ((yield* automatedViewState) === 'deleted') return
  const now = yield* Clock.currentTimeMillis
  const selfId = yield* selfIdOf
  for (const row of yield* candidates(now)) {
    const { verdict } = yield* classify(row, selfId)
    if (verdict === 'automated') yield* write(moveToAutomated(row.id, 'rules', now))
  }
})
