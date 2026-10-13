/**
 * @juno/sync: Slack into the store. `runSync` is the whole thing for one
 * session; the engine runs it while the session is ready. The merge rules
 * and `reindexTopics` are exported for tests and for the engine's commands
 * (which re-index the topics they touch).
 */
export { runSync, type RunSyncOptions, type SyncPhase, type SyncServices, type TopicFetcher } from './sync'
export { fetchOlder, fetchTopic, HISTORY_START, OPEN_FETCH_MAX, type FetchReport, type OpenError } from './open'
export { SyncConfig, defaultSyncConfig, syncConfigLayer, type SyncConfigShape } from './config'
export { messageTopics, syncKeys } from './keys'
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
export { storedMe, type BootState } from './boot'
export {
  applyRootSubscription,
  beginPendingFollow,
  clearThreadSub,
  deferMark,
  dropMark,
  endMark,
  endPendingFollow,
  observeRead,
  pendingMark,
  pendingMarks,
  readMessage,
  readState,
  rejectMark,
  setThreadSub,
  threadSub,
  writeLocalMark,
  type PendingMark,
  type ThreadSubOutcome,
  type ThreadSubRow,
  type ThreadSubSource,
} from './write'

export { syncEmoji } from './emoji'
