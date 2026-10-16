/**
 * The open workspace: the store of the signed-in team (ADR 0008).
 *
 * The session opens it as soon as it knows the workspace id, before any
 * Slack call, so the first `topics.list` is answered from `cache.db`
 * (performance 2.1). Feature handlers read `changes` and switch their live
 * queries to the current store; the sync runner provides its context to
 * `runSync`. Sign-out closes it before the cache file is deleted.
 *
 * A top-level module, not a feature folder, because the session, the sync
 * runner and the topics handlers all need it and feature folders do not
 * import each other.
 */
import { Context, Effect, Exit, Layer, Scope, Stream, SubscriptionRef } from 'effect'
import { cacheMigrationsWithProbe, Invalidation, Store, StorePaths, StoreReader, StoreWriter, workspacePaths, type StoreError, type WorkspacePaths } from '@juno/store'
import { EngineConfig } from './config'

export type StoreServices = Store | StoreWriter | StoreReader | Invalidation | StorePaths

export interface OpenWorkspace {
  readonly id: string
  readonly paths: WorkspacePaths
  readonly context: Context.Context<StoreServices>
}

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly current: Effect.Effect<OpenWorkspace | undefined>
    /** The current workspace at subscribe time, then every open and close. */
    readonly changes: Stream.Stream<OpenWorkspace | undefined>
    /** Opens the store for `id`; a no-op when it is already open, a switch when another one is. */
    readonly open: (id: string) => Effect.Effect<OpenWorkspace, StoreError>
    readonly close: Effect.Effect<void>
  }
>()('juno/engine/Workspace') {
  static readonly layer: Layer.Layer<Workspace, never, EngineConfig> = Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const config = yield* EngineConfig
      const serviceScope = yield* Effect.scope
      const state = yield* SubscriptionRef.make<OpenWorkspace | undefined>(undefined)
      let scope: Scope.Closeable | undefined

      const close = Effect.gen(function* () {
        const current = scope
        scope = undefined
        yield* SubscriptionRef.set(state, undefined)
        if (current !== undefined) yield* Scope.close(current, Exit.void)
      })

      const open = (id: string) =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state)
          if (current?.id === id) return current
          yield* close
          const paths = workspacePaths(config.userData, id)
          const next = yield* Scope.make()
          const options = config.e2e && config.cacheMigrationProbe === true ? { cacheMigrations: cacheMigrationsWithProbe } : {}
          const context = yield* Layer.buildWithScope(Store.layer(paths, options), next).pipe(Effect.onError(() => Scope.close(next, Exit.void)))
          scope = next
          const opened: OpenWorkspace = { id, paths, context }
          yield* SubscriptionRef.set(state, opened)
          return opened
        })

      yield* Scope.addFinalizer(serviceScope, close)

      return Workspace.of({
        current: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state),
        open,
        close,
      })
    }),
  )
}
