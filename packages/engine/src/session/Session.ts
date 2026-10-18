/**
 * The signed-in session (architecture 2.3, 14, 16 M2).
 *
 * The engine owns the state machine; main does the Electron work on request
 * (`HostLink`). At start the engine asks main for the stored secrets, opens
 * the workspace store (so the first live query is answered from the cache)
 * and verifies the secrets with `auth.test`; the status is `starting` until
 * that settles, so the renderer can tell a check in progress from no session. A sign-in or import asks main
 * to capture a session, verifies it the same way, and only then tells main
 * to store it, so `secrets.bin` never holds a session Slack has not
 * accepted.
 *
 * While `ready`, the Slack client for that session lives in its own scope:
 * `SlackApi`, `SlackEdge`, `SlackSocket` and `RequestQueue` built on the
 * handed-over secrets. `active` hands that context and its scope to the
 * sync runner, which runs the socket and the sync inside the scope; a fatal
 * auth condition reaches `expire`, which closes the scope, moves the status
 * to `authRequired` and tells main. Local data stays; a new sign-in replaces
 * the secrets.
 *
 * Sign-out closes the scope (which ends the sync), closes the store, has
 * main delete the secrets and clear the `persist:slack` cookies, and deletes
 * the workspace's `cache.db`.
 *
 * The engine phase (`first-run`, boot phases, `live`, `session-expired`)
 * follows the session status and the sync; the composition layer wires that
 * (`layer.ts`), so this folder depends on no other feature.
 */
import { rm } from 'node:fs/promises'
import { Context, Effect, Exit, Fiber, Layer, Ref, Scope, Stream, SubscriptionRef } from 'effect'
import { NotSignedIn, SignInFailed, type MainToEngine, type SessionSecrets, type SessionStatus, type SignInMethod } from '@juno/contract'
import {
  HttpTransport,
  RequestQueue,
  SlackApi,
  SlackClient,
  SlackEdge,
  SlackSession,
  SlackSocket,
  scaledPacing,
  slackConfigLayer,
  SocketHandshake,
  type SlackSessionShape,
} from '@juno/slack'
import { EngineConfig, EngineTiming } from '../config'
import { HostLink } from '../protocol/host'
import { Workspace } from '../workspace'
import { hostHandshake } from './handshake'

export type SlackServices = SlackApi | SlackEdge | SlackSocket | RequestQueue | SlackSession

/** The Slack client of the ready session and the scope it lives in. Work forked into the scope ends with the session. */
export interface ActiveSession {
  readonly secrets: SessionSecrets
  readonly scope: Scope.Closeable
  readonly context: Context.Context<SlackServices>
  /**
   * The workspace directory key: the team id, prefixed with the
   * `enterprise_id` on Grid (`E…-T…`), so two teams of one org never share
   * a `cache.db` (architecture 12).
   */
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
    /** The Slack client of the current session. */
    readonly active: Effect.Effect<ActiveSession, NotSignedIn>
    /** Slack no longer accepts the session: close it, keep local data, ask for a sign-in. */
    readonly expire: (reason: string) => Effect.Effect<void>
  }
>()('juno/engine/Session') {
  static readonly layer: Layer.Layer<Session, never, HostLink | EngineConfig | HttpTransport | Workspace> = Layer.effect(
    Session,
    Effect.gen(function* () {
      const host = yield* HostLink
      const config = yield* EngineConfig
      const timing = yield* EngineTiming
      const transport = yield* HttpTransport
      const workspace = yield* Workspace
      const serviceScope = yield* Effect.scope
      const state = yield* SubscriptionRef.make<SessionStatus>({ _tag: 'starting' })
      const active = yield* Ref.make<ActiveSession | undefined>(undefined)

      /** A ready status also goes to main, which keeps it so the next launch opens on the shell. */
      const setStatus = (next: SessionStatus) =>
        SubscriptionRef.set(state, next).pipe(Effect.andThen(next._tag === 'ready' ? host.send({ _tag: 'sessionReady', session: next }) : Effect.void))

      const slackLayer = (secrets: SessionSecrets) =>
        SlackClient.layer.pipe(
          Layer.provideMerge(SlackSession.layer(toSlackSession(secrets))),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(HttpTransport, transport),
              Layer.succeed(SocketHandshake, hostHandshake(host)),
              slackConfigLayer({
                transientBackoffMillis: timing.slackRetryBaseMillis,
                transientBackoffCapMillis: timing.slackRetryCapMillis,
                socket: {
                  pingIntervalMillis: timing.socketPingMillis, pongTimeoutMillis: timing.socketPongTimeoutMillis,
                  helloTimeoutMillis: timing.socketHelloTimeoutMillis, backoffBaseMillis: timing.socketBackoffBaseMillis,
                  backoffCapMillis: timing.socketBackoffCapMillis, tickleSpacingMillis: timing.socketTickleMillis,
                  ...(config.fakeSlackUrl === undefined ? {} : { allowedHosts: ['slack.com', new URL(config.fakeSlackUrl).hostname] }),
                },
                // The fake has no rate limits; performance tests opt into request pacing.
                ...(config.fakeSlackUrl === undefined ? {} : config.fakeSlackPaced !== true
                  ? { lanes: { backgroundMinIntervalMillis: 0, interactiveRefillIntervalMillis: 0 } }
                  : config.fakeSlackPaceScale === undefined ? {} : { lanes: scaledPacing(config.fakeSlackPaceScale) }),
              }),
            ),
          ),
        )

      /** Closes the current session's scope, if any. Work forked into it (the sync, the socket) ends here. */
      const closeActive = Effect.gen(function* () {
        const current = yield* Ref.getAndSet(active, undefined)
        if (current !== undefined) yield* Scope.close(current.scope, Exit.void)
      })

      const expire = (reason: string) =>
        Effect.gen(function* () {
          yield* closeActive
          yield* setStatus({ _tag: 'authRequired', reason })
          yield* host.send({ _tag: 'authRequired', reason })
        })

      /**
       * Builds the client for `secrets`, calls `auth.test` and, on success,
       * makes it the active session. Fails with the error `auth.test` gave;
       * the client scope is closed on any failure.
       */
      const activate = (secrets: SessionSecrets, beforeReady: Effect.Effect<void, SignInFailed> = Effect.void) =>
        Effect.gen(function* () {
          yield* workspace.open(workspaceIdOf(secrets)).pipe(Effect.orDie)
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
          const workspaceId = workspaceKey(enterpriseId, auth.team_id)
          yield* closeActive
          if (workspaceId !== workspaceIdOf(secrets)) yield* workspace.open(workspaceId).pipe(Effect.orDie)
          yield* Ref.set(active, { secrets, scope, context, workspaceId })
          yield* beforeReady.pipe(Effect.onError(() => closeActive))
          yield* setStatus({
            _tag: 'ready',
            teamId: auth.team_id,
            teamName: auth.team,
            userId: auth.user_id,
            userName: auth.user,
            workspaceUrl: auth.url,
            ...(enterpriseId === undefined ? {} : { enterprise: { id: enterpriseId, ...(secrets.enterprise?.name === undefined ? {} : { name: secrets.enterprise.name }) } }),
          })
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
        if (error._tag === 'SlackAuthRequired') return yield* expire(error.error)
        // Slack could not be reached or answered oddly: keep the session on file and show what we know.
        yield* Effect.logWarning('session: auth.test failed at start', { tag: error._tag })
        yield* setStatus({
          _tag: 'ready',
          teamId: answer.secrets.teamId,
          teamName: answer.secrets.teamName ?? answer.secrets.teamDomain ?? answer.secrets.teamId,
          userId: answer.secrets.userId,
          userName: answer.secrets.userId,
          workspaceUrl: answer.secrets.workspaceUrl,
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
            return yield* new SignInFailed({ kind: answer.kind, message: answer.message, ...(answer.details === undefined ? {} : { details: answer.details }) })
          }
          if (answer.secrets === null) {
            yield* restore
            return yield* new SignInFailed({ kind: 'no-token', message: 'No session was found.' })
          }
          const secrets = answer.secrets
          const result = yield* Effect.result(activate(secrets, Effect.scoped(Effect.gen(function* () {
            const messages = yield* host.messages
            const storedAnswer = yield* Effect.forkScoped(
              Stream.runHead(Stream.filter(messages, (m): m is Extract<MainToEngine, { _tag: 'secretsStored' | 'sessionFailed' }> => m._tag === 'secretsStored' || m._tag === 'sessionFailed')),
            )
            yield* host.send({ _tag: 'storeSecrets', method, secrets })
            const stored = yield* Fiber.join(storedAnswer)
            if (stored._tag === 'None') return yield* new SignInFailed({ kind: 'other', message: 'Juno could not save the Slack session. Try signing in again.' })
            if (stored.value._tag === 'sessionFailed') return yield* new SignInFailed({ kind: stored.value.kind, message: stored.value.message })
            return yield* Effect.void
          }))))
          if (result._tag === 'Failure') {
            yield* restore
            const error = result.failure
            if (error._tag === 'SignInFailed') return yield* error
            return yield* new SignInFailed(
              error._tag === 'SlackAuthRequired'
                ? { kind: 'rejected', message: `Slack rejected the session (${error.error}).` }
                : error._tag === 'SlackTransportError'
                  ? { kind: 'offline', message: 'Slack could not be reached to check the session.' }
                  : { kind: 'other', message: `Slack answered unexpectedly (${error._tag}).` },
            )
          }
        })

      const signOut = Effect.scoped(
        Effect.gen(function* () {
          const current = yield* Ref.get(active)
          yield* closeActive
          const paths = (yield* workspace.current)?.paths
          yield* workspace.close
          const messages = yield* host.messages
          const done = yield* Effect.forkScoped(Stream.runHead(Stream.filter(messages, (m) => m._tag === 'signedOut')))
          yield* host.send({ _tag: 'signOut' })
          yield* Fiber.join(done)
          const cacheDb = paths?.cacheDb ?? (current === undefined ? undefined : workspacePathsOf(config.userData, current.workspaceId))
          if (cacheDb !== undefined) {
            yield* Effect.promise(() => rm(cacheDb, { force: true }))
            yield* Effect.promise(() => rm(`${cacheDb}-wal`, { force: true }))
            yield* Effect.promise(() => rm(`${cacheDb}-shm`, { force: true }))
          }
          yield* setStatus({ _tag: 'signedOut' })
        }),
      )

      const activeSession = Effect.gen(function* () {
        const current = yield* Ref.get(active)
        if (current === undefined) return yield* new NotSignedIn()
        return current
      })

      yield* Effect.forkIn(start, serviceScope)
      yield* Scope.addFinalizer(serviceScope, closeActive)

      return Session.of({
        status: SubscriptionRef.get(state),
        statuses: SubscriptionRef.changes(state),
        signIn,
        signOut,
        active: activeSession,
        expire,
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

/** One directory per team, also on Grid, where several teams share an `enterprise_id`. */
const workspaceKey = (enterpriseId: string | undefined, teamId: string) => (enterpriseId === undefined ? teamId : `${enterpriseId}-${teamId}`)

const workspaceIdOf = (secrets: SessionSecrets) => workspaceKey(secrets.enterprise?.id, secrets.teamId)

function workspacePathsOf(userData: string, workspaceId: string): string {
  return `${userData}/workspaces/${workspaceId}/cache.db`
}
