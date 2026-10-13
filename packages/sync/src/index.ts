/**
 * @juno/sync: Slack into the store. `runSync` is the whole thing for one
 * session; the engine runs it while the session is ready. The merge rules
 * and `reindexTopics` are exported for tests and for the engine's commands
 * (which re-index the topics they touch).
 */
export { runSync, type RunSyncOptions, type SyncPhase, type SyncServices } from './sync'
export { SyncConfig, defaultSyncConfig, syncConfigLayer, type SyncConfigShape } from './config'
export { syncKeys } from './keys'
export {
  mergeMessage,
  mergeRootCounters,
  mergeTombstone,
  stubRoot,
  toMessageRow,
  type MergeResult,
  type MergeSource,
  type RootCounters,
} from './merge'
export { reindexAll, reindexTopics, topicsOfMessages, type ReindexOptions, type StoredPreview } from './reindex'
export type { BootState } from './boot'
export {
  applyRootSubscription,
  beginPendingFollow,
  clearThreadSub,
  endPendingFollow,
  readMessage,
  readState,
  setThreadSub,
  threadSub,
  type ThreadSubRow,
  type ThreadSubSource,
} from './write'

export { syncEmoji } from './emoji'
