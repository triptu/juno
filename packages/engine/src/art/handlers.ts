/**
 * `art.redraw`: a new drawing for one topic, different from the stored one,
 * in place of it. The job (`job.ts`) draws everything else by itself.
 */
import { AiProvider } from '@juno/ai'
import { AiUnavailable, ArtRoutes, NotFound, NotSignedIn } from '@juno/contract'
import { parseTopicId } from '@juno/domain'
import { StoreReader, type SqlError, type TopicArtRow } from '@juno/store'
import { Effect } from 'effect'
import { aiAssistOn } from '../ai'
import { Workspace, type StoreServices } from '../workspace'
import { ART_SELECT, canDraw, drawTopic } from './draw'
import type { JoinedRow } from '../topicRows'

const topicRow = (id: string): Effect.Effect<{ readonly row: JoinedRow | undefined; readonly art: TopicArtRow | undefined; readonly selfId: string | undefined }, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql.unsafe<JoinedRow>(`${ART_SELECT} WHERE i.topic_id = ?`, [id])
    const art = yield* sql<TopicArtRow>`SELECT * FROM topic_art WHERE topic_id = ${id}`
    const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    return { row: rows[0], art: art[0], selfId: team[0]?.self_user_id ?? undefined }
  })

export const ArtHandlers = ArtRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    return {
      'art.redraw': ({ id }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          const parsed = parseTopicId(id)
          if (parsed === undefined || parsed.kind === 'group') return yield* new NotFound({ kind: 'topic', id })
          // A store failure is a bug, not a state the user can act on (architecture 2.6).
          const local = <A>(effect: Effect.Effect<A, SqlError, StoreServices | AiProvider>): Effect.Effect<A> =>
            effect.pipe(Effect.provide(open.context), Effect.provideService(AiProvider, provider), Effect.orDie)
          if (!(yield* local(aiAssistOn))) return yield* new AiUnavailable({ reason: 'off' })
          const { row, art, selfId } = yield* local(topicRow(id))
          if (row === undefined || !canDraw(row)) return yield* new NotFound({ kind: 'topic', id })
          const avoid = art === undefined || art.status !== 'ok' ? undefined : { hue: art.hue, summary: `the ${art.hue} drawing shown so far` }
          const outcome = yield* local(drawTopic(row, selfId, { source: 'redraw', ...(avoid === undefined ? {} : { avoid }) }))
          if (outcome === 'ok' || outcome === 'unsure' || outcome === 'failed') return
          return yield* new AiUnavailable({ reason: 'provider' })
        }),
    }
  }),
)
