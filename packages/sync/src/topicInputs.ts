/**
 * Which `topic_index` rows are up to date, so `reindexTopics` keeps a row
 * without computing it again while nothing it is computed from has changed.
 *
 * `topic_inputs` in cache.db holds a marker per up-to-date topic. Triggers
 * delete it when anything the row is computed from changes in cache.db
 * (store migration `topic_inputs`). The rest is kept in the marker and
 * compared each time: the rule's version, the user the row was computed for,
 * and the topic's read state and Juno's own posts Slack has not stored yet
 * (`pending_messages`), which live in user.db, out of the triggers' reach.
 * A row that looked for a person or user group not stored gets no marker
 * (`reindex.ts`), so a marked row only ever read stored ones, and storing a
 * new one cannot change it.
 */
import type { Me, ReadState } from '@juno/domain'
import { StoreWriter, type SqlError, type TopicIndexRow } from '@juno/store'
import { Effect } from 'effect'
import { INDEX_VERSION } from './indexVersion'

export interface TopicInputs {
  readonly context: string
  readonly reads: string
}

/** `pending` is what the row reads of the topic's pending posts; a topic with none keeps the marker it had before pending posts counted. */
export const topicInputs = (me: Me, reads: ReadState, pending: ReadonlyArray<unknown> = []): TopicInputs => ({
  context: `${INDEX_VERSION} ${JSON.stringify(me)}`,
  reads: pending.length === 0 ? JSON.stringify(reads) : `${JSON.stringify(reads)} ${JSON.stringify(pending)}`,
})

/** The topic's stored row, and whether it was computed from `inputs` with nothing changed since. */
export const storedRow = (
  id: string,
  inputs: TopicInputs,
): Effect.Effect<{ readonly row: TopicIndexRow | undefined; readonly upToDate: boolean }, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const found = (yield* sql<TopicIndexRow & { readonly inputs_context: string | null; readonly inputs_reads: string | null }>`
      SELECT t.*, i.context AS inputs_context, i.reads AS inputs_reads FROM topic_index t
        LEFT JOIN topic_inputs i ON i.topic_id = t.topic_id WHERE t.topic_id = ${id}`)[0]
    if (found === undefined) return { row: undefined, upToDate: false }
    const { inputs_context: context, inputs_reads: reads, ...row } = found
    return { row, upToDate: context === inputs.context && reads === inputs.reads }
  })

/** Records that the topic's stored row is up to date with `inputs`. */
export const markUpToDate = (id: string, inputs: TopicInputs): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO topic_inputs (topic_id, context, reads) VALUES (${id}, ${inputs.context}, ${inputs.reads})
      ON CONFLICT (topic_id) DO UPDATE SET context = excluded.context, reads = excluded.reads`
  })
