/**
 * `SessionClient` from the session: the ready session's `SlackApi` and workspace url.
 */
import { Context, Effect, Layer } from 'effect'
import { NotSignedIn } from '@juno/contract'
import { SlackApi } from '@juno/slack'
import { SessionClient } from '../sessionClient'
import { Session } from './Session'

export const SessionClientLive: Layer.Layer<SessionClient, never, Session> = Layer.effect(
  SessionClient,
  Effect.gen(function* () {
    const session = yield* Session
    return SessionClient.of({
      api: Effect.map(session.active, (active) => Context.get(active.context, SlackApi)),
      // The url the renderer reads its Slack links against, so a link made here opens in Juno.
      workspaceUrl: Effect.flatMap(session.status, (status) => (status._tag === 'ready' ? Effect.succeed(status.workspaceUrl) : Effect.fail(new NotSignedIn()))),
    })
  }),
)
