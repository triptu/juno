import type { AgentProvider } from '@juno/agent-contract'

/**
 * The provider main hands the agent (SPEC 13.10): OpenRouter with its key,
 * or an OpenAI-compatible endpoint. Held in memory only. `get` waits until
 * main has sent one, so a first request does not race the message.
 * `rejected` marks the current key after the provider refused it; a change
 * from main clears the mark.
 */
export interface ProviderConnection {
  readonly get: () => Promise<AgentProvider | undefined>
  /** The provider now: undefined until main has sent it, null for none. */
  readonly current: () => AgentProvider | null | undefined
  readonly set: (provider: AgentProvider | null) => void
  readonly rejected: () => void
  readonly isRejected: () => boolean
  readonly subscribe: (listener: () => void) => () => void
}

export function providerConnection(): ProviderConnection {
  let provider: AgentProvider | null | undefined
  let rejected = false
  const waiters: Array<(provider: AgentProvider | undefined) => void> = []
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  return {
    get: () =>
      new Promise((resolve) => {
        if (provider !== undefined) resolve(provider ?? undefined)
        else waiters.push(resolve)
      }),
    current: () => provider,
    set: (next) => {
      provider = next
      rejected = false
      for (const resolve of waiters.splice(0)) resolve(next ?? undefined)
      changed()
    },
    rejected: () => {
      if (rejected || !provider) return
      rejected = true
      changed()
    },
    isRejected: () => rejected,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
