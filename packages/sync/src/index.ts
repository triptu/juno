/**
 * @juno/sync: Slack into the store. `runSync` is the whole thing for one
 * session; the engine runs it while the session is ready. The merge rules
 * and `reindexTopics` are exported for tests and for the engine's commands
 * (which re-index the topics they touch).
 */
export { runSync, type SyncPhase, type SyncStep, type TopicFetcher } from './sync'
export { type FetchReport } from './open'
export { OPEN_FETCH_MAX } from './openShared'
export { syncConfigLayer, type SyncConfigShape } from './config'
export { followFenceLayer } from './followFence'

export { mergeMessage, mergeRootCounters, mergeTombstone, stubRoot, toMessageRow } from './merge'
export { continuous, provenToEnd, rangeHolding, type ThreadRange } from './threadRanges'
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
  beginDraftSave,
  deferDraftSave,
  draftClientMsgId,
  draftDestination,
  draftSyncRow,
  draftTopicId,
  dropDraftSave,
  endDraftSave,
  endSentDraft,
  linkedDrafts,
  observeDraft,
  pendingDrafts,
  recoverDraftSaves,
  sendDraft,
  settleDraftFinds,
  topicOfSlackDraft,
  writeLocalDraft,
  type DraftAnswer,
  type DraftSyncRow,
  type PendingDraft,
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
  recoverPosts,
  requeuePost,
  retryPost,
  type PendingFile,
  type PendingPost,
  type PendingShare,
} from './posts'
export { type Acted } from './acted'
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
  ACTION_KINDS_SQL,
  settleOnFailedPost,
  type ActionRefusal,
  type MessageRef,
  type PendingAction,
} from './actions'
export { isFailed, markStalled, queueReaction } from './reactions'
export { queueBroadcast } from './broadcasts'
export { checkCopyDelete } from './sent'

export { startThread } from './startedThreads'

export { failAction, resolveFailedAction } from './actionFailure'
