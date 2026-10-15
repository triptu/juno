export { startEngine, type EngineHandle, type EngineHostOptions } from './startEngine'
export { HostLink, memoryHost, silentHost, type Host, type MemoryHost } from './protocol/host'
export {
  electronTransport,
  memoryTransport,
  type EnginePort,
  type MessagePortLike,
  type MessagePortMainLike,
  type Transport,
} from './protocol/transport'
/** The sidebar query, for the live dry run (`scripts/sync-live-dry-run.ts`) and the benchmark. */
export { listTopics, makeRowCache, type ListFilter, type QueryOptions, type RowCache } from './topics/query'
export { SIDEBAR_WINDOW } from '@juno/contract'

export type { Notification, Notifier, MessageSource, NotificationTarget } from '@juno/notifications'
