/**
 * When Juno offers to learn about the owner (SPEC 13.8): once the owner is
 * signed in to Slack, AI assist is on and a model provider is set up, the
 * setup ask, once ever; and when a connection that holds the owner's context
 * becomes ready, an ask for it. `check` looks again; the caller calls it on
 * every presence, connection and provider change.
 */
import type { Presence } from '../host/reads'
import type { McpManagerApi } from '../mcp/manager'
import type { ProviderConnection } from '../providers/connection'
import type { Mode } from '../store/ledger'
import type { Store } from '../store/store'
import { CONTEXT_CONNECTIONS, offerConnection, offerSetup } from './asks'

export interface OfferInput {
  readonly store: Store
  readonly presence: () => Presence | undefined
  readonly mode: () => Mode
  /** Main's provider. Without one nothing is offered: a pass would have no model. Absent in tests. */
  readonly provider?: ProviderConnection
  readonly manager?: () => McpManagerApi | undefined
  /** An ask was made. */
  readonly offered: () => void
}

export function offerAsks(input: OfferInput): () => void {
  return () => {
    const presence = input.presence()
    if (presence === undefined || presence.accountId == null || !presence.aiEnabled || input.mode() !== 'on') return
    if (input.provider !== undefined && !input.provider.current()) return
    const manager = input.manager?.()
    const ready = manager === undefined ? [] : [...CONTEXT_CONNECTIONS.keys()].filter((id) => manager.configs().some((config) => config.id === id) && manager.state(id) === 'ready')
    let made = offerSetup(input.store, ready)
    for (const id of ready) made = offerConnection(input.store, id) || made
    if (made) input.offered()
  }
}
