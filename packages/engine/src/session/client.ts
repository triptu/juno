/**
 * `SessionClient` from the session: the ready session's `SlackApi`.
 */
import { Context, Effect, Layer } from 'effect'
import { SlackApi } from '@juno/slack'
import { SessionClient } from '../sessionClient'
import { Session } from './Session'

export const SessionClientLive: Layer.Layer<SessionClient, never, Session> = Layer.effect(
  SessionClient,
  Effect.gen(function* () {
    const session = yield* Session
    return SessionClient.of({ api: Effect.map(session.active, (active) => Context.get(active.context, SlackApi)) })
  }),
)
