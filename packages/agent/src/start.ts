/**
 * Starts the agent. The Electron entry (`apps/desktop/src/agent`) calls this
 * in the agent utility process; tests call it from Node.
 *
 * It reaches the host and checks the protocol, then, given `turns`, opens
 * the turn engine on the agent directory: the owner lock, recovery, the
 * guarded provider, pi, the router, the jobs and the compactor
 * (`router/open.ts`). `stop` closes the engine before the host client, so
 * the owner lock is released last of the engine's resources.
 */
import { Context, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { AGENT_HOST_PROTOCOL, HostHello, type AgentConfig } from '@juno/agent-contract'
import { AgentHost } from './host/client'
import type { HostConnection } from './host/port'
import type { Turns, TurnsOptions } from './router/open'
import { open } from './router/service'
import type { UpdateNeeded } from './runtime/core'

export interface AgentHandle {
  readonly config: AgentConfig
  /** The host's answer to `host.hello` on the first port. */
  readonly host: HostHello
  /** The turn engine, or the "Juno needs to update its records" stop. Absent when `startAgent` had no `turns`. */
  readonly turns?: Turns | UpdateNeeded
  readonly stop: () => Promise<void>
}

/** What the engine needs beside the agent directory, which comes from `config`. */
export type AgentTurns = Omit<TurnsOptions, 'agentDir'>

/** The host speaks another AgentHost protocol version than this agent. */
export class HostProtocolMismatch extends Schema.TaggedError<HostProtocolMismatch>()('HostProtocolMismatch', { host: HostHello }) {}

export function startAgent(config: AgentConfig, connection: HostConnection, turns?: AgentTurns): Promise<AgentHandle> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const started = yield* Effect.gen(function* () {
        const context = yield* Layer.buildWithScope(AgentHost.layer(connection), scope)
        const client = Context.get(context, AgentHost)
        const hello = yield* client['host.hello']({ protocol: AGENT_HOST_PROTOCOL })
        if (hello.protocol !== AGENT_HOST_PROTOCOL) return yield* new HostProtocolMismatch({ host: hello })
        const engine = turns === undefined ? undefined : yield* Scope.provide(open({ ...turns, agentDir: config.agentDir }), scope)
        return { hello, engine }
      }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
      return {
        config,
        host: started.hello,
        ...(started.engine === undefined ? {} : { turns: started.engine }),
        stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
      }
    }),
  )
}
