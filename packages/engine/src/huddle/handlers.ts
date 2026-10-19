/**
 * Handlers for the huddle routes. The `Huddle` service maps Slack's errors
 * to the contract's; a start with no workspace open is `NotSignedIn`.
 */
import { Effect, Result, Stream } from 'effect'
import { HuddleRoutes, NotSignedIn } from '@juno/contract'
import { Huddle } from '@juno/huddle'
import { EngineConfig } from '../config'
import { serveLiveValue } from '../protocol/live'
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
      'huddle.start': ({ channelId, region, generation }) =>
        Effect.gen(function* () {
          if ((yield* workspace.current) === undefined) return yield* new NotSignedIn()
          return yield* huddle.start(channelId, region, generation)
        }),
      'huddle.leave': () => huddle.leave,
      'huddle.report': ({ report }) => huddle.report(report),
    }
  }),
)
