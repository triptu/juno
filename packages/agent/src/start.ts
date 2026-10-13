/**
 * Starts the agent core. The Electron entry (`apps/desktop/src/agent`) calls
 * this in the agent utility process; tests call it from Node.
 *
 * Today it only reaches the host and checks the protocol. The durable runtime
 * (WP8) and the rest of the core attach to this layer.
 */
import { Context, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { AGENT_HOST_PROTOCOL, HostHello, type AgentConfig } from '@juno/agent-contract'
import { AgentHost } from './host/client'
import type { HostConnection } from './host/port'

export interface AgentHandle {
  readonly config: AgentConfig
  /** The host's answer to `host.hello` on the first port. */
  readonly host: HostHello
  readonly stop: () => Promise<void>
}

/** The host speaks another AgentHost protocol version than this agent. */
export class HostProtocolMismatch extends Schema.TaggedError<HostProtocolMismatch>()('HostProtocolMismatch', { host: HostHello }) {}

export function startAgent(config: AgentConfig, connection: HostConnection): Promise<AgentHandle> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const host = yield* Effect.gen(function* () {
        const context = yield* Layer.buildWithScope(AgentHost.layer(connection), scope)
        const client = Context.get(context, AgentHost)
        const hello = yield* client['host.hello']({ protocol: AGENT_HOST_PROTOCOL })
        if (hello.protocol !== AGENT_HOST_PROTOCOL) return yield* new HostProtocolMismatch({ host: hello })
        return hello
      }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
      return { config, host, stop: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
    }),
  )
}
