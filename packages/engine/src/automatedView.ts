/**
 * The built-in Automated view (SPEC section 5, "Automated"): the writes the
 * sorting job (`home/automated.ts`) and the views commands share. Every
 * function runs inside the caller's writer transaction.
 *
 * `sortClearCases` is the rules' pass the sync runs at the end of each boot
 * (`onBooted`), before it reports live, and for each conversation as the
 * first sync stores its history (`onHistory`). The job then asks Juno and
 * the user about the ambiguous ones.
 *
 * The first sync never shows a channel in All that the rules then move
 * out: once the conversations are listed and before any row shows
 * (`onListed`), `holdUndecided` sorts what the rules can already place and
 * holds the channels they cannot read yet (`automated_holds`, which the
 * sidebar's All leaves out). Each is let go once its history is sorted
 * (`sortAndRelease`), and the rest after the configured hold or when the boot
 * ends, so a slow history never keeps a channel out of All for long.
 *
 * `automated_channels` holds one row per conversation whose place is
 * settled. The rules and Juno only ever write a conversation that has no
 * row, or one still asked about by them, or one they moved themselves; a
 * row by `you` is the user's choice and stays.
 *
 * `automated_moves` records what the rules and Juno moved, in or back out,
 * with the counts that decided it, for Home's "Juno moved 2 channels to
 * Automated" (SPEC 12). Moves into the view are recorded once the first
 * boot's own sorting is done (`RECORD_FROM_PREF`, set by `sortClearCases`
 * after a whole pass): sorting a new workspace is setting up, not news.
 */
import { AUTOMATED_SAMPLE, AUTOMATED_VIEW, AUTOMATED_VIEW_ID, classifyConversation, postingCounts, type AutomatedVerdict, type PostingCounts, type Sender } from '@juno/domain'
import { invalidate, keys, prefs, StoreReader, StoreWriter, transaction, type Invalidation, type SqlError } from '@juno/store'
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

/** Why a question was asked, for Home's line: the count the rules read, and Juno's reason when it gave one. */
export interface AskedWhy {
  readonly apps: number
  readonly sampled: number
  readonly reason?: string
}

/**
 * Records where a conversation stands. With `why` (a question), it is kept
 * for Home; without, what an earlier question stored stays, so an Undo back
 * to the question still says why.
 */
export const setVerdict = (channel: string, verdict: Verdict, by: SortedBy, now: number, why?: AskedWhy) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    if (why === undefined) {
      yield* sql`INSERT INTO automated_channels (channel, verdict, by, at) VALUES (${channel}, ${verdict}, ${by}, ${String(now)})
        ON CONFLICT (channel) DO UPDATE SET verdict = excluded.verdict, by = excluded.by, at = excluded.at`
      return
    }
    yield* sql`INSERT INTO automated_channels (channel, verdict, by, at, apps, sampled, reason)
      VALUES (${channel}, ${verdict}, ${by}, ${String(now)}, ${why.apps}, ${why.sampled}, ${why.reason ?? null})
      ON CONFLICT (channel) DO UPDATE SET verdict = excluded.verdict, by = excluded.by, at = excluded.at,
        apps = excluded.apps, sampled = excluded.sampled, reason = excluded.reason`
  })

export const clearVerdict = (channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM automated_channels WHERE channel = ${channel}`
  })

/** The workspace preference set once the first sync's sorting is done: from then on, moves into Automated are recorded. */
export const RECORD_FROM_PREF = 'automatedRecordFrom'

/** Why the rules or Juno moved a conversation: the counts the rule read, and Juno's line when Juno decided. */
export interface MoveWhy {
  readonly counts: PostingCounts
  readonly reason?: string
}

/** Records a move by the rules or Juno for Home's record, replacing the conversation's earlier one. */
export const recordMove = (channel: string, change: 'in' | 'out', by: Exclude<SortedBy, 'you'>, now: number, why: MoveWhy) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO automated_moves (channel, change, by, at, apps, people, you, sampled, reason, seen_at)
      VALUES (${channel}, ${change}, ${by}, ${String(now)}, ${why.counts.apps}, ${why.counts.people}, ${why.counts.you}, ${why.counts.of}, ${why.reason ?? null}, NULL)
      ON CONFLICT (channel) DO UPDATE SET change = excluded.change, by = excluded.by, at = excluded.at, apps = excluded.apps,
        people = excluded.people, you = excluded.you, sampled = excluded.sampled, reason = excluded.reason, seen_at = NULL`
    yield* invalidate(keys.automatedMoves)
  })

/**
 * Puts a conversation in Automated, making the view first if Juno never
 * has (last in the pill row). A view the user deleted is made again only
 * for the user's own Move; for the rules and Juno it stays deleted and
 * nothing is written. A move by the rules or Juno with `why` is recorded
 * for Home once recording has begun. Resolves with whether the
 * conversation is in the view.
 */
export const moveToAutomated = (channel: string, by: SortedBy, now: number, why?: MoveWhy) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const state = yield* automatedViewState
    if (state === 'deleted' && by !== 'you') return false
    const already = (yield* sql<{ n: number }>`SELECT count(*) AS n FROM sidebar_view_channels WHERE view_id = ${AUTOMATED_VIEW_ID} AND channel = ${channel}`)[0]?.n === 1
    if (state !== 'live') {
      const last = (yield* sql<{ position: number | null }>`SELECT max(position) AS position FROM sidebar_views`)[0]?.position ?? -1
      yield* sql`INSERT INTO sidebar_views (id, name, icon, color, position, keep_out_of_all, created_at)
        VALUES (${AUTOMATED_VIEW_ID}, ${AUTOMATED_VIEW.name}, ${AUTOMATED_VIEW.icon}, ${AUTOMATED_VIEW.color}, ${last + 1}, ${AUTOMATED_VIEW.keepOutOfAll ? 1 : 0}, ${String(now)})`
      yield* sql`INSERT OR IGNORE INTO builtin_views (id, made_at) VALUES (${AUTOMATED_VIEW_ID}, ${String(now)})`
    }
    yield* sql`INSERT OR IGNORE INTO sidebar_view_channels (view_id, channel, added_at) VALUES (${AUTOMATED_VIEW_ID}, ${channel}, ${String(now)})`
    yield* setVerdict(channel, 'automated', by, now)
    if (by !== 'you' && why !== undefined && !already && (yield* recording)) yield* recordMove(channel, 'in', by, now, why)
    return true
  })

/** Whether moves into Automated are recorded yet (`RECORD_FROM_PREF`). */
const recording = Effect.gen(function* () {
  const sql = yield* StoreWriter
  return (yield* sql<{ n: number }>`SELECT count(*) AS n FROM prefs WHERE key = ${RECORD_FROM_PREF}`)[0]?.n === 1
})

/** Starts recording moves into Automated, once: a write only the first time. Its own transaction. */
export const startRecording = (now: number): Effect.Effect<void, SqlError, StoreReader | StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if ((yield* prefs.get(RECORD_FROM_PREF)) !== undefined) return
    yield* transaction(prefs.set(RECORD_FROM_PREF, now))
  })

/**
 * The rules took back a conversation they or Juno had put in Automated:
 * people start most conversations there now. It leaves the view, its place
 * is open again (so a later look can move it back in), and the move is
 * recorded for Home.
 */
export const moveBackOut = (channel: string, by: Exclude<SortedBy, 'you'>, now: number, why: MoveWhy) =>
  Effect.gen(function* () {
    yield* leaveAutomated(channel)
    yield* clearVerdict(channel)
    yield* recordMove(channel, 'out', by, now, why)
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
  /** For an open question: who asked and what it stored (`AskedWhy`). */
  readonly by: 'rules' | 'juno' | null
  readonly apps: number | null
  readonly sampled: number | null
  readonly reason: string | null
}

export interface SampleRow {
  readonly ts: string
  readonly user_id: string | null
  readonly subtype: string | null
  readonly text: string
  readonly is_bot: number | null
}

/** Message subtypes people and apps write; joins, topic changes and the like say nothing. A reply also sent to the channel is still a reply. */
const SAID = `(m.subtype IS NULL OR m.subtype IN ('bot_message', 'file_share', 'me_message'))`
/** A top-level message, in the words of the Main index (`messages_main`), so the sample reads through it. */
const TOP_LEVEL = `(m.thread_ts IS NULL OR m.thread_ts = m.ts OR m.subtype = 'thread_broadcast')`

const CANDIDATES = `SELECT c.id, c.kind, c.name, c.topic, u.is_bot AS partner_is_bot, a.verdict, a.by, a.apps, a.sampled, a.reason,
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
      WHERE m.channel = ? AND ${TOP_LEVEL} AND m.deleted = 0 AND ${SAID} ORDER BY m.ts DESC LIMIT ?`,
    params: [channel, AUTOMATED_SAMPLE] as ReadonlyArray<string | number>,
  }),
  moved: () => ({ sql: MOVED, params: [AUTOMATED_VIEW_ID] as ReadonlyArray<string | number> }),
}

/** What the rules and Juno put in Automated and the user has not settled, for the re-check. */
const MOVED = `SELECT c.id, c.kind, c.name, a.by,
    (SELECT max(t.last_activity_ts) FROM topic_index t WHERE t.channel = c.id) AS activity
  FROM sidebar_view_channels vc
  JOIN automated_channels a ON a.channel = vc.channel
  JOIN conversations c ON c.id = vc.channel
  WHERE vc.view_id = ? AND a.verdict = 'automated' AND a.by IN ('rules', 'juno') AND c.kind IN ('public', 'private')`

/** A conversation the rules or Juno moved into Automated. */
export interface MovedRow {
  readonly id: string
  readonly kind: 'public' | 'private'
  readonly name: string | null
  readonly by: 'rules' | 'juno'
  readonly activity: string | null
}

export const movedIn = Effect.gen(function* () {
  const sql = yield* StoreReader
  const statement = automatedStatements.moved()
  return yield* sql.unsafe<MovedRow>(statement.sql, statement.params)
})

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

/**
 * What the rules say about a conversation, with the top-level sample they
 * read and its counts, so a reason quotes the numbers that decided.
 */
export const classify = (row: Pick<Candidate, 'id' | 'kind' | 'name'> & { readonly partner_is_bot?: number | null }, selfId: string | undefined) =>
  Effect.gen(function* () {
    const sample = yield* sampleOf(row.id)
    const messages = sample.map((message) => ({ sender: senderOf(message, selfId) }))
    const verdict: AutomatedVerdict = classifyConversation({ kind: row.kind, name: row.name ?? '', partnerIsApp: row.partner_is_bot === 1, messages })
    const counts = postingCounts(messages)
    return { verdict, sample, counts }
  })

export const selfIdOf = Effect.gen(function* () {
  const sql = yield* StoreReader
  return (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
})

/** One write in its own transaction, telling the sidebar and Home. */
export const write = <A>(effect: Effect.Effect<A, SqlError, StoreWriter | Invalidation>) =>
  transaction(Effect.tap(effect, () => invalidate([...keys.sidebarViews, ...keys.automatedChannels])))

/**
 * The rules alone: clear cases go into the view. Ambiguous ones wait for the
 * job. With `channel`, only that conversation: the first sync sorts each one
 * as its history lands. Rules only ever move a conversation in, and a later
 * look with more names known can only see more apps, so an early look never
 * keeps one out wrongly.
 */
export const sortClearCases = (channel?: string): Effect.Effect<void, SqlError, StoreReader | StoreWriter | Invalidation> => Effect.gen(function* () {
  if ((yield* automatedViewState) === 'deleted') return
  const now = yield* Clock.currentTimeMillis
  const selfId = yield* selfIdOf
  for (const row of yield* candidates(now)) {
    if (channel !== undefined && row.id !== channel) continue
    const { verdict, counts } = yield* classify(row, selfId)
    if (verdict === 'automated') yield* write(moveToAutomated(row.id, 'rules', now, { counts }))
  }
  if (channel === undefined) yield* startRecording(now)
})

/**
 * The first sync's look before any row shows, from what is stored by then:
 * conversation metadata, provisional Main rows and the people of the DMs.
 * A DM with an app moves now. A channel with too few top-level messages to
 * read (on an empty cache, every one) is held out of All until its history
 * is sorted; one an interrupted boot already stored is sorted now. Nothing
 * is held once the user deleted the view, since nothing moves then.
 */
export const holdUndecided: Effect.Effect<void, SqlError, StoreReader | StoreWriter | Invalidation> = Effect.gen(function* () {
  yield* releaseHolds
  if ((yield* automatedViewState) === 'deleted') return
  const now = yield* Clock.currentTimeMillis
  const selfId = yield* selfIdOf
  const held: Array<string> = []
  for (const row of yield* candidates(now)) {
    const { verdict, counts } = yield* classify(row, selfId)
    if (verdict === 'automated') yield* write(moveToAutomated(row.id, 'rules', now, { counts }))
    else if (verdict === 'unknown' && (row.kind === 'public' || row.kind === 'private')) held.push(row.id)
  }
  if (held.length === 0) return
  yield* transaction(Effect.gen(function* () {
    const sql = yield* StoreWriter
    for (const channel of held) yield* sql`INSERT OR IGNORE INTO automated_holds (channel) VALUES (${channel})`
    yield* invalidate(keys.automatedHolds)
  }))
})

/** Sorts one conversation whose history the first sync stored, then lets it into All if it is still held. */
export const sortAndRelease = (channel: string): Effect.Effect<void, SqlError, StoreReader | StoreWriter | Invalidation> =>
  sortClearCases(channel).pipe(Effect.andThen(release(channel)))

const release = (channel: string) =>
  transaction(Effect.gen(function* () {
    const sql = yield* StoreWriter
    const gone = yield* sql<{ channel: string }>`DELETE FROM automated_holds WHERE channel = ${channel} RETURNING channel`
    if (gone.length > 0) yield* invalidate(keys.automatedHolds)
  }))

/** Lets every held channel into All: the cap, the end of the boot, or the start of a new first sync. */
export const releaseHolds: Effect.Effect<void, SqlError, StoreWriter | Invalidation> = transaction(Effect.gen(function* () {
  const sql = yield* StoreWriter
  const gone = yield* sql<{ channel: string }>`DELETE FROM automated_holds RETURNING channel`
  if (gone.length > 0) yield* invalidate(keys.automatedHolds)
}))
