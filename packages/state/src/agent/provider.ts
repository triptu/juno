/**
 * Juno Agent's model provider, as main holds it (SPEC 13.10). The agent
 * runs only while one is set up, so this, not the agent's port, says
 * whether the Juno tab and panel show the chat or "Add a provider".
 *
 * - `agentProviderAtom`: main's `ProviderState`, read at first use and
 *   followed on every change; undefined until main answers (outside the
 *   app, it stays undefined).
 * - `setAgentProvider`: sets up, removes or switches a provider; keys go
 *   from here to main and the keychain, never to the agent's port.
 * - `whenProviderActive`: resolves once a provider is active, so the agent
 *   client asks main for a port only when an agent will take it.
 */
import { Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { ProviderResult, ProviderState, type ProviderChange } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'

const decodeState = Schema.decodeUnknownOption(ProviderState)
const decodeResult = Schema.decodeUnknownOption(ProviderResult)

const bridge = (): JunoBridge | undefined => (globalThis as { readonly juno?: JunoBridge }).juno

/** Calls `listener` with main's provider state now and on every change. Returns the unsubscribe. */
function followProvider(juno: JunoBridge, listener: (state: ProviderState) => void): () => void {
  let latest = 0
  const take = (raw: unknown, order: number) => {
    // An answer to the first read loses to any change pushed after it was asked.
    if (order < latest) return
    latest = order
    const state = decodeState(raw)
    if (state._tag === 'Some') listener(state.value)
  }
  let pushes = 1
  const off = juno.agent.onProvider((raw) => take(raw, ++pushes))
  juno.agent.provider().then((raw) => take(raw, 1), () => {})
  return off
}

export const agentProviderAtom = Atom.make((get): ProviderState | undefined => {
  const juno = bridge()
  if (juno === undefined) return undefined
  get.addFinalizer(followProvider(juno, (state) => get.setSelf(state)))
  return undefined
}).pipe(Atom.keepAlive)

/** Applies a provider change through main. `failed` if main could not be reached. */
export async function setAgentProvider(change: ProviderChange): Promise<ProviderResult> {
  const juno = bridge()
  if (juno === undefined) return 'failed'
  const result = decodeResult(await juno.agent.setProvider(change).catch(() => undefined))
  return result._tag === 'Some' ? result.value : 'failed'
}

/** Resolves once main says a provider is active. */
export function whenProviderActive(juno: JunoBridge): Promise<void> {
  return new Promise((resolve) => {
    const off = followProvider(juno, (state) => {
      if (state.active === null) return
      off()
      resolve()
    })
  })
}
