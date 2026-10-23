export { startEngine, type EngineHandle, type EngineHostOptions } from './startEngine'
export { memoryHost, type Host } from './protocol/host'
export { electronTransport, memoryTransport } from './protocol/transport'
export { socketTransport } from './protocol/socket'
/** The sidebar query, for the live dry run (`scripts/sync-live-dry-run.ts`) and the benchmark. */
export { listTopics } from './topics/query'
export { SIDEBAR_WINDOW } from '@juno/contract'

/** Scheduling defaults for test hosts; normal launches keep these unchanged. */
export { productionTiming } from './config'
