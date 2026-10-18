/**
 * @juno/sync: Slack into the store. `runSync` is the whole thing for one
 * session; the engine runs it while the session is ready. The merge rules
 * and `reindexTopics` are exported for tests and for the engine's commands
 * (which re-index the topics they touch).
 */
export { runSync, type SyncPhase, type TopicFetcher } from './sync'
export { type FetchReport } from './open'
export { syncConfigLayer, type SyncConfigShape } from './config'
export { FollowFence, followFenceLayer } from './followFence'

export { mergeMessage, mergeRootCounters, mergeTombstone, stubRoot, toMessageRow } from './merge'
export { imagesWithoutThumbs } from './files'
export { reindexAll, reindexTopics, type StoredPreview } from './reindex'
export { BOOT_KEY, HOME_READY_KEY, QUICK_START_KEY, storedMe } from './boot'
export {
  beginPendingFollow,
  clearThreadSub,
  deferMark,
  dropMark,
  endMark,
  endPendingFollow,
  observeRead,
  patchOverlay,
  pendingMark,
  pendingMarks,
  readMessage,
  readOverlay,
  readState,
  rejectMark,
  setIgnored,
  setThreadSub,
  threadSub,
  writeLocalMark,
  type ThreadSubRow,
} from './write'

export {
  claimPost,
  deferLookup,
  deferPost,
  discardPost,
  failPost,
  failUpload,
  fileStaged,
  fileUploaded,
  flushPosts,
  pendingPosts,
  uploadedNames,
  postUnknown,
  queuePost,
  readPost,
  recordSend,
  recoverPosts,
  requeuePost,
  retryPost,
  type PendingFile,
  type PendingPost,
} from './posts'
export { type Acted } from './events'
export {
  actionDone,
  deferAction,
  dropAction,
  flushActions,
  pendingActions,
  readAction,
  placeOf,
  queueDelete,
  queueEdit,
  resolveTarget,
  settleOnFailedPost,
  type ActionRefusal,
  type MessageRef,
  type PendingAction,
} from './actions'
export { isFailed, markStalled, queueReaction } from './reactions'
export { checkCopyDelete } from './sent'

export { startThread } from './startedThreads'

export { failAction, resolveFailedAction } from './actionFailure'
