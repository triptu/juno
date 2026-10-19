/**
 * Handlers for the huddle routes. The `Huddle` service maps Slack's errors
 * to the contract's; a start with no workspace open is `NotSignedIn`.
 */
import { Effect, Result, Stream } from 'effect'
import { HuddleRoutes, NotSignedIn } from '@juno/contract'
import { Huddle } from '@juno/huddle'
import { StoreReader } from '@juno/store'
import { EngineConfig } from '../config'
import { serveLiveValue, serveWorkspaceValue } from '../protocol/live'
import { personFrom, type UserRow } from '../topicRows'
import { Workspace } from '../workspace'

const runs = <A>(values: Stream.Stream<A>) => values.pipe(Stream.map((value) => Result.succeed({ value, queryMs: 0 })))

export const HuddleHandlers = HuddleRoutes.toLayer(
  Effect.gen(function* () {
    const huddle = yield* Huddle
    const workspace = yield* Workspace
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    return {
      'huddle.call': () => serveLiveValue(runs(huddle.call), { measure }),
      'huddle.running': () => serveLiveValue(runs(huddle.running), { measure }),
      // The RPC client id is the page's engine connection: a new port gets a higher one.
      'huddle.start': ({ channelId, region, generation }, { client }) =>
        Effect.gen(function* () {
          if ((yield* workspace.current) === undefined) return yield* new NotSignedIn()
          return yield* huddle.start(channelId, region, generation, client.id)
        }),
      'huddle.leave': () => huddle.leave,
      'huddle.report': ({ report }, { client }) => huddle.report(report, client.id),
      'huddle.people': ({ ids }) => serveWorkspaceValue(workspace.changes, 'huddle.people', ['users'], Effect.gen(function* () {
        if (ids.length === 0) return []
        const sql = yield* StoreReader
        const rows = yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in(ids)}`
        const byId = new Map(rows.map((row) => [row.id, row]))
        return ids.map((id) => personFrom(id, byId.get(id)))
      })),
    }
  }),
)
