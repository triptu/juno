/**
 * The Juno Agent client: one scoped RPC client of `AgentRpcs` over its own
 * port to the agent process, the same shape as the engine client
 * (`../client.ts`). Main brokers the port (ADR 0012); the agent restarts on
 * its own, and the transport asks main for a new port when one closes.
 *
 * The connection is an atom per registry: the renderer sets it once at
 * start with `configureAgentConnection(registry, { acquire: acquireAgentPort })`;
 * a test gives its own registry a Node `MessageChannel`.
 */
import * as Atom from 'effect/reactivity/Atom'
import { Context, Effect, Layer } from 'effect'
import type { makeAgentClient } from './rpc'
import { AGENT_PORT_HANDOFF_TAG, type JunoBridge } from '@juno/contract/channels'
import type { Registry } from '../client'
import { acquirePort } from '../port'
import { portProtocol, type PortConnection, type PortLike } from '../transport'
import { whenProviderActive } from './provider'

/**
 * How the renderer reaches the agent. `off`: main says no agent runs (it is
 * turned off, or its supervisor gave up); the transport keeps asking once a
 * second, so a started agent is reached without a reload.
 */
export type AgentConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'off'

export const agentConnectionStateAtom = Atom.make<AgentConnectionState>('connecting').pipe(Atom.keepAlive)

/** Main answered that no agent will take the port. */
export class AgentOff extends Error {
  override readonly name = 'AgentOff'
  constructor() {
    super('the Juno Agent is not running')
  }
}

/**
 * Asks main for a port to the agent; the preload forwards it as a tagged
 * window message. While no provider is set up no agent runs, so it waits
 * for one instead of asking (`provider.ts`).
 */
export async function acquireAgentPort(): Promise<PortLike> {
  const win = globalThis as unknown as { readonly juno: JunoBridge }
  await whenProviderActive(win.juno)
  return acquirePort(() => win.juno.agent.requestPort(), AGENT_PORT_HANDOFF_TAG, () => new AgentOff(), 'agent')
}

const noConnection: PortConnection = {
  acquire: () => Promise.reject(new Error('no agent port connection configured')),
}

export const agentConnectionAtom = Atom.make<PortConnection>(noConnection).pipe(Atom.keepAlive)

export function configureAgentConnection(target: Registry, connection: PortConnection): void {
  let everConnected = false
  target.set(agentConnectionAtom, {
    acquire: () =>
      connection.acquire().catch((cause: unknown) => {
        if (cause instanceof AgentOff) target.set(agentConnectionStateAtom, 'off')
        throw cause
      }),
    onState: (state) => {
      connection.onState?.(state)
      if (state === 'connected') everConnected = true
      target.set(agentConnectionStateAtom, state === 'connected' ? 'connected' : everConnected ? 'reconnecting' : 'connecting')
    },
  })
}

/** The agent's codecs are not needed to draw the shell or a cached topic. */
let loading: Promise<typeof import('./rpc')> | undefined
export const preloadAgentClient = (): Promise<typeof import('./rpc')> => loading ??= import('./rpc')

export class AgentClient extends Context.Service<AgentClient, Effect.Success<ReturnType<typeof makeAgentClient>>>()('juno/state/AgentClient') {
  static readonly runtime = Atom.runtime((get) => Layer.effect(
    AgentClient,
    Effect.promise(preloadAgentClient).pipe(Effect.flatMap((module) => module.makeAgentClient())),
  ).pipe(Layer.provide(portProtocol(get(agentConnectionAtom)))))
}
