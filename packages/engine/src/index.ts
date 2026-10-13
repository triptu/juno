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
export { serveLiveList, serveLiveValue, timed, type ListRun, type Run, type ServeOptions, type Timed } from './protocol/live'
/** The sidebar query, for the live dry run (`scripts/sync-live-dry-run.ts`) and benchmarks. */
export { countTopics, listTopics, type ListFilter, type QueryOptions } from './topics/query'
export { SIDEBAR_WINDOW } from './topics/handlers'
