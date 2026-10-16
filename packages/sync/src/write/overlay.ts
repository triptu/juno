import {
  compareTs,
} from '@juno/domain'
import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'

// Overlay

interface OverlayRow {
  readonly resolved_at: string | null
  readonly resolved_activity_ts: string | null
}

/** Activity after a resolve clears it and sets the Reopened tag (architecture 4.4). */
export const reopenIfResolved = (topicId: string, activityTs: string, now: number): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<OverlayRow>`SELECT resolved_at, resolved_activity_ts FROM topic_overlay WHERE topic_id = ${topicId}`
    const row = rows[0]
    if (row === undefined || row.resolved_at === null) return
    if (row.resolved_activity_ts !== null && compareTs(activityTs, row.resolved_activity_ts) <= 0) return
    yield* sql`UPDATE topic_overlay SET resolved_at = NULL, resolved_activity_ts = NULL, reopened_at = ${String(now)} WHERE topic_id = ${topicId}`
    yield* invalidate(syncKeys.overlay(topicId))
  })

/**
 * The overlay columns a command changes, as stored. A key that is present
 * sets its column; `null` clears it. The undo of a change is the patch of
 * the same keys with the values from before it.
 */
export interface OverlayPatch {
  readonly manualTitle?: string | null
  readonly resolvedAt?: string | null
  readonly resolvedActivityTs?: string | null
  readonly reopenedAt?: string | null
  readonly pinnedAt?: string | null
}

const overlayColumns = {
  manualTitle: 'manual_title',
  resolvedAt: 'resolved_at',
  resolvedActivityTs: 'resolved_activity_ts',
  reopenedAt: 'reopened_at',
  pinnedAt: 'pinned_at',
} as const satisfies Record<keyof OverlayPatch, string>

type OverlayKey = keyof typeof overlayColumns
type StoredOverlay = Record<OverlayKey, string | null>

/** The topic's overlay columns that commands change, all null when it has no row. */
export const readOverlay = (topicId: string): Effect.Effect<StoredOverlay, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<Record<(typeof overlayColumns)[OverlayKey], string | null>>`
      SELECT manual_title, resolved_at, resolved_activity_ts, reopened_at, pinned_at FROM topic_overlay WHERE topic_id = ${topicId}`
    const row = rows[0]
    return {
      manualTitle: row?.manual_title ?? null,
      resolvedAt: row?.resolved_at ?? null,
      resolvedActivityTs: row?.resolved_activity_ts ?? null,
      reopenedAt: row?.reopened_at ?? null,
      pinnedAt: row?.pinned_at ?? null,
    }
  })

/**
 * Applies `patch` to the topic's overlay and returns the patch that undoes
 * it, or `undefined` when nothing changed.
 */
export const patchOverlay = (topicId: string, patch: OverlayPatch): Effect.Effect<OverlayPatch | undefined, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const before = yield* readOverlay(topicId)
    const undo: Partial<Record<OverlayKey, string | null>> = {}
    const after: StoredOverlay = { ...before }
    for (const key of Object.keys(overlayColumns) as OverlayKey[]) {
      const value = patch[key]
      if (value === undefined || value === before[key]) continue
      undo[key] = before[key]
      after[key] = value
    }
    if (Object.keys(undo).length === 0) return undefined
    const sql = yield* StoreWriter
    yield* sql`
      INSERT INTO topic_overlay (topic_id, manual_title, resolved_at, resolved_activity_ts, reopened_at, pinned_at)
      VALUES (${topicId}, ${after.manualTitle}, ${after.resolvedAt}, ${after.resolvedActivityTs}, ${after.reopenedAt}, ${after.pinnedAt})
      ON CONFLICT (topic_id) DO UPDATE SET manual_title = excluded.manual_title, resolved_at = excluded.resolved_at,
        resolved_activity_ts = excluded.resolved_activity_ts, reopened_at = excluded.reopened_at, pinned_at = excluded.pinned_at`
    yield* invalidate(syncKeys.overlay(topicId))
    return undo
  })
