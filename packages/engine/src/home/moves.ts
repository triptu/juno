/**
 * Automated's record on Home (SPEC 12, "Automated's record"): the moves the
 * rules and Juno made (`automated_moves`, written by `automatedView.ts`) that
 * Home has not shown yet, where the conversation is still where the move put
 * it and the user has not settled it since. The card shows at most once a
 * day: `home.movesSeen` marks the moves seen and keeps the time in
 * `MOVES_SEEN_PREF`.
 */
import { AUTOMATED_VIEW_ID, automatedReason, movedBackReason } from '@juno/domain'
import { prefs, StoreReader, type SqlError } from '@juno/store'
import { Effect } from 'effect'

/** The most moves the card lists. */
const MOVES_SHOWN = 20
const DAY = 24 * 60 * 60 * 1000
/** When Home last showed the record card, epoch millis. The card waits a day after it. */
export const MOVES_SEEN_PREF = 'automatedMovesSeenAt'

/** A move, as stored. */
export interface MoveRow {
  readonly channel: string
  readonly change: 'in' | 'out'
  readonly by: 'rules' | 'juno'
  readonly at: string
  readonly apps: number | null
  readonly people: number | null
  readonly you: number | null
  readonly sampled: number | null
  readonly reason: string | null
}

/** The statement, so the plan test can check it uses an index. */
export const movesStatements = {
  unseen: () => ({
    sql: `SELECT mv.channel, mv.change, mv.by, mv.at, mv.apps, mv.people, mv.you, mv.sampled, mv.reason FROM automated_moves mv
      WHERE mv.seen_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM automated_channels a WHERE a.channel = mv.channel AND a.by = 'you')
        AND (mv.change = 'in') = EXISTS (SELECT 1 FROM sidebar_view_channels vc WHERE vc.channel = mv.channel AND vc.view_id = ?)
      ORDER BY mv.at DESC LIMIT ?`,
    params: [AUTOMATED_VIEW_ID, MOVES_SHOWN] as ReadonlyArray<string | number>,
  }),
}

/** The card's title: "Juno moved 2 channels to Automated", "… out of Automated", or both. */
export function movesTitle(moves: ReadonlyArray<{ readonly change: 'in' | 'out' }>): string {
  const ins = moves.filter((move) => move.change === 'in').length
  const outs = moves.length - ins
  const channels = (n: number) => (n === 1 ? '1 channel' : `${n} channels`)
  if (outs === 0) return `Juno moved ${channels(ins)} to Automated`
  if (ins === 0) return `Juno moved ${channels(outs)} out of Automated`
  return `Juno moved ${channels(ins)} to Automated and ${outs} back`
}

/** A move's lines, from the counts that decided it, and Juno's own reason when Juno decided. */
export function moveLines(move: MoveRow): { readonly reason: string; readonly detail?: string } {
  if (move.change === 'out') {
    const back = movedBackReason({ people: move.people ?? 0, you: move.you ?? 0, of: move.sampled ?? 0 })
    return { reason: back.line, ...(back.detail === undefined ? {} : { detail: back.detail }) }
  }
  // Juno's clause as it gave it, marked as Juno's, as Tidy up marks one.
  const juno = move.by === 'juno' ? move.reason?.trim().replace(/[.\s]+$/, '') : undefined
  return {
    reason: automatedReason({ apps: move.apps, of: move.sampled }) ?? 'Apps write most of its top-level messages',
    ...(juno === undefined || juno === '' ? {} : { detail: `Juno: ${juno}` }),
  }
}

/**
 * The card's moves with their channels' Mains (read by `mains`, which keeps
 * only open ones), or undefined when there is nothing to show or the card
 * showed less than a day ago.
 */
export const readMoves = <R extends { readonly channel: string; readonly topic_id: string }>(
  now: number,
  mains: (channels: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<R>, SqlError, StoreReader>,
) =>
  Effect.gen(function* () {
    const seenAt = yield* prefs.get<number>(MOVES_SEEN_PREF).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (typeof seenAt === 'number' && now - seenAt < DAY) return undefined
    const sql = yield* StoreReader
    const statement = movesStatements.unseen()
    const moves = yield* sql.unsafe<MoveRow>(statement.sql, statement.params)
    if (moves.length === 0) return undefined
    const found = yield* mains(moves.map((move) => move.channel))
    const byTopic = new Map<string, MoveRow>()
    const rows: Array<R> = []
    for (const move of moves) {
      const main = found.find((row) => row.channel === move.channel)
      if (main === undefined) continue
      byTopic.set(main.topic_id, move)
      rows.push(main)
    }
    if (rows.length === 0) return undefined
    return { title: movesTitle([...byTopic.values()]), rows, moves: byTopic as ReadonlyMap<string, MoveRow> }
  })
