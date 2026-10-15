/**
 * Starts the agent. The Electron entry (`apps/desktop/src/agent`) calls this
 * in the agent utility process; tests call it from Node.
 *
 * It reaches the host and checks the protocol, follows `host.presence`,
 * then, given `turns`, opens the turn engine on the agent directory with
 * the Slack reads and the card actions bound to the host (`host/reads.ts`,
 * `actions/host.ts`): the owner lock,
 * recovery, the guarded provider, pi, the router, the jobs and the
 * compactor (`router/open.ts`). Given `renderer`, it serves the
 * renderer's RPCs (`AgentRpcs`) on the ports that transport gives
 * (`serve/server.ts`), with Settings › Juno when `turns` brings a model
 * picker and a provider connection (`providerTurns`). `stop` closes the renderer server, then the engine,
 * then the host client, so the owner lock is released last of the engine's
 * resources.
 */
import { mkdirSync } from 'node:fs'
import { Context, Effect, Exit, Layer, Schema, Scope, Stream } from 'effect'
import { AGENT_HOST_PROTOCOL, HostHello, type AgentConfig } from '@juno/agent-contract'
import { bindActionHost } from './actions/host'
import { AgentHost } from './host/client'
import { bindHost, type BoundHost } from './host/reads'
import type { HostConnection } from './host/port'
import type { ProviderConnection } from './providers/connection'
import type { ModelPicker } from './providers/picker'
import type { Turns, TurnsOptions } from './router/open'
import { open } from './router/service'
import type { RendererTransport } from './serve/runner'
import { rendererServer } from './serve/server'
import { CHAT_MIGRATIONS } from './serve/schema'
import { createJunoSettings } from './settings/settings'
import type { UpdateNeeded } from './runtime/core'

export interface AgentHandle {
  readonly config: AgentConfig
  /** The host's answer to `host.hello` on the first port. */
  readonly host: HostHello
  /** The turn engine, or the "Juno needs to update its records" stop. Absent when `startAgent` had no `turns`. */
  readonly turns?: Turns | UpdateNeeded
  /** The Slack reads the turn engine's tools use, bound to the presence's account. */
  readonly reads: BoundHost['reads']
  /** The host's presence, followed for as long as the agent runs. */
  readonly presence: BoundHost['presence']
  readonly presenceChanges: BoundHost['presenceChanges']
  readonly stop: () => Promise<void>
}

/**
 * What the engine needs beside the agent directory, which comes from
 * `config`, and the host reads and sends, which come from the port. With a
 * picker and the provider connection, the renderer gets Settings › Juno.
 */
export type AgentTurns = Omit<TurnsOptions, 'agentDir' | 'host' | 'actions'> & {
  /** Executors other folders own. The host's sends come from the port. */
  readonly actions?: Omit<NonNullable<TurnsOptions['actions']>, 'host'>
  readonly picker?: ModelPicker
  readonly connection?: ProviderConnection
}

export interface AgentOptions {
  /** Opens the turn engine. Without it the agent only reaches its host. */
  readonly turns?: AgentTurns
  /** Serves the renderer's RPCs on these ports. */
  readonly renderer?: RendererTransport
}

/** The host speaks another AgentHost protocol version than this agent. */
export class HostProtocolMismatch extends Schema.TaggedError<HostProtocolMismatch>()('HostProtocolMismatch', { host: HostHello }) {}

export function startAgent(config: AgentConfig, connection: HostConnection, options: AgentOptions = {}): Promise<AgentHandle> {
  const { turns, renderer } = options
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const started = yield* Effect.gen(function* () {
        const context = yield* Layer.buildWithScope(AgentHost.layer(connection), scope)
        const client = Context.get(context, AgentHost)
        const hello = yield* client['host.hello']({ protocol: AGENT_HOST_PROTOCOL })
        if (hello.protocol !== AGENT_HOST_PROTOCOL) return yield* new HostProtocolMismatch({ host: hello })
        const bound = yield* bindHost.pipe(Effect.provide(context), Scope.provide(scope))
        const actionHost = yield* bindActionHost(bound.presence).pipe(Effect.provide(context))
        // A first start has no agent directory yet.
        if (turns !== undefined) mkdirSync(config.agentDir, { recursive: true })
        const engine =
          turns === undefined
            ? undefined
            : yield* Scope.provide(
                open({
                  ...turns,
                  agentDir: config.agentDir,
                  host: bound.reads,
                  actions: { ...turns.actions, host: actionHost },
                  migrations: [CHAT_MIGRATIONS, ...(turns.migrations ?? [])],
                }),
                scope,
              )
        if (engine?._tag === 'running') {
          // A click waits while no Slack account is known; each presence lets it look again.
          yield* bound.presenceChanges.pipe(
            Stream.runForEach(() => Effect.sync(() => engine.actions.kick())),
            Effect.forkScoped,
            Scope.provide(scope),
          )
        }
        const picker = turns?.picker
        const provider = turns?.connection
        const settings =
          engine?._tag === 'running' && picker !== undefined && provider !== undefined
            ? yield* Effect.acquireRelease(
                Effect.sync(() =>
                  createJunoSettings({
                    turns: engine, picker, connection: provider, agentDir: config.agentDir,
                    ...(turns?.onReport ? { onReport: turns.onReport } : {}),
                  }),
                ),
                (opened) => Effect.sync(opened.close),
              ).pipe(Scope.provide(scope))
            : undefined
        if (renderer !== undefined) {
          yield* Layer.buildWithScope(
            rendererServer(renderer, { turns: engine, presence: bound.presence, presenceChanges: bound.presenceChanges, ...(settings ? { settings } : {}) }),
            scope,
          )
        }
        return { hello, engine, bound }
      }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
      return {
        config,
        host: started.hello,
        ...(started.engine === undefined ? {} : { turns: started.engine }),
        reads: started.bound.reads,
        presence: started.bound.presence,
        presenceChanges: started.bound.presenceChanges,
        stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
      }
    }),
  )
}
