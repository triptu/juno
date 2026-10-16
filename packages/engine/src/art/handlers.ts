/**
 * `art.redraw`: a new drawing for one topic, different from the stored one,
 * in place of it, with the old row as its undo. `art.restore` writes that
 * row back. `art.available` says whether a redraw could draw now, so the
 * topic menu shows Redraw art only then. The job (`job.ts`) draws
 * everything else by itself.
 */
import { AiProvider } from '@juno/ai'
import { AiUnavailable, ArtRoutes, NotFound, NotSignedIn, type StoredArt, type UndoCommand } from '@juno/contract'
import { parseTopicId } from '@juno/domain'
import { StoreReader, type SqlError, type TopicArtRow } from '@juno/store'
import { Clock, Effect } from 'effect'
import { AiPurpose, aiAssistOn, decisionProviderAvailable } from '../ai'
import { AiAudit } from '../aiAudit'
import { AiCredentials } from '../aiCredentials'
import { AiSpend } from '../aiSpend'
import { EngineConfig } from '../config'
import { Workspace, type StoreServices } from '../workspace'
import { ART_SELECT, canDraw, drawTopic, restoreArt, type ArtOutcome } from './draw'
import type { JoinedRow } from '../topicRows'

const topicRow = (id: string): Effect.Effect<{ readonly row: JoinedRow | undefined; readonly art: TopicArtRow | undefined; readonly selfId: string | undefined }, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql.unsafe<JoinedRow>(`${ART_SELECT} WHERE i.topic_id = ?`, [id])
    const art = yield* sql<TopicArtRow>`SELECT * FROM topic_art WHERE topic_id = ${id}`
    const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    return { row: rows[0], art: art[0], selfId: team[0]?.self_user_id ?? undefined }
  })

/** What the renderer says when a redraw made no drawing. */
const UNAVAILABLE: Record<Exclude<ArtOutcome, 'ok' | 'unsure'>, AiUnavailable['reason']> = {
  failed: 'invalid',
  'missing-key': 'no-key',
  timeout: 'timeout',
  'provider-error': 'provider',
  budget: 'budget',
  'no-agent': 'no-agent',
}

/** How long the topic menu waits for the spend ledger before it shows Redraw art anyway. */
const CAP_CHECK_TIMEOUT = '200 millis'

const storedOf = (art: TopicArtRow): StoredArt => ({
  recipe: art.recipe,
  inputHash: art.input_hash,
  model: art.model,
  status: art.status,
  hue: art.hue,
  titleSource: art.title_source,
  source: art.source,
  createdAt: art.created_at,
})

export const ArtHandlers = ArtRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    const audit = yield* AiAudit
    const config = yield* EngineConfig
    const credentials = yield* AiCredentials
    const spend = yield* AiSpend
    /** Today's cap is not reached for a call Redraw makes: a reservation of nothing fits, and is settled at once. */
    const underCap = Effect.gen(function* () {
      // The ungated fake spends nothing, so no cap applies to it.
      if (config.ai === 'fake' && config.fakeAiRequiresKey !== true) return true
      const admission = yield* spend.admit(0).pipe(Effect.timeoutOption(CAP_CHECK_TIMEOUT))
      if (admission._tag === 'None') return true
      if (admission.value._tag === 'Admitted') {
        yield* admission.value.settle(0)
        return true
      }
      // No agent to ask is not the cap; Redraw art then says why it could not draw.
      return admission.value.reason !== 'cap'
    })
    return {
      'art.available': () =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined || !(yield* aiAssistOn.pipe(Effect.provide(open.context)))) return false
          if (!(yield* decisionProviderAvailable.pipe(Effect.provideService(EngineConfig, config), Effect.provideService(AiCredentials, credentials)))) return false
          return yield* underCap
        }),
      'art.redraw': ({ id }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          const parsed = parseTopicId(id)
          if (parsed === undefined) return yield* new NotFound({ kind: 'topic', id })
          // A store failure is a bug, not a state the user can act on (architecture 2.6).
          const local = <A>(effect: Effect.Effect<A, SqlError, StoreServices | AiProvider>): Effect.Effect<A> =>
            effect.pipe(Effect.provide(open.context), Effect.provideService(AiProvider, provider), Effect.orDie)
          if (!(yield* local(aiAssistOn))) {
            yield* audit.record({
              at: yield* Clock.currentTimeMillis, feature: 'topicArt.redraw', subjectKind: 'topic', subjectId: id, provider: '', model: '',
              outcome: 'blocked', kind: 'assist-off', message: '', durationMs: 0, inputTokens: null, outputTokens: null, costUsd: null, summary: '',
            })
            return yield* new AiUnavailable({ reason: 'off' })
          }
          const { row, art, selfId } = yield* local(topicRow(id))
          if (row === undefined || !canDraw(row)) return yield* new NotFound({ kind: 'topic', id })
          const avoid = art === undefined || art.status !== 'ok' ? undefined : { hue: art.hue, summary: `the ${art.hue} drawing shown so far` }
          const outcome = yield* local(drawTopic(row, selfId, { source: 'redraw', ...(avoid === undefined ? {} : { avoid }) })).pipe(
            Effect.provideService(AiPurpose, 'topicArt.redraw'),
          )
          if (outcome !== 'ok' && outcome !== 'unsure') return yield* new AiUnavailable({ reason: UNAVAILABLE[outcome] })
          return { undo: { _tag: 'art.restore', id, previous: art === undefined ? null : storedOf(art) } satisfies UndoCommand }
        }),
      'art.restore': ({ id, previous }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          yield* restoreArt(id, previous).pipe(Effect.provide(open.context), Effect.orDie)
        }),
    }
  }),
)
