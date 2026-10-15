export { startEngine, type EngineHandle, type EngineHostOptions } from './startEngine'
export { memoryHost, type Host } from './protocol/host'
export { electronTransport } from './protocol/transport'
/** The sidebar query, for the live dry run (`scripts/sync-live-dry-run.ts`) and the benchmark. */
export { listTopics } from './topics/query'
export { SIDEBAR_WINDOW } from '@juno/contract'
