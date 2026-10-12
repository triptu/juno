/**
 * The signed-in session (architecture 2.3, 14, 16 M2).
 *
 * The engine owns the state machine; main does the Electron work on request
 * (`HostLink`). At start the engine asks main for the stored secrets and
 * verifies them with `auth.test`. A sign-in or import asks main to capture a
 * session, verifies it the same way, and only then tells main to store it,
 * so `secrets.bin` never holds a session Slack has not accepted.
 *
 * While `ready`, the Slack client for that session lives in its own scope:
 * `SlackApi`, `SlackEdge` and `SlackSocket` built on the handed-over
 * secrets. The socket runs for the life of the session; its only failure is
 * `SlackAuthRequired` (a fatal auth error or `user_session_expiration`),
 * which moves the session to `authRequired`, closes the scope and tells
 * main. Local data stays; a new sign-in replaces the secrets.
 *
 * Sign-out closes the scope, has main delete the secrets and clear the
 * `persist:slack` cookies, and deletes the workspace's `cache.db`.
 */
import { rm } from 'node:fs/promises'
import { Context, Effect, Exit, Fiber, Layer, Ref, Scope, Stream, SubscriptionRef } from 'effect'
import { NotSignedIn, SignInFailed, type MainToEngine, type SessionSecrets, type SessionStatus, type SignInMethod } from '@juno/contract'
import {
  HttpTransport,
  SlackApi,
  SlackClient,
  SlackSession,
  SlackSocket,
  slackConfigLayer,
  SocketHandshake,
  type SlackApiShape,
  type SlackSessionShape,
} from '@juno/slack'
import { workspacePaths } from '@juno/store'
import { EngineConfig } from '../config'
import { HostLink } from '../host/Host'
import { Status } from '../status/Status'
import { hostHandshake } from './handshake'

interface Active {
  readonly secrets: SessionSecrets
  readonly scope: Scope.Closeable
  readonly api: SlackApiShape
  /** `enterprise_id` as `auth.test` reported it (Grid detection, architecture 12). */
  readonly workspaceId: string
}

export class Session extends Context.Service<
  Session,
  {
    readonly status: Effect.Effect<SessionStatus>
    /** The current status at subscribe time, then every change. */
    readonly statuses: Stream.Stream<SessionStatus>
    readonly signIn: (method: SignInMethod) => Effect.Effect<void, SignInFailed>
    readonly signOut: Effect.Effect<void>
    /** The Slack API of the current session, for the features that come after M2. */
    readonly api: Effect.Effect<SlackApiShape, NotSignedIn>
  }
>()('juno/engine/Session') {
  static readonly layer: Layer.Layer<Session, never, HostLink | EngineConfig | Status | HttpTransport> = Layer.effect(
    Session,
    Effect.gen(function* () {
      const host = yield* HostLink
      const config = yield* EngineConfig
      const status = yield* Status
      const transport = yield* HttpTransport
      const serviceScope = yield* Effect.scope
      const state = yield* SubscriptionRef.make<SessionStatus>({ _tag: 'signedOut' })
      const active = yield* Ref.make<Active | undefined>(undefined)

      const setStatus = (next: SessionStatus) =>
        Effect.gen(function* () {
          yield* SubscriptionRef.set(state, next)
          const phase =
            next._tag === 'ready' ? ({ _tag: 'live' } as const)
            : next._tag === 'authRequired' ? ({ _tag: 'session-expired' } as const)
            : ({ _tag: 'first-run' } as const)
          yield* status.setPhase(phase)
        })

      const slackLayer = (secrets: SessionSecrets) =>
        SlackClient.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              SlackSession.layer(toSlackSession(secrets)),
              Layer.succeed(HttpTransport, transport),
              Layer.succeed(SocketHandshake, hostHandshake(host)),
              slackConfigLayer(
                config.fakeSlackUrl === undefined ? {} : { socket: { allowedHosts: ['slack.com', new URL(config.fakeSlackUrl).hostname] } },
              ),
            ),
          ),
        )

      /** Closes the current session's scope, if any. */
      const closeActive = Effect.gen(function* () {
        const current = yield* Ref.getAndSet(active, undefined)
        if (current !== undefined) yield* Scope.close(current.scope, Exit.void)
      })

      const authRequired = (reason: string) =>
        Effect.gen(function* () {
          yield* closeActive
          yield* setStatus({ _tag: 'authRequired', reason })
          yield* host.send({ _tag: 'authRequired', reason })
        })

      /** Watches the socket for the life of the session; a fatal auth condition ends the session. */
      const watch = (context: Context.Context<SlackSocket>, scope: Scope.Closeable) =>
        Effect.gen(function* () {
          const socket = Context.get(context, SlackSocket)
          const events = yield* socket.events
          yield* Stream.runDrain(events)
        }).pipe(
          Effect.catchTag('SlackAuthRequired', (error) => authRequired(error.error)),
          Scope.provide(scope),
          Effect.forkIn(scope),
        )

      /**
       * Builds the client for `secrets`, calls `auth.test` and, on success,
       * makes it the active session. Fails with the error `auth.test` gave;
       * the client scope is closed on any failure.
       */
      const activate = (secrets: SessionSecrets) =>
        Effect.gen(function* () {
          const scope = yield* Scope.make()
          const context = yield* Layer.buildWithScope(slackLayer(secrets), scope).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
          const api = Context.get(context, SlackApi)
          const result = yield* Effect.result(api.call('auth.test', {}, { lane: 'interactive', reason: 'session' }))
          if (result._tag === 'Failure') {
            yield* Scope.close(scope, Exit.void)
            return yield* result.failure
          }
          const auth = result.success
          const enterpriseId = auth.enterprise_id ?? secrets.enterprise?.id
          yield* closeActive
          yield* Ref.set(active, { secrets, scope, api, workspaceId: enterpriseId ?? auth.team_id })
          yield* setStatus({
            _tag: 'ready',
            teamId: auth.team_id,
            teamName: auth.team,
            userId: auth.user_id,
            userName: auth.user,
            ...(enterpriseId === undefined ? {} : { enterprise: { id: enterpriseId, ...(secrets.enterprise?.name === undefined ? {} : { name: secrets.enterprise.name }) } }),
          })
          yield* watch(context, scope)
        })

      /** Sends `request` and waits for main's `secrets` or `sessionFailed` answer. */
      const askHost = (request: 'requestSecrets' | 'signIn' | 'importFromSlackApp') =>
        Effect.scoped(
          Effect.gen(function* () {
            const messages = yield* host.messages
            const answer = yield* Effect.forkScoped(
              Stream.runHead(Stream.filter(messages, (m): m is SessionAnswer => m._tag === 'secrets' || m._tag === 'sessionFailed')),
            )
            yield* host.send({ _tag: request })
            const value = yield* Fiber.join(answer)
            return value._tag === 'None' ? undefined : value.value
          }),
        )

      const start = Effect.gen(function* () {
        const answer = yield* askHost('requestSecrets')
        if (answer === undefined || answer._tag !== 'secrets' || answer.secrets === null) return yield* setStatus({ _tag: 'signedOut' })
        const result = yield* Effect.result(activate(answer.secrets))
        if (result._tag === 'Success') return
        const error = result.failure
        if (error._tag === 'SlackAuthRequired') return yield* authRequired(error.error)
        // Slack could not be reached or answered oddly: keep the session on file and show what we know.
        yield* Effect.logWarning('session: auth.test failed at start', { tag: error._tag })
        yield* setStatus({
          _tag: 'ready',
          teamId: answer.secrets.teamId,
          teamName: answer.secrets.teamName ?? answer.secrets.teamDomain ?? answer.secrets.teamId,
          userId: answer.secrets.userId,
          userName: answer.secrets.userId,
          ...(answer.secrets.enterprise === undefined ? {} : { enterprise: { id: answer.secrets.enterprise.id } }),
        })
      })

      const signIn = (method: SignInMethod) =>
        Effect.gen(function* () {
          const before = yield* SubscriptionRef.get(state)
          if (before._tag === 'signingIn') return yield* new SignInFailed({ kind: 'other', message: 'A sign-in is already in progress.' })
          const restore = setStatus(before)
          yield* setStatus({ _tag: 'signingIn', method })
          const answer = yield* askHost(method === 'window' ? 'signIn' : 'importFromSlackApp')
          if (answer === undefined) {
            yield* restore
            return yield* new SignInFailed({ kind: 'other', message: 'The app closed before the sign-in finished.' })
          }
          if (answer._tag === 'sessionFailed') {
            yield* restore
            return yield* new SignInFailed({ kind: answer.kind, message: answer.message })
          }
          if (answer.secrets === null) {
            yield* restore
            return yield* new SignInFailed({ kind: 'no-token', message: 'No session was found.' })
          }
          const result = yield* Effect.result(activate(answer.secrets))
          if (result._tag === 'Failure') {
            yield* restore
            const error = result.failure
            return yield* new SignInFailed(
              error._tag === 'SlackAuthRequired'
                ? { kind: 'rejected', message: `Slack rejected the session (${error.error}).` }
                : error._tag === 'SlackTransportError'
                  ? { kind: 'offline', message: 'Slack could not be reached to check the session.' }
                  : { kind: 'other', message: `Slack answered unexpectedly (${error._tag}).` },
            )
          }
          yield* host.send({ _tag: 'storeSecrets', secrets: answer.secrets })
        })

      const signOut = Effect.scoped(
        Effect.gen(function* () {
          const current = yield* Ref.get(active)
          yield* closeActive
          const messages = yield* host.messages
          const done = yield* Effect.forkScoped(Stream.runHead(Stream.filter(messages, (m) => m._tag === 'signedOut')))
          yield* host.send({ _tag: 'signOut' })
          yield* Fiber.join(done)
          if (current !== undefined) {
            const paths = workspacePaths(config.userData, current.workspaceId)
            yield* Effect.promise(() => rm(paths.cacheDb, { force: true }))
            yield* Effect.promise(() => rm(`${paths.cacheDb}-wal`, { force: true }))
            yield* Effect.promise(() => rm(`${paths.cacheDb}-shm`, { force: true }))
          }
          yield* setStatus({ _tag: 'signedOut' })
        }),
      )

      const api = Effect.gen(function* () {
        const current = yield* Ref.get(active)
        if (current === undefined) return yield* new NotSignedIn()
        return current.api
      })

      yield* Effect.forkIn(start, serviceScope)
      yield* Scope.addFinalizer(serviceScope, closeActive)

      return Session.of({
        status: SubscriptionRef.get(state),
        statuses: SubscriptionRef.changes(state),
        signIn,
        signOut,
        api,
      })
    }),
  )
}

type SessionAnswer = Extract<MainToEngine, { _tag: 'secrets' | 'sessionFailed' }>

function toSlackSession(secrets: SessionSecrets): SlackSessionShape {
  return {
    teamId: secrets.teamId,
    userId: secrets.userId,
    workspaceUrl: secrets.workspaceUrl,
    token: secrets.token,
    ...(secrets.enterprise === undefined
      ? {}
      : {
          enterprise: {
            id: secrets.enterprise.id,
            ...(secrets.enterprise.token === undefined ? {} : { token: secrets.enterprise.token }),
            ...(secrets.enterprise.name === undefined ? {} : { name: secrets.enterprise.name }),
          },
        }),
  }
}
